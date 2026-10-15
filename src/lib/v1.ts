/**
 * ابزارهای مشترک اندپوینت‌های /v1 (سازگار OpenAI و Anthropic) + آداپتور Tool Calling
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** CORS باز شامل هدرهای احراز هویت (برای استفادهٔ خارجی از API) */
export const V1_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta',
  'Access-Control-Max-Age': '86400',
};

/** هدرهای استاندارد پاسخ SSE */
export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
  ...V1_CORS,
};

export interface ParsedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

const TOOL_OPEN = '<tool_call>';
const TOOL_CLOSE = '</tool_call>';

export const genToolId = (prefix = 'toolu_'): string =>
  prefix + randomBytes(12).toString('hex');

/** تبدیل محتوای پیام (متن، tool_use، tool_result) به متن ساختاریافته برای آپستریم */
export function flattenContent(c: unknown): string {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  const parts: string[] = [];

  for (const b of c) {
    if (typeof b === 'string') {
      parts.push(b);
      continue;
    }
    if (!b || typeof b !== 'object') continue;
    const block = b as Record<string, unknown>;

    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'tool_use') {
      const name = String(block.name || 'tool');
      const input = block.input && typeof block.input === 'object' ? block.input : {};
      parts.push(`${TOOL_OPEN}\n${JSON.stringify({ name, input })}\n${TOOL_CLOSE}`);
    } else if (block.type === 'tool_result') {
      const id = String(block.tool_use_id || '');
      const isErr = block.is_error === true;
      const inner =
        typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? flattenContent(block.content)
            : JSON.stringify(block.content ?? '');
      parts.push(
        `<tool_result id="${id}"${isErr ? ' status="error"' : ''}>\n${inner}\n</tool_result>`,
      );
    } else if (typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

/** تبدیل آرایه پیام‌های Anthropic یا OpenAI (شامل نقش tool و tool_calls) به پیام‌های آپستریم */
export function buildUpstreamMessages(
  rawMessages: unknown,
  systemPrompt?: string,
  toolsPrompt?: string,
): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  const fullSystem = [systemPrompt?.trim(), toolsPrompt?.trim()].filter(Boolean).join('\n\n');
  if (fullSystem) {
    out.push({ role: 'system', content: fullSystem });
  }

  const msgs = Array.isArray(rawMessages) ? (rawMessages as Record<string, unknown>[]) : [];
  for (const m of msgs) {
    if (!m || typeof m !== 'object') continue;
    const roleRaw = String(m.role || 'user');

    // پیام نتیجهٔ ابزار در OpenAI (role === 'tool' یا 'function')
    if (roleRaw === 'tool' || roleRaw === 'function') {
      const id = String(m.tool_call_id || m.name || 'tool');
      const text = flattenContent(m.content);
      const wrapped = `<tool_result id="${id}">\n${text}\n</tool_result>`;
      out.push({ role: 'user', content: wrapped });
      continue;
    }

    // پیام assistant در OpenAI که شامل tool_calls است
    const parts: string[] = [];
    const baseText = flattenContent(m.content);
    if (baseText) parts.push(baseText);

    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as Record<string, unknown>[]) {
        const fn = (tc?.function || {}) as Record<string, unknown>;
        const name = String(fn.name || '');
        if (!name) continue;
        let input: unknown = {};
        if (typeof fn.arguments === 'string') {
          try {
            input = JSON.parse(fn.arguments);
          } catch {
            input = { raw: fn.arguments };
          }
        } else if (fn.arguments && typeof fn.arguments === 'object') {
          input = fn.arguments;
        }
        parts.push(`${TOOL_OPEN}\n${JSON.stringify({ name, input })}\n${TOOL_CLOSE}`);
      }
    }

    const finalContent = parts.join('\n').trim();
    if (!finalContent) continue;

    const mappedRole =
      roleRaw === 'assistant' ? 'assistant' : roleRaw === 'system' ? 'system' : 'user';

    // ادغام پیام‌های متوالی هم‌نقش برای جلوگیری از گیج شدن آپستریم
    const prev = out[out.length - 1];
    if (prev && prev.role === mappedRole && mappedRole !== 'system') {
      prev.content += '\n\n' + finalContent;
    } else {
      out.push({ role: mappedRole, content: finalContent });
    }
  }
  return out;
}

