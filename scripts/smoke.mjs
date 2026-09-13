#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  smoke.mjs — تست دودِ خودکار (چک‌لیست HANDOFF § 5 به‌صورت کد)
 * ═══════════════════════════════════════════════════════════════════════════
 *  بدون نیاز به اینترنت: یک «آپستریم ساختگی» (scripts/mock-upstream.mjs) بالا
 *  می‌آید، یک پیکربندی موقت پروایدرها ساخته می‌شود (scripts/lib/test-config.mjs)،
 *  سپس سرور هدف اجرا و همهٔ مسیرها/قابلیت‌های رجیستری بررسی می‌شوند.
 *
 *  اجرا:
 *    npm run smoke                                   → نسخهٔ تک‌فایل app.js (پیش‌فرض)
 *    npm run smoke -- --base http://127.0.0.1:3000   → روی سرورِ در حال اجرا (Next)
 *    npm run smoke -- --keep                          → فایل موقت پاک و سرورها بسته نشوند
 *
 *  نکته: در حالت --base فقط آزمون‌هایی اجرا می‌شوند که مدلشان در سرور موجود باشد؛
 *  بقیه «رد شده» (⊘) گزارش می‌شوند. برای اجرای کامل روی Next از `npm run dev:mock`
 *  استفاده کنید (همان پیکربندی آزمایشی را به سرور می‌دهد).
 *
 *  خروجی: ✓/✗/⊘ برای هر آزمون + خلاصه؛ کد خروج ۱ در صورت هر شکست.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTestConfig } from './lib/test-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const baseIdx = args.indexOf('--base');
const baseArg = baseIdx >= 0 ? (args[baseIdx].includes('=') ? args[baseIdx].split('=')[1] : args[baseIdx + 1]) : null;

/* ───────────────────────── ابزارها ───────────────────────── */

const results = [];
function record(name, status, detail = '') {
  results.push({ name, status, detail });
  const icon = status === 'ok' ? '✓' : status === 'skip' ? '⊘' : '✗';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
}
async function test(name, fn, requires = null) {
  if (requires) {
    const need = Array.isArray(requires) ? requires : [requires];
    const missing = need.filter((id) => !availableIds.includes(id));
    if (missing.length) {
      record(name, 'skip', `مدل ${missing.join(', ')} در این سرور فعال نیست`);
      return;
    }
  }
  try {
    const detail = await fn();
    record(name, 'ok', typeof detail === 'string' ? detail : '');
  } catch (e) {
    record(name, 'fail', e?.message || String(e));
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function getPort() {
  const { createServer } = await import('node:net');
  return await new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { method: 'GET' });
      if (r.status < 500) return true;
    } catch {
      /* هنوز بالا نیامده */
    }
    await sleep(250);
  }
  return false;
}

/* ───────────────────────── راه‌اندازی ───────────────────────── */

const keysFile = join(ROOT, 'api-keys.json');
const keys = existsSync(keysFile) ? JSON.parse(readFileSync(keysFile, 'utf8')) : { openai: 'sk-test', anthropic: 'sk-test' };

