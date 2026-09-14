/**
 * cloudflare/tests/stream.test.mjs — تست سرتاسری نسخهٔ Cloudflare Worker
 *
 * مسیرهایی را بررسی می‌کند که `scripts/smoke.mjs` پوشش نمی‌دهد: «استریم واقعی».
 * انتظار دارد یک نمونه در حال اجرا باشد (wrangler dev یا دیپلوی‌شده) و آپستریم
 * یا واقعی باشد یا `cloudflare/mock-upstream.mjs`.
 *
 *   npm run cf:mock                                  (ترمینال ۱)
 *   npm run cf:dev                                   (ترمینال ۲)
 *   OPENAI_API_KEY=sk-... npm run cf:test            (ترمینال ۳)
 *
 *   یا روی دیپلوی واقعی:
 *   OPENAI_API_KEY=sk-... npm run cf:test -- --url https://smart-chat.<you>.workers.dev
 */
const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i > -1 ? process.argv[i + 1] : null;
})();
const BASE = (argUrl || process.env.BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const KEY = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '';

const results = [];
let failed = 0;

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail: detail || '' });
  } catch (err) {
    failed++;
    results.push({ name, ok: false, ms: Date.now() - t0, detail: (err && err.message) || String(err) });
  }
}

/** خواندن استریم SSE با ثبت «زمان رسیدن اولین تکه» (معیار زنده‌بودن استریم) */
async function readStream(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = '';
  let firstChunkMs = null;
  const t0 = Date.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstChunkMs === null) firstChunkMs = Date.now() - t0;
    text += dec.decode(value, { stream: true });
  }
  return { text, firstChunkMs, totalMs: Date.now() - t0 };
}

const chatBody = (content, extra) =>
  JSON.stringify(
    Object.assign(
      { messages: [{ role: 'user', content }], modelId: 'claude-fable-5.1', thinking: false, deepSearch: false, stream: true },
      extra || {}
    )
  );

console.log(`\n🔍 تست Worker → ${BASE}\n`);

await check('GET /healthz → runtime=cloudflare-worker', async () => {
  const res = await fetch(BASE + '/healthz');
  const j = await res.json();
  if (res.status !== 200 || j.status !== 'ok') throw new Error(`status=${res.status} body=${JSON.stringify(j).slice(0, 120)}`);
  if (j.runtime !== 'cloudflare-worker') throw new Error(`runtime=${j.runtime}`);
  return `keysSource=${j.keysSource} keysExposed=${j.keysExposed} models=${j.models}`;
});

await check('GET / → HTML با کلید ماسک‌شده', async () => {
  const res = await fetch(BASE + '/');
  const html = await res.text();
  if (res.status !== 200 || !/<!DOCTYPE html>/i.test(html)) throw new Error('HTML معتبر نبود');
  if (!html.includes('window.__FM__')) throw new Error('دیتای سرور تزریق نشده');
  if (/sk-ant-api03-[A-Za-z0-9]{40}/.test(html)) throw new Error('کلید خام در HTML لو رفته!');
  return `${(html.length / 1024).toFixed(0)}KB`;
});

await check('GET /v1/models → ۷ مدل', async () => {
  const res = await fetch(BASE + '/v1/models');
  const j = await res.json();
  if (!Array.isArray(j.data) || j.data.length < 7) throw new Error(`data.length=${j.data && j.data.length}`);
  return j.data.map((m) => m.id).join(', ');
});

await check('GET لوگوی embed → image/webp', async () => {
  const res = await fetch(BASE + '/Claude-ai-logo.webp');
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  if (!/image\//.test(res.headers.get('content-type') || '')) throw new Error('content-type=' + res.headers.get('content-type'));
  if (buf.length < 500) throw new Error('خیلی کوچک: ' + buf.length);
  return `${(buf.length / 1024).toFixed(1)}KB`;
});

await check('OPTIONS /api/chat → 204 + CORS', async () => {
  const res = await fetch(BASE + '/api/chat', { method: 'OPTIONS' });
  if (res.status !== 204) throw new Error(`status=${res.status}`);
  if (res.headers.get('access-control-allow-origin') !== '*') throw new Error('CORS ست نشده');
  return 'ok';
});

await check('POST /api/chat → استریم زندهٔ SSE', async () => {
  const res = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: chatBody('سلام @slow', { stream: true }),
  });
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!/text\/event-stream/.test(ct)) throw new Error('content-type=' + ct);
  const { text, firstChunkMs, totalMs } = await readStream(res);
  if (!/data:/.test(text)) throw new Error('هیچ فریم SSE نیامد');
  if (!/پاسخ ماک|content/.test(text)) throw new Error('محتوای انتظار نبود: ' + text.slice(0, 120));
  /* زنده‌بودن: اولین تکه باید خیلی زودتر از پایان برسد */
  if (firstChunkMs > totalMs * 0.75) throw new Error(`استریم تجمیع شده (first=${firstChunkMs}ms total=${totalMs}ms)`);
  return `first=${firstChunkMs}ms total=${totalMs}ms frames=${(text.match(/data:/g) || []).length}`;
});