/** ساخت پرامپت سیستمی برای تعریف ابزارها (سازگار با فرمت Anthropic و OpenAI) */
export function buildToolSystemPrompt(tools: unknown, toolChoice?: unknown): string {
  if (!Array.isArray(tools) || tools.length === 0) return '';

  const normalized = tools
    .map((t) => {
      if (!t || typeof t !== 'object') return null;
      const obj = t as Record<string, unknown>;
      // فرمت OpenAI: { type: 'function', function: { name, description, parameters } }
      if (obj.function && typeof obj.function === 'object') {
        const fn = obj.function as Record<string, unknown>;
        return {
          name: fn.name,
          description: fn.description || '',
          parameters: fn.parameters || { type: 'object', properties: {} },
        };
      }
      // فرمت Anthropic: { name, description, input_schema }
      return {
        name: obj.name,
        description: obj.description || '',
        parameters: obj.input_schema || obj.parameters || { type: 'object', properties: {} },
      };
    })
    .filter((x) => x && typeof x.name === 'string');

  if (!normalized.length) return '';

  let choiceHint = '';
  if (toolChoice && typeof toolChoice === 'object') {
    const tc = toolChoice as Record<string, unknown>;
    if (tc.type === 'any' || tc.type === 'required') {
      choiceHint = '\nIMPORTANT: You MUST invoke at least one tool in your response using <tool_call>.';
    } else if (tc.type === 'tool' && typeof tc.name === 'string') {
      choiceHint = `\nIMPORTANT: You MUST invoke the tool "${tc.name}" using <tool_call>.`;
    } else if (tc.type === 'function' && tc.function && typeof (tc.function as Record<string, unknown>).name === 'string') {
      choiceHint = `\nIMPORTANT: You MUST invoke the tool "${(tc.function as Record<string, unknown>).name}" using <tool_call>.`;
    }
  } else if (toolChoice === 'required') {
    choiceHint = '\nIMPORTANT: You MUST invoke at least one tool in your response using <tool_call>.';
  }

  return [
    '## Tool Use Protocol',
    'You have access to the following tools to inspect files, run commands, search code, and complete tasks autonomously:',
    '<tools>',
    JSON.stringify(normalized),
    '</tools>',
    '',
    'When you need to use a tool, output ONLY the exact XML block below (you may output multiple <tool_call> blocks if needed):',
    '<tool_call>',
    '{"name": "<tool_name>", "input": {<arguments_matching_parameters_schema>}}',
    '</tool_call>',
    '',
    'CRITICAL RULES FOR AGENT AUTONOMY:',
    '1. Never guess file contents or directory structures; always call the appropriate read/list/search tool first.',
    '2. Keep calling tools step-by-step until the user request is 100% resolved and verified. Do NOT stop early to ask the user to continue.',
    '3. Inside <tool_call>, write strictly valid JSON with "name" and "input" keys (no markdown fences inside <tool_call>).',
    '4. After outputting <tool_call> blocks, stop immediately and wait for the <tool_result> in the next turn.' + choiceHint,
  ].join('\n');
}

/** تلاش برای پارس JSON داخل <tool_call> (مقاوم در برابر کدبلاک مارک‌داون یا آرگومان رشته‌ای) */
function tryParseToolJson(raw: string, idPrefix: string): ParsedToolCall | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) return null;
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object' || typeof obj.name !== 'string') return null;
    const rawInput = obj.input !== undefined ? obj.input : obj.arguments;
    let input: Record<string, unknown> = {};
    if (typeof rawInput === 'string') {
      try {
        const parsed = JSON.parse(rawInput);
        input = parsed && typeof parsed === 'object' ? parsed : { value: parsed };
      } catch {
        input = { raw: rawInput };
      }
    } else if (rawInput && typeof rawInput === 'object') {
      input = rawInput as Record<string, unknown>;
    }
    return {
      id: genToolId(idPrefix),
      name: obj.name.trim(),
      input,
    };
  } catch {
    return null;
  }
}

