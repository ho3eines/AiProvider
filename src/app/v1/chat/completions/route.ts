/**
 * POST /v1/chat/completions — اندپوینت سازگار OpenAI
 * • احراز هویت: Authorization: Bearer <key> (کلیدهای api-keys.json)
 * • استریم (SSE به سبک OpenAI + [DONE]) و غیراستریم (chat.completion)
 * • پاسخ آپستریم با پارسر جهانی (src/lib/sse.ts) به فرمت OpenAI تبدیل می‌شود
 * • اکستنشن‌های اختیاری غیراستاندارد: thinking ، deep_search
 */
import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { openUpstreamFor, UPSTREAM_TIMEOUT_MS } from '@/lib/upstream';
import { createSseParser } from '@/lib/sse';
import { getProvidersConfig } from '@/lib/providers';
import { buildUpstreamPayload, resolveModel } from '@/lib/catalog';
import { bearerFrom, getApiKeys, keyIsValid } from '@/lib/apikeys';
import { estTokens, flattenContent, readAll, SSE_HEADERS, V1_CORS } from '@/lib/v1';

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
  if (!keyIsValid(bearerFrom(req.headers.get('authorization')), keys)) {
    return jsonError(401, 'کلید API نامعتبر است (هدر Authorization: Bearer).', 'invalid_api_key');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'بدنهٔ JSON نامعتبر است.');
  }

  /* پیام‌ها → فرمت آپستریم (نقش‌های ناشناخته → user) */
  const msgsIn = Array.isArray(parsed.messages) ? (parsed.messages as Record<string, unknown>[]) : [];
  const upstreamMsgs: { role: string; content: string }[] = [];
  for (const m of msgsIn) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' || m.role === 'system' ? String(m.role) : 'user';
    const content = flattenContent(m.content);
    if (content) upstreamMsgs.push({ role, content });
  }
  if (!upstreamMsgs.length) {
    return jsonError(400, 'messages باید آرایه‌ای غیرخالی از پیام‌ها باشد.');
  }

  /* پروایدر از روی مدل انتخاب می‌شود؛ بدنه در شکلِ مورد انتظارِ همان آپستریم ساخته می‌شود */
  const cfg = getProvidersConfig();
  const resolved = resolveModel(typeof parsed.model === 'string' ? parsed.model : null, cfg);
  const provider = resolved.provider;
  const model = resolved.publicId;
  const wantStream = parsed.stream === true;
  const payload = JSON.stringify(
    buildUpstreamPayload(provider, {
      messages: upstreamMsgs,
      modelId: resolved.id,
      thinking: parsed.thinking === true, // اکستنشن غیراستاندارد (اختیاری)
      deepSearch: parsed.deep_search === true, // اکستنشن غیراستاندارد (اختیاری)
      stream: wantStream,
    })
  );
  /* تنظیمات پارسر مخصوص همین پروایدر (فیلدهای سفارشی آپستریم) */
  const parserOpts = {
    extraTextFields: provider.response?.textFields,
    extraReasoningFields: provider.response?.reasoningFields,
    doneToken: provider.response?.doneToken,
  };

  const id = 'chatcmpl-' + randomBytes(10).toString('hex');
  const created = Math.floor(Date.now() / 1000);
  const estIn = estTokens(upstreamMsgs.reduce((n, m) => n + m.content.length, 0));

  /* اتصال به آپستریم */
  let up;
  try {
    up = await openUpstreamFor(provider, payload, UPSTREAM_TIMEOUT_MS);
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
      ...parserOpts,
      onEvent: (ev) => {
        acc.text += ev.text;
        acc.reasoning += ev.reasoning;
        if (ev.error && !acc.error) acc.error = ev.error;
      },
    });
    parser.feed(full);
    parser.end();
    const content = acc.text || acc.reasoning || '⚠️ پاسخ خالی از سرور دریافت شد.';
    const estOut = estTokens(content.length);
    return NextResponse.json(
      {
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            logprobs: null,
            finish_reason: 'stop',
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
      const endStream = () => {
        if (closed) return;
        chunk({}, 'stop');
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
        ...parserOpts,
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
            gotText = true;
            outChars += ev.text.length;
            chunk({ content: ev.text });
          }
        },
      });

      chunk({ role: 'assistant', content: '' }); // چانک اول: نقش
      up.res.on('data', (c) => parser.feed(c.toString('utf8')));
      up.res.on('end', () => {
        parser.end();
        if (!gotText && !gotReasoning) chunk({ content: '⚠️ پاسخ خالی از سرور دریافت شد.' });
        endStream();
      });
      up.res.on('error', () => endStream());
      /* قطع کلاینت → قطع آپستریم */
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