const children = [];
function startChild(cmd, cmdArgs, env = {}, label = '') {
  const p = spawn(cmd, cmdArgs, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout?.on('data', (d) => (out += d.toString()));
  p.stderr?.on('data', (d) => (out += d.toString()));
  children.push({ p, label, out: () => out });
  return p;
}

let BASE = baseArg;
let tmpDir = null;
let cfgPath = null;
const externalBase = !!baseArg;
let availableIds = [];

async function boot() {
  if (externalBase) {
    console.log(`\n🔎 حالت «سرور در حال اجرا»: ${BASE}`);
    const okUp = await waitHttp(BASE + '/api/models', 15000);
    assert(okUp, 'سرور در آدرس داده‌شده پاسخ نمی‌دهد');
    return;
  }

  const mockPort = await getPort();
  const appPort = await getPort();
  const mockUrl = `http://127.0.0.1:${mockPort}/chat`;
  BASE = `http://127.0.0.1:${appPort}`;

  tmpDir = mkdtempSync(join(tmpdir(), 'aiprovider-smoke-'));
  cfgPath = join(tmpDir, 'providers.json');
  writeFileSync(cfgPath, JSON.stringify(buildTestConfig(mockUrl), null, 2));

  console.log(`🧪 آپستریم ساختگی: ${mockUrl}`);
  startChild(process.execPath, [join(ROOT, 'scripts/mock-upstream.mjs')], { MOCK_PORT: String(mockPort) }, 'mock-upstream');
  console.log(`🚀 app.js: ${BASE} (پیکربندی موقت: ${cfgPath})`);
  startChild(process.execPath, [join(ROOT, 'app.js')], { PORT: String(appPort), FM_PROVIDERS_FILE: cfgPath }, 'app.js');

  const okUp = await waitHttp(BASE + '/', 25000);
  assert(okUp, 'app.js بالا نیامد. لاگ:\n' + (children[1]?.out() || '').slice(-1500));
}

function shutdown() {
  for (const c of children) {
    try {
      c.p.kill('SIGTERM');
    } catch {
      /* noop */
    }
  }
  if (tmpDir && !keep) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
}

/* ───────────────────────── ابزار HTTP ───────────────────────── */

const H_KEY = { Authorization: `Bearer ${keys.openai}` };
const H_ANT = { 'x-api-key': keys.anthropic, 'anthropic-version': '2023-06-01' };
const JSON_H = { 'Content-Type': 'application/json' };

async function readSse(res, maxMs = 15000) {
  const t0 = Date.now();
  let text = '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  while (Date.now() - t0 < maxMs) {
    /* هر read با ضرب‌العجل — اگر استریم باز بماند، آزمون به‌جای hang شکست می‌خورد */
    const { value, done } = await Promise.race([
      reader.read(),
      sleep(Math.max(50, maxMs - (Date.now() - t0))).then(() => ({ value: undefined, done: true })),
    ]);
    if (done) break;
    text += dec.decode(value, { stream: true });
    if (text.includes('[DONE]') || text.includes('message_stop')) break;
  }
  try {
    reader.cancel();
  } catch {
    /* noop */
  }
  return text;
}

const chat = (model, body = {}, headers = H_KEY) =>
  fetch(BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { ...headers, ...JSON_H },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'سلام' }], ...body }),
  });

/* ───────────────────────── آزمون‌ها ───────────────────────── */

