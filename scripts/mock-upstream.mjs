#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  mock-upstream.mjs — آپستریم ساختگی برای توسعه/تست بدون اینترنت
 * ═══════════════════════════════════════════════════════════════════════════
 *  چرا؟ چون (۱) آپستریم واقعی گاهی 429 می‌دهد یا در سندباکس در دسترس نیست و
 *  (۲) برای تست پروایدر جدید باید بتوان شکل درخواست/پاسخ را بدون سایت واقعی دید.
 *
 *  اجرا:      npm run mock            (پورت 4100 — با MOCK_PORT قابل تغییر)
 *  مسیر:      POST /chat              (هر مسیر دیگری هم قبول می‌شود)
 *
 *  رفتارهای قابل درخواست (داخل بدنهٔ JSON):
 *    "stream": true|false       → SSE سبک OpenAI یا JSON کامل
 *    "mock_error": 429          → پاسخ خطای HTTP با همان کد (تست نگاشت خطا)
 *    "mock_shape": "custom"     → پاسخ با فیلد غیراستاندارد `output`/`thought`
 *                                  (تست response.textFields/reasoningFields)
 *    "mock_shape": "claude"     → پاسخ سبک Anthropic (content_block_delta)
 *    "mock_chunks": 5           → تعداد تکه‌های پاسخ
 *    "mock_delay_ms": 20        → تأخیر بین تکه‌ها
 *
 *  پاسخ همیشه «بدنهٔ دریافتی» را خلاصه می‌کند تا در تست دود بتوان شکل
 *  درخواست ساخته‌شده توسط پروکسی را assert کرد (کلیدها + مدل + تعداد پیام).
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 4100);
const HOST = process.env.MOCK_HOST || '0.0.0.0';

function readBody(req, cap = 8 * 1024 * 1024) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => {
      if (s.length < cap) s += c;
      else req.destroy();
    });
    req.on('end', () => resolve(s));
    req.on('error', () => resolve(s));
  });
}

/** خلاصهٔ بدنهٔ دریافتی — برای assert در تست‌ها */
function summarize(body) {
  const keys = Object.keys(body).sort();
  const model = body.model || body.modelId || '(none)';
  const msgs = Array.isArray(body.messages) ? body.messages.length : 0;
  return [
    'پاسخ آپستریم ساختگی (mock).',
    '',
    `- شکل دریافتی: \`${keys.join(',')}\``,
    `- مدل: \`${model}\` · پیام‌ها: ${msgs} · stream: ${body.stream === true}`,
    `- thinking: ${body.thinking === true} · deepSearch: ${body.deepSearch === true}`,
    `- هدرها از سمت پروکسی تأیید شد.`,
    '',
    'این یک پاسخ آزمایشی است تا زنجیرهٔ پروکسی/پارسر/API بدون اینترنت تست شود.',
  ].join('\n');
}

function chunkTexts(body) {
  const text = summarize(body);
  const n = Math.max(1, Number(body.mock_chunks) || 6);
  const parts = [];
  const step = Math.ceil(text.length / n);
  for (let i = 0; i < text.length; i += step) parts.push(text.slice(i, i + step));
  return parts;
}

const server = createServer(async (req, res) => {
  const raw = await readBody(req);
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'invalid JSON body' } }));
    return;
  }

  console.log(`[mock] ${req.method} ${req.url} ← keys=${Object.keys(body).sort().join(',')}`);

  /* ── شبیه‌سازی خطای HTTP (مثلاً 429 سهمیه) ── */
  if (body.mock_error) {
    const code = Number(body.mock_error) || 429;
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: `mock upstream error ${code} (providers exhausted)`, type: 'rate_limit_error', code },
      })
    );
    return;
  }

  const delay = Number(body.mock_delay_ms) || 5;
  const shape = String(body.mock_shape || 'openai');
  const parts = chunkTexts(body);
  const reasoning = body.thinking === true ? ['در حال بررسی درخواست…', 'جمع‌بندی پاسخ.'] : [];

  /* ── پاسخ غیراستریم ── */
  if (body.stream !== true) {
    const text = parts.join('');
    if (shape === 'claude') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }));
      return;
    }
    if (shape === 'custom') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ output: text, thought: reasoning.join(' ') }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'mock-1',
        object: 'chat.completion',
        model: body.model || body.modelId || 'mock',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: text, ...(reasoning.length ? { reasoning_content: reasoning.join(' ') } : {}) },
            finish_reason: 'stop',
          },
        ],
      })
    );
    return;
  }

  /* ── پاسخ استریم (SSE) ── */
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let closed = false;
  res.on('close', () => {
    closed = true;
  });

  const send = (obj) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  if (shape === 'claude') {
    send({ type: 'message_start', message: { id: 'mock', role: 'assistant', content: [] } });
    for (const r of reasoning) {
      send({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: r } });
      await sleep(delay);
    }
    for (const p of parts) {
      send({ type: 'content_block_delta', delta: { type: 'text_delta', text: p } });
      await sleep(delay);
    }
    send({ type: 'message_stop' });
    res.end();
    return;
  }

  if (shape === 'custom') {
    for (const r of reasoning) {
      send({ thought: r });
      await sleep(delay);
    }
    for (const p of parts) {
      send({ output: p });
      await sleep(delay);
    }
    send('[DONE]');
    res.end();
    return;
  }

  /* سبک پیش‌فرض: OpenAI */
  send({ choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] });
  for (const r of reasoning) {
    send({ choices: [{ index: 0, delta: { reasoning_content: r } }] });
    await sleep(delay);
  }
  for (const p of parts) {
    send({ choices: [{ index: 0, delta: { content: p } }] });
    await sleep(delay);
  }
  send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  res.write('data: [DONE]\n\n');
  res.end();
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log(`🧪 آپستریم ساختگی (mock) آماده است: http://127.0.0.1:${PORT}/chat`);
  console.log('   بدنهٔ درخواست: {"messages":[...],"stream":true|false,"mock_error":429,"mock_shape":"openai|claude|custom"}');
  console.log('');
});
