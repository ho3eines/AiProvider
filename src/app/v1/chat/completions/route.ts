/**
 * POST /v1/chat/completions — اندپوینت سازگار OpenAI با پشتیبانی کامل از Tool Calling (مخصوص Codex / Cursor)
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

const jsonError = (status: number, message: string, code: string | null = null) =>
  NextResponse.json(
    {
      error: {
        message,
        type: status >= 500 ? 'api_error' : 'invalid_request_error',
        param: null,
        code,
      },
    },
    { status, headers: V1_CORS },
  );

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: V1_CORS });
}

export async function POST(req: NextRequest) {
  const keys = getApiKeys();
  const key = bearerFrom(req.headers.get('authorization')) || (req.headers.get('x-api-key') || '').trim();
  if (!keyIsValid(key, keys)) {
    return jsonError(401, 'کلید API نامعتبر است (هدر Authorization: Bearer).', 'invalid_api_key');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'بدنهٔ JSON نامعتبر است.');
  }

  const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0 && parsed.tool_choice !== 'none';
  const toolsPrompt = hasTools ? buildToolSystemPrompt(parsed.tools, parsed.tool_choice) : '';
  const upstreamMsgs = buildUpstreamMessages(parsed.messages, undefined, toolsPrompt);

  if (!upstreamMsgs.length) {
    return jsonError(400, 'messages باید آرایه‌ای غیرخالی از پیام‌ها باشد.');
  }

  const model = resolveModelId(typeof parsed.model === 'string' ? parsed.model : null);
  const wantStream = parsed.stream === true;
  const payload = JSON.stringify({
    messages: upstreamMsgs,
    modelId: model,
    thinking: parsed.thinking === true,
    deepSearch: parsed.deep_search === true,
    stream: wantStream,
  });

  const id = 'chatcmpl-' + randomBytes(10).toString('hex');
  const created = Math.floor(Date.now() / 1000);
  const estIn = estTokens(upstreamMsgs.reduce((n, m) => n + m.content.length, 0));

  let up;
  try {
    up = await openUpstream(payload, UPSTREAM_TIMEOUT_MS);
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    return jsonError(/timeout/i.test(msg) ? 504 : 502, 'اتصال به سرویس چت برقرار نشد: ' + msg);
  }
  if (up.status >= 400) {
    const txt = (await readAll(up.res, 4000)).trim().slice(0, 300);
    up.req.destroy();
    return jsonError(up.status, 'خطای سرویس چت (HTTP ' + up.status + '): ' + txt);
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

    const { cleanText, toolCalls } = hasTools
      ? extractToolCalls(acc.text, 'call_')
      : { cleanText: acc.text, toolCalls: [] };

    const content =
      cleanText || (toolCalls.length ? null : acc.reasoning || '⚠️ پاسخ خالی از سرور دریافت شد.');
    const estOut = estTokens(acc.text.length);

    const messageObj: Record<string, unknown> = {
      role: 'assistant',
      content,
    };
    if (acc.reasoning) messageObj.reasoning_content = acc.reasoning;
    if (toolCalls.length > 0) {
      messageObj.tool_calls = toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.input || {}),
        },
      }));
    }

    return NextResponse.json(
      {
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [
          {
            index: 0,
            message: messageObj,
            logprobs: null,
            finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
          },
        ],
        usage: { prompt_tokens: estIn, completion_tokens: estOut, total_tokens: estIn + estOut },
      },
      { headers: V1_CORS },
    );
  }

  /* ─────────── استریم SSE به سبک OpenAI ─────────── */
  const streamOpts = parsed.stream_options as Record<string, unknown> | undefined;
  const includeUsage = !!(streamOpts && streamOpts.include_usage === true);
  const encoder = new TextEncoder();
  let outChars = 0;
  let gotText = false;
  let gotReasoning = false;
  let toolCallIdx = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          closed = true;
        }
      };
      const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
        send(
          'data: ' +
            JSON.stringify({
              id,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{ index: 0, delta, finish_reason: finish }],
            }) +
            '\n\n',
        );

      const toolFilter = createStreamingToolFilter({
        idPrefix: 'call_',
        onText: (txt) => {
          if (!txt) return;
          gotText = true;
          outChars += txt.length;
          chunk({ content: txt });
        },
        onToolCall: (call) => {
          const idx = toolCallIdx++;
          const argsStr = JSON.stringify(call.input || {});
          outChars += argsStr.length;
          chunk({
            tool_calls: [
              {
                index: idx,
                id: call.id,
                type: 'function',
                function: {
                  name: call.name,
                  arguments: argsStr,
                },
              },
            ],
          });
        },
      });

      const endStream = () => {
        if (closed) return;
        if (hasTools) toolFilter.flush();
        if (!gotText && !gotReasoning && toolCallIdx === 0) {
          chunk({ content: '⚠️ پاسخ خالی از سرور دریافت شد.' });
        }
        chunk({}, toolCallIdx > 0 ? 'tool_calls' : 'stop');
        if (includeUsage) {
          const estOut = estTokens(outChars);
          send(
            'data: ' +
              JSON.stringify({
                id,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [],
                usage: { prompt_tokens: estIn, completion_tokens: estOut, total_tokens: estIn + estOut },
              }) +
              '\n\n',
          );
        }
        send('data: [DONE]\n\n');
        closed = true;
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };

      const parser = createSseParser({
        onEvent: (ev) => {
          if (ev.error) {
            chunk({ content: '\n\n⚠️ ' + ev.error });
            return;
          }
          if (ev.reasoning) {
            gotReasoning = true;
            chunk({ reasoning_content: ev.reasoning });
          }
          if (ev.text) {
            if (hasTools) toolFilter.push(ev.text);
            else {
              gotText = true;
              outChars += ev.text.length;
              chunk({ content: ev.text });
            }
          }
        },
      });

      chunk({ role: 'assistant', content: '' });
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