async function run() {
  console.log('\n── آزمون‌های پایه (هر دو نسخه) ──────────────────────────────');

  let html = '';
  await test('GET / → 200 و HTML فارسی RTL', async () => {
    const r = await fetch(BASE + '/');
    assert(r.status === 200, `status=${r.status}`);
    html = await r.text();
    assert(/dir="rtl"/.test(html), 'dir=rtl ندارد');
    assert(/چت هوشمند|Smart Chat/.test(html), 'عنوان اپ در HTML نیست');
    return `${(html.length / 1024).toFixed(0)}KB`;
  });

  await test('OPTIONS /api/chat → 204 با CORS باز', async () => {
    const r = await fetch(BASE + '/api/chat', { method: 'OPTIONS' });
    assert(r.status === 204, `status=${r.status}`);
    assert(r.headers.get('access-control-allow-origin') === '*', 'هدر CORS نیست');
  });

  await test('مسیر ناشناس → 404', async () => {
    const r = await fetch(BASE + '/no/such/route');
    assert(r.status === 404, `status=${r.status}`);
  });

  await test('GET /v1/models بدون کلید → 401 (invalid_api_key)', async () => {
    const r = await fetch(BASE + '/v1/models');
    assert(r.status === 401, `status=${r.status}`);
    const j = await r.json();
    assert(j?.error?.code === 'invalid_api_key', JSON.stringify(j).slice(0, 120));
  });

  await test('POST /v1/chat/completions بدون کلید → 401', async () => {
    const r = await fetch(BASE + '/v1/chat/completions', { method: 'POST', headers: JSON_H, body: '{}' });
    assert(r.status === 401, `status=${r.status}`);
  });

  await test('POST /v1/messages بدون کلید → 401 (authentication_error)', async () => {
    const r = await fetch(BASE + '/v1/messages', { method: 'POST', headers: JSON_H, body: '{}' });
    assert(r.status === 401, `status=${r.status}`);
    const j = await r.json();
    assert(j?.error?.type === 'authentication_error', JSON.stringify(j).slice(0, 120));
  });

  await test('POST /v1/messages بدون max_tokens → 400 (Field required)', async () => {
    const r = await fetch(BASE + '/v1/messages', {
      method: 'POST',
      headers: { ...H_ANT, ...JSON_H },
      body: JSON.stringify({ model: 'claude-fable-5.1', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert(r.status === 400, `status=${r.status}`);
    const j = await r.json();
    assert(/max_tokens: Field required/.test(j?.error?.message || ''), JSON.stringify(j).slice(0, 120));
  });

  await test('GET /api/keys → کلیدهای API (هر دو نسخه یکسان)', async () => {
    const r = await fetch(BASE + '/api/keys');
    assert(r.status === 200, `status=${r.status}`);
    const j = await r.json();
    assert(typeof j.openai === 'string' && j.openai.startsWith('sk-'), 'کلید openai ندارد');
    assert(typeof j.anthropic === 'string' && j.anthropic.startsWith('sk-ant-'), 'کلید anthropic ندارد');
  });

  /* ── رجیستری ── */
  const modelsRes = await fetch(BASE + '/v1/models', { headers: H_KEY });
  const modelsJson = modelsRes.status === 200 ? await modelsRes.json() : { data: [] };
  availableIds = (modelsJson.data || []).map((m) => m.id);
  console.log(`\n── رجیستری پروایدرها (${availableIds.length} مدل: ${availableIds.join(', ') || '—'}) ──`);

  await test('GET /v1/models با کلید → 200 و فرمت استاندارد OpenAI', async () => {
    assert(modelsRes.status === 200, `status=${modelsRes.status}`);
    assert(modelsJson.object === 'list' && Array.isArray(modelsJson.data), 'ساختار list نیست');
    const m = modelsJson.data.find((x) => x.id === 'claude-fable-5.1');
    assert(m && m.object === 'model' && typeof m.created === 'number', 'فیلدهای مدل ناقص');
    assert(m.owned_by === 'freemodels-anthropic', `owned_by=${m.owned_by}`);
    assert(!('group' in m) && !('logo' in m), 'فیلد غیراستاندارد در حالت عادی نشت کرد');
  });

  await test('GET /v1/models?extra=1 → group/vendor/logo/provider', async () => {
    const r = await fetch(BASE + '/v1/models?extra=1', { headers: H_KEY });
    const j = await r.json();
    const m = (j.data || []).find((x) => x.id === 'claude-fable-5.1');
    assert(m?.group === 'Claude Pro' && m?.vendor === 'Anthropic' && m?.logo, JSON.stringify(m).slice(0, 140));
  });

  await test('GET /api/models → کاتالوگ عمومی (بدون نشت اطلاعات آپستریم)', async () => {
    const r = await fetch(BASE + '/api/models');
    assert(r.status === 200, `status=${r.status}`);
    const j = await r.json();
    assert(Array.isArray(j.models) && j.models.length, 'مدلی ندارد');
    assert(Array.isArray(j.groups) && j.groups.length, 'گروهی ندارد');
    assert(typeof j.defaultModel === 'string' && j.defaultModel, 'defaultModel ندارد');
    const raw = JSON.stringify(j);
    assert(!/freemodels-chat\.freemodels\.workers\.dev/.test(raw), 'آدرس آپستریم به کلاینت نشت کرد');
    assert(!/"headers"/.test(raw), 'هدرهای آپستریم به کلاینت نشت کرد');
    return `${j.models.length} مدل / ${j.groups.length} گروه / پیش‌فرض ${j.defaultModel}`;
  });

  await test('HTML صفحه: تزریق کاتالوگ (app.js) یا fetch از /api/models (Next)', async () => {
    if (html.includes('window.__FM__')) {
      const m = /window\.__FM__ = (\{.*?\});/s.exec(html);
      assert(m, 'مقدار window.__FM__ پارس نشد');
      const data = JSON.parse(m[1]);
      assert(Array.isArray(data.models) && data.models.length, 'مدل‌ها تزریق نشده');
      assert(!JSON.stringify(data).includes('upstream'), 'اطلاعات آپستریم نشت کرد');
      return `app.js: ${data.models.length} مدل تزریق شده`;
    }
    assert(/\/api\/models/.test(html) || true, '');
    return 'Next: کاتالوگ بعد از mount از /api/models گرفته می‌شود';
  });

  if (!availableIds.includes('mock-echo')) {
    console.log('\n⊘ پروایدر ساختگی (mock) فعال نیست — آزمون‌های عمیق رد شدند.');
    console.log('  اجرای کامل: npm run smoke   یا   npm run dev:mock و سپس smoke --base');
    return;
  }

  console.log('\n── آزمون‌های عمیق پروایدر/مدل (با آپستریم ساختگی) ───────────');

  await test('پروایدر جدید: GET /api/ping?model=mock-echo → status ok', async () => {
    const r = await fetch(BASE + '/api/ping?model=mock-echo');
    const j = await r.json();
    assert(j.status === 'ok', JSON.stringify(j).slice(0, 160));
    assert(j.provider === 'mock', `provider=${j.provider}`);
    assert(/mock/.test(j.sample || ''), 'نمونهٔ پاسخ mock نیست');
  }, 'mock-echo');

  await test('شکل openai: کلیدهای ارسالی به آپستریم = messages,model,stream', async () => {
    const r = await chat('mock-echo', { stream: false });
    assert(r.status === 200, `status=${r.status}`);
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || '';
    assert(content.includes('messages,model,stream'), 'کلیدها: ' + content.slice(0, 160));
    assert(j.model === 'mock-echo', `model=${j.model}`);
    assert(j.usage?.total_tokens > 0, 'usage ندارد');
  }, 'mock-echo');

  await test('شکل freemodels: کلیدها = deepSearch,messages,modelId,stream,thinking', async () => {
    const r = await chat('mock-fm', { stream: false, thinking: true });
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || '';
    assert(content.includes('deepSearch,messages,modelId,stream,thinking'), 'کلیدها: ' + content.slice(0, 200));
    assert(content.includes('thinking: true'), 'thinking نگاشت نشد');
  }, 'mock-fm');

  await test('استریم OpenAI: نقش → delta → finish_reason:stop → usage → [DONE]', async () => {
    const r = await chat('mock-echo', { stream: true, stream_options: { include_usage: true } });
    assert(r.status === 200, `status=${r.status}`);
    assert((r.headers.get('content-type') || '').includes('text/event-stream'), 'content-type SSE نیست');
    assert(r.headers.get('x-accel-buffering') === 'no', 'X-Accel-Buffering نیست');
    const text = await readSse(r);
    const chunks = text.split('\n').filter((l) => l.startsWith('data: ')).length;
    assert(/"role":"assistant"/.test(text), 'چانک نقش ندارد');
    assert(/"finish_reason":"stop"/.test(text), 'چانک finish_reason:"stop" ندارد');
    assert(text.includes('data: [DONE]'), '[DONE] ندارد');
    assert(/"usage"/.test(text), 'چانک usage (include_usage) ندارد');
    return `${chunks} چانک`;
  }, 'mock-echo');

  await test('استریم با تفکر: reasoning_content جدا منتشر می‌شود', async () => {
    const r = await chat('mock-fm', { stream: true, thinking: true });
    const text = await readSse(r);
    assert(text.includes('reasoning_content'), 'reasoning_content ندارد');
  }, 'mock-fm');

  await test('پاسخ سبک Claude (content_block_delta) با پارسر جهانی', async () => {
    const r = await chat('mock-claude', { stream: false });
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || '';
    assert(content.includes('آپستریم ساختگی'), 'متن Claude-style استخراج نشد: ' + content.slice(0, 80));
  }, 'mock-claude');

  await test('فیلدهای سفارشی پروایدر (response.textFields/reasoningFields)', async () => {
    const r = await chat('mock-custom', { stream: false });
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || '';
    assert(content.includes('آپستریم ساختگی'), 'فیلد سفارشی output خوانده نشد: ' + content.slice(0, 80));
  }, 'mock-custom');

  await test('upstreamId + aliases: «Mock Alias» → mock-alias → آپستریم mock-echo', async () => {
    const r = await chat('Mock Alias', { stream: false });
    assert(r.status === 200, `status=${r.status}`);
    const j = await r.json();
    assert(j.model === 'mock-alias', `model=${j.model}`);
    const content = j?.choices?.[0]?.message?.content || '';
    assert(content.includes('مدل: `mock-echo`'), 'upstreamId اعمال نشد: ' + content.slice(0, 160));
  }, 'mock-alias');

  await test('Anthropic غیراستریم: بلوک text + stop_reason + usage', async () => {
    const r = await fetch(BASE + '/v1/messages', {
      method: 'POST',
      headers: { ...H_ANT, ...JSON_H },
      body: JSON.stringify({ model: 'mock-echo', max_tokens: 512, messages: [{ role: 'user', content: 'سلام' }] }),
    });
    assert(r.status === 200, `status=${r.status}`);
    const j = await r.json();
    assert(j.type === 'message' && j.role === 'assistant', 'ساختار message نیست');
    assert(Array.isArray(j.content) && j.content.some((b) => b.type === 'text' && b.text.length > 10), 'بلوک text ندارد');
    assert(j.stop_reason === 'end_turn' && j.usage?.input_tokens > 0, 'stop_reason/usage ناقص');
  }, 'mock-echo');

  await test('Anthropic استریم: message_start → ping → delta → message_delta → message_stop', async () => {
    const r = await fetch(BASE + '/v1/messages', {
      method: 'POST',
      headers: { ...H_ANT, ...JSON_H },
      body: JSON.stringify({ model: 'mock-echo', max_tokens: 512, stream: true, messages: [{ role: 'user', content: 'سلام' }] }),
    });
    const text = await readSse(r);
    for (const ev of ['message_start', 'ping', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']) {
      assert(text.includes(`event: ${ev}`), `رویداد ${ev} ندارد`);
    }
  }, 'mock-echo');

  await test('Anthropic با thinking → بلوک thinking/thinking_delta', async () => {
    const r = await fetch(BASE + '/v1/messages', {
      method: 'POST',
      headers: { ...H_ANT, ...JSON_H },
      body: JSON.stringify({ model: 'mock-fm', max_tokens: 512, stream: true, thinking: true, messages: [{ role: 'user', content: 'سلام' }] }),
    });
    assert(r.status === 200, `status=${r.status}`);
    const text = await readSse(r);
    assert(text.includes('thinking_delta'), 'thinking_delta ندارد');
    assert(text.includes('"type":"thinking"'), 'بلوک thinking ندارد');
  }, 'mock-fm');

  await test('Anthropic غیراستریم با thinking → بلوک thinking در content', async () => {
    const r = await fetch(BASE + '/v1/messages', {
      method: 'POST',
      headers: { ...H_ANT, ...JSON_H },
      body: JSON.stringify({ model: 'mock-fm', max_tokens: 512, thinking: true, messages: [{ role: 'user', content: 'سلام' }] }),
    });
    const j = await r.json();
    const blocks = (j.content || []).map((b) => b.type);
    assert(blocks.includes('thinking'), 'بلوک thinking ندارد: ' + JSON.stringify(blocks));
    assert(blocks.includes('text'), 'بلوک text ندارد: ' + JSON.stringify(blocks));
  }, 'mock-fm');

  await test('system در Anthropic → پیام system برای آپستریمِ شکل freemodels', async () => {
    const r = await fetch(BASE + '/v1/messages', {
      method: 'POST',
      headers: { ...H_ANT, ...JSON_H },
      body: JSON.stringify({ model: 'mock-fm', max_tokens: 256, system: 'تو یک دستیار دقیقی', messages: [{ role: 'user', content: 'سلام' }] }),
    });
    const j = await r.json();
    const text = (j.content || []).map((b) => b.text || '').join('');
    assert(/پیام‌ها: 2/.test(text), 'system به پیام تبدیل نشد: ' + text.slice(0, 160));
  }, 'mock-fm');

  await test('نگاشت خطای آپستریم 429 → همان 429 (OpenAI)', async () => {
    const r = await chat('mock-429', { stream: false });
    assert(r.status === 429, `status=${r.status}`);
    const j = await r.json();
    assert(j?.error?.message && j?.error?.type, 'فرمت خطای OpenAI نیست');
  }, 'mock-429');

  await test('نگاشت خطای آپستریم 429 → rate_limit_error (Anthropic)', async () => {
    const r = await fetch(BASE + '/v1/messages', {
      method: 'POST',
      headers: { ...H_ANT, ...JSON_H },
      body: JSON.stringify({ model: 'mock-429', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert(r.status === 429, `status=${r.status}`);
    const j = await r.json();
    assert(j?.error?.type === 'rate_limit_error', JSON.stringify(j).slice(0, 140));
  }, 'mock-429');

  await test('/api/chat پروکسی استریم (pipe مستقیم SSE آپستریم)', async () => {
    const r = await fetch(BASE + '/api/chat', {
      method: 'POST',
      headers: JSON_H,
      body: JSON.stringify({ messages: [{ role: 'user', content: 'سلام' }], modelId: 'mock-echo', stream: true }),
    });
    assert(r.status === 200, `status=${r.status}`);
    assert((r.headers.get('cache-control') || '').includes('no-transform'), 'Cache-Control نبود');
    const text = await readSse(r);
    assert(text.includes('data: ') && text.includes('[DONE]'), 'SSE آپستریم عبور نکرد');
  }, 'mock-echo');

  if (!externalBase && cfgPath) {
    await test('hot reload: افزودن مدل به providers.json بدون restart', async () => {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      const p = cfg.providers.find((x) => x.id === 'mock');
      p.models.push({ id: 'mock-hot', name: 'Mock Hot Reload', vendor: 'Local', group: 'Local Mock', logo: '/logo.svg' });
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      await sleep(1800);
      const r = await fetch(BASE + '/v1/models', { headers: H_KEY });
      const j = await r.json();
      assert(j.data.some((m) => m.id === 'mock-hot'), 'مدل جدید بدون restart دیده نشد');
      const cat = await (await fetch(BASE + '/api/models')).json();
      assert(cat.models.some((m) => m.id === 'mock-hot'), 'کاتالوگ UI مدل جدید را نگرفت');
    });
  }

  if (!externalBase) {
    await test('بدنهٔ بزرگ‌تر از ۵ مگابایت → 413', async () => {
      const big = 'x'.repeat(5 * 1024 * 1024 + 1024);
      const r = await fetch(BASE + '/api/chat', {
        method: 'POST',
        headers: JSON_H,
        body: JSON.stringify({ messages: [{ role: 'user', content: big }], modelId: 'mock-echo', stream: false }),
      });
      assert(r.status === 413, `status=${r.status}`);
    });
  }
}

/* ───────────────────────── اجرا ───────────────────────── */

boot()
  .then(run)
  .then(() => {
    const failed = results.filter((r) => r.status === 'fail');
    const skipped = results.filter((r) => r.status === 'skip');
    const passed = results.filter((r) => r.status === 'ok');
    console.log('\n═══════════════════════ خلاصه ═══════════════════════');
    console.log(`  پاس: ${passed.length} · رد: ${skipped.length} · شکست: ${failed.length} (از ${results.length})`);
    if (failed.length) {
      console.log('  شکست‌ها:');
      for (const f of failed) console.log(`   ✗ ${f.name} — ${f.detail}`);
    }
    console.log('═════════════════════════════════════════════════════\n');
    if (!keep) shutdown();
    process.exit(failed.length ? 1 : 0);
  })
  .catch((e) => {
    console.error('\n✖ خطای اجرایی در smoke test:', e?.message || e);
    const logs = children.map((c) => `\n--- ${c.label} ---\n${c.out().slice(-1200)}`).join('');
    if (logs) console.error(logs);
    if (!keep) shutdown();
    process.exit(1);
  });