if (!KEY) {
  for (const n of ['/v1/chat/completions استریم', '/v1/chat/completions غیراستریم', '/v1/messages استریم', '/v1/messages غیراستریم', 'thinking → reasoning']) {
    results.push({ name: n, ok: true, ms: 0, detail: 'رد شد (OPENAI_API_KEY در env نیست)' });
  }
} else {
  await check('/v1/chat/completions استریم → chunk + [DONE]', async () => {
    const res = await fetch(BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({ model: 'GPT 5.6 Sol', messages: [{ role: 'user', content: 'سلام @slow' }], stream: true, stream_options: { include_usage: true } }),
    });
    if (res.status !== 200) throw new Error(`status=${res.status}`);
    const { text, firstChunkMs, totalMs } = await readStream(res);
    if (!/chat\.completion\.chunk/.test(text)) throw new Error('چانک OpenAI نیامد');
    if (!/\[DONE\]/.test(text)) throw new Error('[DONE] نیامد');
    if (!/usage/.test(text)) throw new Error('usage (stream_options) نیامد');
    if (firstChunkMs > totalMs * 0.75) throw new Error(`استریم تجمیع شده (first=${firstChunkMs}ms total=${totalMs}ms)`);
    const assembled = [...text.matchAll(/"content":"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse('"' + m[1] + '"')).join('');
    if (!assembled.includes('پاسخ ماک')) throw new Error('متن مونتاژشده درست نیست: ' + assembled.slice(0, 80));
    return `first=${firstChunkMs}ms total=${totalMs}ms chars=${assembled.length}`;
  });

  await check('/v1/chat/completions غیراستریم → message.content', async () => {
    const res = await fetch(BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({ model: 'claude-fable-5.1', messages: [{ role: 'user', content: 'سلام' }], stream: false }),
    });
    const j = await res.json();
    if (res.status !== 200) throw new Error(`status=${res.status} body=${JSON.stringify(j).slice(0, 150)}`);
    const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (typeof c !== 'string' || !c.includes('پاسخ ماک')) throw new Error('content=' + JSON.stringify(c).slice(0, 100));
    return `${c.length} کاراکتر · usage=${JSON.stringify(j.usage)}`;
  });

  await check('/v1/messages استریم → رویدادهای Anthropic', async () => {
    const res = await fetch(BASE + '/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-fable-5.1', max_tokens: 256, messages: [{ role: 'user', content: 'سلام @slow' }], stream: true }),
    });
    if (res.status !== 200) throw new Error(`status=${res.status}`);
    const { text, firstChunkMs, totalMs } = await readStream(res);
    for (const evName of ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']) {
      if (!text.includes('event: ' + evName)) throw new Error('رویداد ' + evName + ' نیامد');
    }
    if (firstChunkMs > totalMs * 0.75) throw new Error(`استریم تجمیع شده (first=${firstChunkMs}ms total=${totalMs}ms)`);
    return `first=${firstChunkMs}ms total=${totalMs}ms`;
  });

  await check('/v1/messages غیراستریم → content blocks', async () => {
    const res = await fetch(BASE + '/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-fable-5.1', max_tokens: 256, system: 'کوتاه پاسخ بده', messages: [{ role: 'user', content: 'سلام' }], stream: false }),
    });
    const j = await res.json();
    if (res.status !== 200) throw new Error(`status=${res.status} body=${JSON.stringify(j).slice(0, 150)}`);
    const txt = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!txt.includes('پاسخ ماک')) throw new Error('text=' + txt.slice(0, 100));
    return `blocks=${(j.content || []).length} stop=${j.stop_reason}`;
  });

  await check('thinking=true → reasoning_content', async () => {
    const res = await fetch(BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({ model: 'claude-fable-5.1', messages: [{ role: 'user', content: 'سلام' }], stream: true, thinking: true }),
    });
    const { text } = await readStream(res);
    if (!/reasoning_content/.test(text)) throw new Error('reasoning_content نیامد');
    return 'ok';
  });
}

await check('خطای آپستریم (@error) → به کلاینت می‌رسد', async () => {
  const res = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: chatBody('لطفاً @error بده'),
  });
  if (res.status !== 500) throw new Error(`status=${res.status} (انتظار ۵۰۰ پاس‌دادنی)`);
  const t = await res.text();
  if (!/mock upstream failure/.test(t)) throw new Error('بدنهٔ خطا پاس نشد: ' + t.slice(0, 100));
  return 'status=500 پاس داده شد';
});

await check('قطع کلاینت → استریم زود بسته می‌شود', async () => {
  const ctrl = new AbortController();
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: chatBody('سلام @slow'),
      signal: ctrl.signal,
    });
    const reader = res.body.getReader();
    await reader.read(); // یک تکه بگیر
    ctrl.abort();
    try {
      await reader.cancel();
    } catch (e) {
      /* noop */
    }
  } catch (e) {
    if (!/abort/i.test(String(e))) throw e;
  }
  const ms = Date.now() - t0;
  if (ms > 5000) throw new Error('abort طول کشید: ' + ms + 'ms');
  return `abort در ${ms}ms`;
});

await check('GET /nope → 404', async () => {
  const res = await fetch(BASE + '/nope');
  if (res.status !== 404) throw new Error(`status=${res.status}`);
  return 'ok';
});

/* ── چاپ ── */
const pad = (s, n) => {
  const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
};
for (const r of results) {
  console.log(
    `  ${r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${pad(r.name, 46)} ${pad(r.ms + 'ms', 10)} ${r.ok ? '\x1b[2m' + r.detail + '\x1b[0m' : '\x1b[31m' + r.detail + '\x1b[0m'}`
  );
}
console.log(
  failed
    ? `\n\x1b[31m❌ ${failed} تست ناموفق بود.\x1b[0m\n`
    : `\n\x1b[32m✅ همهٔ ${results.length} تست موفق بود.\x1b[0m\n`
);
process.exit(failed ? 1 : 0);
