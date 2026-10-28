/**
 * POST /v1/messages — اندپوینت سازگار Anthropic با پشتیبانی کامل از Tool Calling (مخصوص Claude Code)
 */
import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { openUpstream, UPSTREAM_TIMEOUT_MS } from '@/lib/upstream';
import { createSseParser } from '@/lib/sse';
import { resolveModelId } from '@/lib/models';
import { bearerFrom, getApiKeys, keyIsValid } from '@/lib/apikeys';
import {
  buildToolSystemPrompt,
  buildUpstreamMessages,
  createStreamingToolFilter,
  estTokens,
  extractToolCalls,
  readAll,
  SSE_HEADERS,
  V1_CORS,
} from '@/lib/v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const jsonError = (status: number, type: string, message: string) =>
  NextResponse.json({ type: 'error', error: { type, message } }, { status, headers: V1_CORS });

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: V1_CORS });
}

export async function POST(req: NextRequest) {
  const keys = getApiKeys();
  const key = (req.headers.get('x-api-key') || '').trim() || bearerFrom(req.headers.get('authorization'));
  if (!keyIsValid(key, keys)) {
    return jsonError(401, 'authentication_error', 'کلید API نامعتبر است (هدر x-api-key).');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_request_error', 'بدنهٔ JSON نامعتبر است.');
  }

  if (!parsed.model || typeof parsed.model !== 'string') {
    return jsonError(400, 'invalid_request_error', 'model: Field required');
  }
  if (typeof parsed.max_tokens !== 'number') {
    return jsonError(400, 'invalid_request_error', 'max_tokens: Field required');
  }

  let sysText = '';
  if (typeof parsed.system === 'string') sysText = parsed.system;
  else if (Array.isArray(parsed.system)) {
    sysText = (parsed.system as Record<string, unknown>[])
      .map((b) => (b && typeof b.text === 'string' ? b.text : ''))
      .join('\n');
  }

  const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0 && parsed.tool_choice !== 'none';
  const toolsPrompt = hasTools ? buildToolSystemPrompt(parsed.tools, parsed.tool_choice) : '';
  const upstreamMsgs = buildUpstreamMessages(parsed.messages, sysText, toolsPrompt);

  if (!upstreamMsgs.length) {
    return jsonError(400, 'invalid_request_error', 'messages: at least one message is required');
  }

  const model = resolveModelId(parsed.model);
  const wantStream = parsed.stream === true;
  const thinkingEnabled =
    parsed.thinking === true ||
    (parsed.thinking !== null &&
      typeof parsed.thinking === 'object' &&
      (parsed.thinking as Record<string, unknown>).type === 'enabled');

  const payload = JSON.stringify({
    messages: upstreamMsgs,
    modelId: model,
    thinking: thinkingEnabled,
    deepSearch: false,
    stream: wantStream,
  });

  const msgId = 'msg_' + randomBytes(10).toString('hex');
  const estIn = estTokens(upstreamMsgs.reduce((n, m) => n + m.content.length, 0));

  let up;
  try {
    up = await openUpstream(payload, UPSTREAM_TIMEOUT_MS);
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    return jsonError(/timeout/i.test(msg) ? 504 : 502, 'api_error', 'اتصال به سرویس چت برقرار نشد: ' + msg);
  }
  if (up.status >= 400) {
    const txt = (await readAll(up.res, 4000)).trim().slice(0, 300);
    up.req.destroy();
    return jsonError(
      up.status,
      up.status === 429 ? 'rate_limit_error' : 'api_error',
      'خطای سرویس چت (HTTP ' + up.status + '): ' + txt,
    );
  }

  /* ─────────── پاسخ کامل (غیراستریم) ─────────── */
  if (!wantStream) {
    const full = await readAll(up.res);
    const acc = { text: '', reasoning: '', error: '' };
    const parser = createSseParser({
      onEvent: (ev) => {
        acc.text += ev.text;
        acc.reasoning += ev.reasoning;
        if (ev.error && !acc.error) acc.error = ev.error;
      },
    });
    parser.feed(full);
    parser.end();

    const content: Array<Record<string, unknown>> = [];
    if (acc.reasoning) content.push({ type: 'thinking', thinking: acc.reasoning });

    const { cleanText, toolCalls } = hasTools
      ? extractToolCalls(acc.text, 'toolu_')
      : { cleanText: acc.text, toolCalls: [] };

    if (cleanText || acc.error) {
      content.push({ type: 'text', text: cleanText || '⚠️ ' + acc.error });
    }
    for (const tc of toolCalls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }
    if (!content.length) {
      content.push({ type: 'text', text: '⚠️ پاسخ خالی از سرور دریافت شد.' });
    }

    const stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn';

    return NextResponse.json(
      {
        id: msgId,
        type: 'message',
        role: 'assistant',
        model,
        content,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: { input_tokens: estIn, output_tokens: estTokens(acc.text.length) },
      },
      { headers: V1_CORS },
    );
  }

  /* ─────────── استریم SSE به سبک Anthropic ─────────── */
  const encoder = new TextEncoder();
  let outChars = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let blockIdx = -1;
      let blockType: 'text' | 'thinking' | null = null;
      let usedTool = false;
      let gotAnyBlock = false;

      const send = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          closed = true;
        }
      };
      const ev = (name: string, obj: Record<string, unknown>) =>
        send('event: ' + name + '\ndata: ' + JSON.stringify(obj) + '\n\n');

      const closeBlock = () => {
        if (blockType) {
          ev('content_block_stop', { type: 'content_block_stop', index: blockIdx });
          blockType = null;
        }
      };
      const openBlock = (t: 'text' | 'thinking') => {
        if (blockType === t) return;
        closeBlock();
        blockIdx++;
        blockType = t;
        gotAnyBlock = true;
        ev('content_block_start', {
          type: 'content_block_start',
          index: blockIdx,
          content_block: t === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' },
        });
      };

      const emitText = (txt: string) => {
        if (!txt) return;
        openBlock('text');
        outChars += txt.length;
        ev('content_block_delta', {
          type: 'content_block_delta',
          index: blockIdx,
          delta: { type: 'text_delta', text: txt },
        });
      };

      const emitToolCall = (call: { id: string; name: string; input: Record<string, unknown> }) => {
        closeBlock();
        blockIdx++;
        gotAnyBlock = true;
        usedTool = true;
        const jsonArgs = JSON.stringify(call.input || {});
        outChars += jsonArgs.length;
        ev('content_block_start', {
          type: 'content_block_start',
          index: blockIdx,
          content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} },
        });
        ev('content_block_delta', {
          type: 'content_block_delta',
          index: blockIdx,
          delta: { type: 'input_json_delta', partial_json: jsonArgs },
        });
        ev('content_block_stop', { type: 'content_block_stop', index: blockIdx });
      };

      const toolFilter = createStreamingToolFilter({
        idPrefix: 'toolu_',
        onText: emitText,
        onToolCall: emitToolCall,
      });

      const endStream = () => {
        if (closed) return;
        if (hasTools) toolFilter.flush();
        if (!gotAnyBlock) emitText('⚠️ پاسخ خالی از سرور دریافت شد.');
        closeBlock();
        ev('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: usedTool ? 'tool_use' : 'end_turn', stop_sequence: null },
          usage: { output_tokens: estTokens(outChars) },
        });
        ev('message_stop', { type: 'message_stop' });
        closed = true;
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };

      ev('message_start', {
        type: 'message_start',
        message: {
          id: msgId,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: estIn, output_tokens: 0 },
        },
      });
      ev('ping', { type: 'ping' });

      const parser = createSseParser({
        onEvent: (event) => {
          if (event.error) {
            emitText('\n\n⚠️ ' + event.error);
            return;
          }
          if (event.reasoning) {
            openBlock('thinking');
            ev('content_block_delta', {
              type: 'content_block_delta',
              index: blockIdx,
              delta: { type: 'thinking_delta', thinking: event.reasoning },
            });
          }
          if (event.text) {
            if (hasTools) toolFilter.push(event.text);
            else emitText(event.text);
          }
        },
      });

      up.res.on('data', (c) => parser.feed(c.toString('utf8')));
      up.res.on('end', () => {
        parser.end();
        endStream();
      });
      up.res.on('error', () => endStream());
      req.signal?.addEventListener('abort', () => {
        closed = true;
        up.req.destroy();
        try {
          controller.close();
        } catch {
          /* noop */
        }
      });
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
