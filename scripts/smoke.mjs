/**
 * smoke.mjs — تست دود (smoke test) برای استقرار
 *
 * همهٔ مسیرهای حیاتی را بدون وابستگی به آپستریم بررسی می‌کند تا بعد از دیپلوی
 * روی Railway با یک دستور مطمئن شوید سرویس سالم است:
 *
 *   npm run smoke                                   → http://127.0.0.1:3000
 *   npm run smoke -- --url https://myapp.up.railway.app
 *   BASE_URL=https://myapp.up.railway.app npm run smoke
 *
 * تست‌ها:
 *   GET  /                       → 200 + HTML فارسی
 *   GET  /healthz                → 200 + status:ok
 *   GET  /v1/models              → 200 + ۷ مدل
 *   POST /v1/chat/completions    → 401 بدون کلید (احراز هویت فعال است)
 *   POST /v1/messages            → 401 بدون کلید
 *   POST /v1/messages            → 400 بدون max_tokens (با کلید — فقط اگر کلید در env باشد)
 *   GET  /nope                   → 404
 *
 * خروجی: جدول ✓/✗ — در صورت هر شکست، exit code = 1
 */
const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i > -1 ? process.argv[i + 1] : null;
})();
const BASE = (argUrl || process.env.BASE_URL || 'http://127.0.0.1:' + (process.env.PORT || 3000)).replace(/\/$/, '');

const results = [];
let failed = 0;

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, ms, detail: detail || '' });
  } catch (err) {
    failed++;
    results.push({ name, ok: false, ms: Date.now() - t0, detail: err.message });
  }
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...opts });
  const text = await res.text().catch(() => '');
  return { res, text };
}

console.log(`\n🔍 Smoke test → ${BASE}\n`);

await check('GET /healthz → 200 status:ok', async () => {
  const { res, text } = await req('/healthz');
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  const j = JSON.parse(text);
  if (j.status !== 'ok') throw new Error('status != ok');
  return `uptime=${j.uptimeSec}s models=${j.models} keysExposed=${j.keysExposed}`;
});

await check('GET / → 200 HTML', async () => {
  const { res, text } = await req('/');
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  if (!/<!DOCTYPE html>/i.test(text)) throw new Error('HTML نیست');
  return `${(text.length / 1024).toFixed(0)}KB`;
});

await check('GET /v1/models → 200 با ≥۷ مدل', async () => {
  const { res, text } = await req('/v1/models');
  if (res.status !== 200) throw new Error(`status=${res.status}`);
  const j = JSON.parse(text);
  if (!Array.isArray(j.data) || j.data.length < 7) throw new Error(`data.length=${j.data?.length}`);
  return j.data.map((m) => m.id).join(', ');
});

await check('POST /v1/chat/completions بدون کلید → 401', async () => {
  const { res } = await req('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  });
  if (res.status !== 401) throw new Error(`status=${res.status} (انتظار 401)`);
  return 'احراز هویت فعال ✓';
});

await check('POST /v1/messages بدون کلید → 401', async () => {
  const { res } = await req('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-fable-5.1', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] }),
  });
  if (res.status !== 401) throw new Error(`status=${res.status} (انتظار 401)`);
  return 'احراز هویت فعال ✓';
});

/* اگر کلید در env باشد، اعتبارسنجی سخت‌گیرانهٔ Anthropic هم تست می‌شود */
const key = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
if (key) {
  await check('POST /v1/messages بدون max_tokens → 400', async () => {
    const { res, text } = await req('/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ model: 'claude-fable-5.1', messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (res.status !== 400) throw new Error(`status=${res.status} (انتظار 400)`);
    if (!/max_tokens/.test(text)) throw new Error('پیام خطا به max_tokens اشاره نکرد');
    return 'اعتبارسنجی سخت‌گیرانه ✓';
  });
} else {
  results.push({ name: 'POST /v1/messages بدون max_tokens → 400', ok: true, ms: 0, detail: 'رد شد (کلید در env نیست)' });
}

await check('GET /nope → 404', async () => {
  const { res } = await req('/nope');
  if (res.status !== 404) throw new Error(`status=${res.status}`);
  return 'مسیر ناشناس ✓';
});

/* ── چاپ نتایج ── */
const pad = (s, n) => {
  const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
};
for (const r of results) {
  console.log(`  ${r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${pad(r.name, 46)} ${pad(r.ms + 'ms', 9)} ${r.ok ? '\x1b[2m' + r.detail + '\x1b[0m' : '\x1b[31m' + r.detail + '\x1b[0m'}`);
}
console.log(
  failed
    ? `\n\x1b[31m❌ ${failed} تست ناموفق بود — استقرار سالم نیست.\x1b[0m\n`
    : `\n\x1b[32m✅ همهٔ ${results.length} تست موفق بود — سرویس آماده است.\x1b[0m\n`,
);
process.exit(failed ? 1 : 0);