/** استخراج تمام <tool_call> ها از متن کامل (برای حالت غیراستریم) */
export function extractToolCalls(
  rawText: string,
  idPrefix = 'toolu_',
): { cleanText: string; toolCalls: ParsedToolCall[] } {
  const toolCalls: ParsedToolCall[] = [];
  let cleanText = '';
  let idx = 0;

  while (idx < rawText.length) {
    const start = rawText.indexOf(TOOL_OPEN, idx);
    if (start === -1) {
      cleanText += rawText.slice(idx);
      break;
    }
    cleanText += rawText.slice(idx, start);
    const bodyStart = start + TOOL_OPEN.length;
    const end = rawText.indexOf(TOOL_CLOSE, bodyStart);

    if (end === -1) {
      const tail = rawText.slice(bodyStart);
      const parsed = tryParseToolJson(tail, idPrefix);
      if (parsed) toolCalls.push(parsed);
      else cleanText += rawText.slice(start);
      break;
    }

    const inner = rawText.slice(bodyStart, end);
    const parsed = tryParseToolJson(inner, idPrefix);
    if (parsed) toolCalls.push(parsed);
    else cleanText += rawText.slice(start, end + TOOL_CLOSE.length);

    idx = end + TOOL_CLOSE.length;
  }

  return { cleanText: cleanText.replace(/\n{3,}/g, '\n\n').trim(), toolCalls };
}

/**
 * فیلتر استریم زنده برای شکار تگ‌های <tool_call> در حین استریم بدون نشت تگ به متن کاربر
 */
export function createStreamingToolFilter(opts: {
  idPrefix?: string;
  onText: (text: string) => void;
  onToolCall: (call: ParsedToolCall) => void;
}) {
  const prefix = opts.idPrefix || 'toolu_';
  let buffer = '';
  let inTool = false;

  /** بررسی اینکه آیا انتهای رشته می‌تواند پیشوند ناقصی از تگ هدف باشد */
  function partialSuffixLen(str: string, tag: string): number {
    const maxCheck = Math.min(str.length, tag.length - 1);
    for (let len = maxCheck; len > 0; len--) {
      if (str.endsWith(tag.slice(0, len))) return len;
    }
    return 0;
  }

  function process(isFinal: boolean) {
    while (buffer.length > 0) {
      if (!inTool) {
        const idx = buffer.indexOf(TOOL_OPEN);
        if (idx !== -1) {
          if (idx > 0) opts.onText(buffer.slice(0, idx));
          buffer = buffer.slice(idx + TOOL_OPEN.length);
          inTool = true;
          continue;
        }
        if (isFinal) {
          opts.onText(buffer);
          buffer = '';
          break;
        }
        const keep = partialSuffixLen(buffer, TOOL_OPEN);
        const safeLen = buffer.length - keep;
        if (safeLen > 0) {
          opts.onText(buffer.slice(0, safeLen));
          buffer = buffer.slice(safeLen);
        }
        break;
      } else {
        const idx = buffer.indexOf(TOOL_CLOSE);
        if (idx !== -1) {
          const rawJson = buffer.slice(0, idx);
          buffer = buffer.slice(idx + TOOL_CLOSE.length);
          inTool = false;
          const parsed = tryParseToolJson(rawJson, prefix);
          if (parsed) opts.onToolCall(parsed);
          else opts.onText(`${TOOL_OPEN}${rawJson}${TOOL_CLOSE}`);
          continue;
        }
        if (isFinal) {
          const parsed = tryParseToolJson(buffer, prefix);
          if (parsed) opts.onToolCall(parsed);
          else opts.onText(`${TOOL_OPEN}${buffer}`);
          buffer = '';
          inTool = false;
          break;
        }
        break;
      }
    }
  }

  return {
    push(chunk: string) {
      if (!chunk) return;
      buffer += chunk;
      process(false);
    },
    flush() {
      process(true);
    },
  };
}

/** خواندن کامل استریم ورودی به رشته (با سقف) */
export function readAll(res: IncomingMessage, cap = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve) => {
    let s = '';
    res.on('data', (c) => {
      if (s.length < cap) s += c.toString('utf8');
      else res.destroy();
    });
    res.on('end', () => resolve(s));
    res.on('error', () => resolve(s));
  });
}

/** تخمین توکن (برای فیلد usage) — تقریباً هر ۴ نویسه یک توکن */
export const estTokens = (chars: number): number => Math.max(1, Math.ceil(chars / 4));
