/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  چت هوشمند — نسخهٔ Cloudflare Workers / Cloudflare Pages
 * ─────────────────────────────────────────────────────────────────────────────
 *  این فایل همان اپ `app.js` است، اما روی رانتایم Workers (workerd) با Fetch API.
 *  برای اینکه منطق دوقلو نشود، همهٔ بخش‌های «خالص» از خودِ `app.js` ایمپورت می‌شوند:
 *    • HTML/CSS/JS رابط چت  → buildPageHtml()
 *    • لیست مدل‌ها و resolveModelId
 *    • پارسر SSE سمت سرور    → makeUpstreamParser / collectUpstreamText
 *    • هدرهای جعلی آپستریم، CORS، سقف حجم بدنه
 *  بنابراین تغییر در UI یا مدل‌ها خودش در نسخهٔ Worker هم اعمال می‌شود.
 *
 *  تفاوت‌های اصلی با نسخهٔ Node:
 *    • به‌جای `node:http` از `export default { fetch }` استفاده می‌شود.
 *    • به‌جای `https.request` از `fetch` رانتایم Workers (اتصال Worker→Worker).
 *    • فایل `api-keys.json` وجود ندارد؛ کلیدها از Secret/KV می‌آیند:
 *        OPENAI_API_KEY / ANTHROPIC_API_KEY  (Secret)
 *        یا KV با نام بایندینگ API_KEYS (کلیدِ `api-keys`) تا پایدار بماند
 *      اگر هیچ‌کدام نباشد، کلید تصادفی «موقتی» برای همان ایزوله ساخته می‌شود.
 *    • EXPOSE_KEYS به‌صورت پیش‌فرض `false` است (استقرار عمومی = کلیدها ماسک).
 *
 *  روت‌ها (دقیقاً مثل app.js):
 *    GET  /                    → UI چت
 *    GET  /healthz | /health   → سلامت سبک (بدون تماس با آپستریم)
 *    POST /api/chat            → پروکسی استریم به آپستریم (SSE زنده)
 *    GET  /api/ping            → تست اتصال به آپستریم
 *    GET  /v1/models           → لیست مدل‌ها (OpenAI — عمومی)
 *    POST /v1/chat/completions → سازگار OpenAI   (Authorization: Bearer)
 *    POST /v1/messages         → سازگار Anthropic (x-api-key)
 *    OPTIONS *                 → 204 با CORS باز
 *    بقیه                      → 404
 *
 *  متغیرها (wrangler.jsonc ▸ vars یا `wrangler secret put`):
 *    UPSTREAM_URL   آدرس آپستریم (پیش‌فرض: همان freemodels)
 *    EXPOSE_KEYS    نمایش کلیدها در UI (پیش‌فرض false)
 *    OPENAI_API_KEY / ANTHROPIC_API_KEY  → Secret
 *    API_KEYS       → بایندینگ KV (اختیاری، برای پایداری کلیدها)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import shared from '../app.js';

const {
  buildPageHtml,
  serverDataJson,
  EMBEDDED_LOGOS,
  FM_MODELS,
  DEFAULT_MODEL_ID,
  BOOT_AT,
  resolveModelId,
  UPSTREAM_URL: DEFAULT_UPSTREAM_URL,
  UPSTREAM_TIMEOUT_MS,
  MAX_BODY_BYTES,
  SPOOFED_HEADERS,
  OPEN_CORS,
  makeUpstreamParser,
  collectUpstreamText,
  flattenContent,
  maskKey,
  isUsableKey,
} = shared;

/* ⚠️ نکتهٔ workerd: در زمان ارزیابی ماژول، `Date.now()` مقدار ۰ می‌دهد!
   پس سن ایزوله و فیلد `created` را تنبل (در اولین درخواست) محاسبه می‌کنیم. */
let STARTED_AT = 0;
let MODELS_CREATED_AT = 0;
function isolateAgeSec() {
  const now = Date.now();
  if (!STARTED_AT) STARTED_AT = now;
  return Math.round((now - STARTED_AT) / 1000);
}
function modelsCreatedAt() {
  if (!MODELS_CREATED_AT) MODELS_CREATED_AT = BOOT_AT || Math.floor(Date.now() / 1000);
  return MODELS_CREATED_AT;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ───────────────────────── ابزارهای کوچک ───────────────────────── */

function log(msg) {
  console.log('[smart-chat] ' + msg);
}

/** تولید توکن تصادفی با Web Crypto (بدون وابستگی به node:crypto) */
function randToken(len, alphabet) {
  const abc = alphabet || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < len; i++) s += abc[bytes[i] % abc.length];
  return s;
}

function byteLen(s) {
  return enc.encode(String(s)).length;
}

function jsonResponse(status, obj, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, OPEN_CORS, extraHeaders || {}),
  });
}

/* ───────────────────────── کلیدهای API ─────────────────────────
   ترتیب اولویت:  Secret → KV → تصادفیِ موقتی (per-isolate)
   نتیجه کش می‌شود تا هر درخواست به KV نرویم. */
const KEY_CACHE = { sig: '', keys: null, source: '' };

async function getKeys(env) {
  const envOpen = String(env.OPENAI_API_KEY || '').trim();
  const envAnt = String(env.ANTHROPIC_API_KEY || '').trim();
  const sig = envOpen + '\u0000' + envAnt + '\u0000' + (env.API_KEYS ? 'kv' : 'no-kv');
  if (KEY_CACHE.keys && KEY_CACHE.sig === sig) return KEY_CACHE;

  let keys = null;
  let source = 'ephemeral';

  if (isUsableKey(envOpen) && isUsableKey(envAnt)) {
    keys = { openai: envOpen, anthropic: envAnt };
    source = 'secret';
  } else if (env.API_KEYS && typeof env.API_KEYS.get === 'function') {
    try {
      const stored = await env.API_KEYS.get('api-keys', 'json');
      if (stored && isUsableKey(stored.openai) && isUsableKey(stored.anthropic)) {
        keys = { openai: stored.openai, anthropic: stored.anthropic };
        source = 'kv';
      }
    } catch (e) {
      log('KV خوانده نشد: ' + ((e && e.message) || e));
    }
    if (!keys) {
      keys = {
        openai: isUsableKey(envOpen) ? envOpen : 'sk-' + randToken(48),
        anthropic: isUsableKey(envAnt) ? envAnt : 'sk-ant-api03-' + randToken(88),
      };
      source = 'kv-generated';
      try {
        await env.API_KEYS.put('api-keys', JSON.stringify(Object.assign({ createdAt: new Date().toISOString() }, keys)));
      } catch (e) {
        log('KV نوشته نشد: ' + ((e && e.message) || e));
        source = 'ephemeral';
      }
    }
  }

  if (!keys) {
    /* بدون Secret و بدون KV — فقط برای `wrangler dev` یا تست سریع مناسب است */
    keys = {
      openai: isUsableKey(envOpen) ? envOpen : 'sk-' + randToken(48),
      anthropic: isUsableKey(envAnt) ? envAnt : 'sk-ant-api03-' + randToken(88),
    };
    source = 'ephemeral';
    log('⚠️ کلیدها موقتی‌اند (هر ایزوله یکی می‌سازد). برای کلید پایدار: wrangler secret put OPENAI_API_KEY / ANTHROPIC_API_KEY');
    log('   OPENAI_API_KEY=' + keys.openai);
    log('   ANTHROPIC_API_KEY=' + keys.anthropic);
  }

  KEY_CACHE.sig = sig;
  KEY_CACHE.keys = keys;
  KEY_CACHE.source = source;
  return KEY_CACHE;
}

function keyIsValid(k, keys) {
  return !!k && !!keys && (k === keys.openai || k === keys.anthropic);
}

/** در Worker پیش‌فرض «ماسک» است — برعکس نسخهٔ محلی Node */
function keysExposed(env) {
  const v = String(env.EXPOSE_KEYS == null ? '' : env.EXPOSE_KEYS).trim().toLowerCase();
  if (!v) return false;
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/* ───────────────────────── HTML صفحه ─────────────────────────
   یک‌بار برای هر (کلیدها، exposed) ساخته و کش می‌شود. */
const HTML_CACHE = new Map();

function pageHtmlFor(keys, exposed) {
  const sig = (exposed ? '1' : '0') + '|' + keys.openai + '|' + keys.anthropic;
  let html = HTML_CACHE.get(sig);
  if (!html) {
    html = buildPageHtml(serverDataJson(keys, exposed));
    HTML_CACHE.set(sig, html);
  }
  return html;
}

/* ───────────────────────── آپستریم ───────────────────────── */

function upstreamUrl(env) {
  const v = String(env.UPSTREAM_URL || '').trim();
  return v || DEFAULT_UPSTREAM_URL;
}

/** هدرهای جعلی مرورگر — Content-Length و Accept-Encoding را رانتایم خودش می‌گذارد */
function upstreamHeaders() {
  const h = {};
  for (const [k, v] of Object.entries(SPOOFED_HEADERS)) {
    const lk = k.toLowerCase();
    if (lk === 'content-length' || lk === 'accept-encoding') continue;
    h[k] = v;
  }
  return h;
}

/**
 * POST به آپستریم؛ به‌محض رسیدن هدرها resolve می‌شود تا بدنه استریم شود.
 * اگر کلاینت قطع شود (req.signal) یا تایم‌اوت برسد، درخواست آپستریم abort می‌شود.
 */
async function openUpstream(env, bodyStr, opts) {
  const o = opts || {};
  const timeoutMs = o.timeoutMs || UPSTREAM_TIMEOUT_MS;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      ctrl.abort();
    } catch (e) {
      /* noop */
    }
  }, timeoutMs);

  const onClientAbort = () => {
    try {
      ctrl.abort();
    } catch (e) {
      /* noop */
    }
  };
  if (o.signal) {
    if (o.signal.aborted) onClientAbort();
    else o.signal.addEventListener('abort', onClientAbort, { once: true });
  }

  try {
    const res = await fetch(upstreamUrl(env), {
      method: 'POST',
      headers: upstreamHeaders(),
      body: bodyStr,
      signal: ctrl.signal,
    });
    return {
      status: res.status,
      headers: res.headers,
      body: res.body,
      timedOut: () => timedOut,
      finish() {
        clearTimeout(timer);
        if (o.signal) o.signal.removeEventListener('abort', onClientAbort);
      },
      cancel() {
        clearTimeout(timer);
        if (o.signal) o.signal.removeEventListener('abort', onClientAbort);
        try {
          ctrl.abort();
        } catch (e) {
          /* noop */
        }
      },
    };
  } catch (e) {
    clearTimeout(timer);
    if (o.signal) o.signal.removeEventListener('abort', onClientAbort);
    const err = new Error(timedOut ? 'UPSTREAM_TIMEOUT — پاسخ آپستریم بیش از حد طول کشید' : (e && e.message) || String(e));
    err.timedOut = timedOut;
    throw err;
  }
}

/** خواندن کامل بدنهٔ آپستریم به رشته (با سقف) */
async function readBodyText(body, cap) {
  if (!body) return '';
  const reader = body.getReader();
  let s = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      s += dec.decode(value, { stream: true });
      if (s.length > cap) {
        try {
          await reader.cancel();
        } catch (e) {
          /* noop */
        }
        break;
      }
    }
  } catch (e) {
    /* استریم نصفه بسته شد — همان‌چه داریم برمی‌گردانیم */
  }
  return s;
}

/** خواندن بدنهٔ درخواست کلاینت با سقف حجم */
async function readRequestBody(req, limit) {
  const declared = Number(req.headers.get('content-length') || '0');
  if (declared > limit) return { data: '', tooLarge: true };
  const text = await req.text();
  if (byteLen(text) > limit) return { data: '', tooLarge: true };
  return { data: text, tooLarge: false };
}

/* ───────────────────────── روت‌ها ───────────────────────── */

function handleHome(env) {
  const exposed = keysExposed(env);
  return getKeys(env).then(({ keys }) =>
    new Response(pageHtmlFor(keys, exposed), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  );
}

function handleLogo(entry) {
  const bytes = Uint8Array.from(atob(entry.b64), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': entry.mime, 'Cache-Control': 'public, max-age=604800' },
  });
}

function handleHealthz(env, keysInfo, headOnly) {
  const body = JSON.stringify({
    status: 'ok',
    service: 'smart-chat',
    runtime: 'cloudflare-worker',
    uptimeSec: isolateAgeSec(),
    models: FM_MODELS.length,
    defaultModel: DEFAULT_MODEL_ID,
    upstream: upstreamUrl(env),
    keysExposed: keysExposed(env),
    keysSource: keysInfo ? keysInfo.source : 'unknown',
    timestamp: new Date().toISOString(),
  });
  if (headOnly) {
    return new Response(null, {
      status: 200,
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
  }
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/* ---------- POST /api/chat — پروکسی استریم (بدون بافر) ---------- */
async function handleChat(env, req) {
  const started = Date.now();
  const body = await readRequestBody(req, MAX_BODY_BYTES);
  if (body.tooLarge) return jsonResponse(413, { error: { message: 'حجم درخواست بیش از حد مجاز (۵ مگابایت) است.' } });

  /* نرمال‌سازی modelId — همان رفتار app.js */
  let bodyOut = body.data;
  try {
    const j = JSON.parse(body.data);
    if (j && typeof j === 'object' && 'modelId' in j) {
      j.modelId = resolveModelId(j.modelId);
      bodyOut = JSON.stringify(j);
    }
  } catch (e) {
    /* بدنه غیر JSON — خام عبور می‌کند */
  }

  let up;
  try {
    up = await openUpstream(env, bodyOut, { signal: req.signal });
  } catch (err) {
    const msg = (err && err.message) || String(err);
    log('POST /api/chat ✖ ' + msg);
    return jsonResponse(err.timedOut ? 504 : 502, {
      error: {
        message: err.timedOut
          ? 'پاسخ آپستریم بیش از حد طول کشید (۱۸۰ ثانیه).'
          : 'اتصال به سرویس چت برقرار نشد: ' + msg,
      },
    });
  }

  const outHeaders = {};
  up.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (lk.startsWith('access-control-')) return;
    if (lk === 'transfer-encoding' || lk === 'content-encoding' || lk === 'content-length') return;
    if (lk === 'connection' || lk === 'keep-alive') return;
    outHeaders[k] = v;
  });
  outHeaders['Cache-Control'] = 'no-cache, no-transform';
  outHeaders['X-Accel-Buffering'] = 'no';

  log('POST /api/chat ← آپستریم ' + up.status + ' (' + (Date.now() - started) + 'ms تا هدرها)');

  /* پاس‌دادن مستقیم استریم — Workers خودش backpressure را مدیریت می‌کند */
  if (up.status === 204 || up.status === 205 || up.status === 304) {
    up.finish();
    return new Response(null, { status: up.status, headers: outHeaders });
  }
  return new Response(up.body, { status: up.status, headers: outHeaders });
}

/* ---------- GET /api/ping ---------- */
async function handlePing(env, req) {
  const started = Date.now();
  const payload = JSON.stringify({
    messages: [{ role: 'user', content: 'ping' }],
    modelId: DEFAULT_MODEL_ID,
    thinking: false,
    deepSearch: false,
    stream: false,
  });
  try {
    const up = await openUpstream(env, payload, { timeoutMs: 20_000, signal: req.signal });
    const text = await readBodyText(up.body, 200_000);
    up.finish();
    const ms = Date.now() - started;
    let sample = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      if (j && typeof j === 'object' && 'error' in j) {
        const er = j.error;
        sample = typeof er === 'string' ? er : String((er && er.message != null ? er.message : JSON.stringify(er)));
      } else if (j && typeof j.content === 'string') sample = j.content;
      else if (j && typeof j.text === 'string') sample = j.text;
      else if (j && Array.isArray(j.choices)) {
        const c = j.choices[0];
        if (c && c.message && typeof c.message.content === 'string') sample = c.message.content;
      }
    } catch (e) {
      /* JSON نبود — همان متن خام */
    }
    return jsonResponse(200, { status: 'ok', ms, sample: String(sample).slice(0, 200) });
  } catch (err) {
    const ms = Date.now() - started;
    const msg = (err && err.message) || String(err);
    log('GET /api/ping ✖ ' + msg);
    return jsonResponse(200, { status: 'error', ms, sample: msg.slice(0, 200) });
  }
}

/* ---------- GET /v1/models ---------- */
function handleModels() {
  return jsonResponse(200, {
    object: 'list',
    data: FM_MODELS.map((m) => ({
      id: m.id,
      object: 'model',
      created: modelsCreatedAt(),
      owned_by: 'freemodels-' + m.vendor.toLowerCase().replace(/\s+/g, '-'),
    })),
  });
}

/* ---------- ابزارهای مشترک /v1 ---------- */
const SSE_HEADERS = Object.assign(
  {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  },
  OPEN_CORS
);

function openaiError(status, message, code) {
  return jsonResponse(status, {
    error: {
      message,
      type: status === 401 ? 'invalid_request_error' : status >= 500 ? 'api_error' : 'invalid_request_error',
      param: null,
      code: code == null ? null : code,
    },
  });
}

function anthropicError(status, type, message) {
  return jsonResponse(status, { type: 'error', error: { type, message } });
}

function randHex(bytes) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * ساختن Response استریم SSE.
 * `run(write, close)` بدنه را می‌نویسد؛ اگر کلاینت قطع شود `cancel` صدا زده می‌شود.
 */
function sseResponse(run) {
  let cancelHook = null;
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const write = (s) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch (e) {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch (e) {
          /* noop */
        }
      };
      return Promise.resolve()
        .then(() => run(write, close, (fn) => (cancelHook = fn)))
        .catch((e) => {
          log('SSE ✖ ' + ((e && e.message) || e));
          close();
        });
    },
    cancel() {
      if (typeof cancelHook === 'function') {
        try {
          cancelHook();
        } catch (e) {
          /* noop */
        }
      }
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

/* ---------- POST /v1/chat/completions ---------- */
async function handleOpenAI(env, req) {
  const started = Date.now();
  const { keys } = await getKeys(env);
  const auth = req.headers.get('authorization') || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!keyIsValid(bearer ? bearer[1].trim() : null, keys)) return openaiError(401, 'کلید API نامعتبر است (هدر Authorization: Bearer).', 'invalid_api_key');

  const body = await readRequestBody(req, MAX_BODY_BYTES);
  if (body.tooLarge) return openaiError(413, 'حجم درخواست بیش از حد مجاز (۵ مگابایت) است.');
  let parsed;
  try {
    parsed = JSON.parse(body.data || '{}');
  } catch (e) {
    return openaiError(400, 'بدنهٔ JSON نامعتبر است.');
  }

  const upstreamMsgs = [];
  for (const m of Array.isArray(parsed.messages) ? parsed.messages : []) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' || m.role === 'system' ? m.role : 'user';
    const content = flattenContent(m.content);
    if (content) upstreamMsgs.push({ role, content });
  }
  if (!upstreamMsgs.length) return openaiError(400, 'messages باید آرایه‌ای غیرخالی از پیام‌ها باشد.');

  const model = resolveModelId(parsed.model);
  const wantStream = !!parsed.stream;
  const payload = {
    messages: upstreamMsgs,
    modelId: model,
    thinking: parsed.thinking === true,
    deepSearch: parsed.deep_search === true,
    stream: wantStream,
  };
  const promptChars = upstreamMsgs.reduce((n, m) => n + m.content.length, 0);
  const estIn = Math.max(1, Math.ceil(promptChars / 4));
  const id = 'chatcmpl-' + randHex(10);
  const created = Math.floor(Date.now() / 1000);

  /* ── غیراستریم ── */
  if (!wantStream) {
    let up;
    try {
      up = await openUpstream(env, JSON.stringify(payload), { signal: req.signal });
    } catch (err) {
      const msg = (err && err.message) || String(err);
      log('POST /v1/chat/completions ✖ ' + msg);
      return openaiError(err.timedOut ? 504 : 502, 'اتصال به سرویس چت برقرار نشد: ' + msg);
    }
    if (up.status >= 400) {
      const txt = await readBodyText(up.body, 4000);
      up.cancel();
      return openaiError(up.status, 'خطای سرویس چت (HTTP ' + up.status + '): ' + txt.trim().slice(0, 300));
    }
    const full = await readBodyText(up.body, 8 * 1024 * 1024);
    up.finish();
    const acc = collectUpstreamText(full);
    const content = acc.text || acc.reasoning || '⚠️ پاسخ خالی از سرور دریافت شد.';
    const estOut = Math.max(1, Math.ceil(content.length / 4));
    log('POST /v1/chat/completions → 200 (' + (Date.now() - started) + 'ms · ' + content.length + ' کاراکتر)');
    return jsonResponse(200, {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{ index: 0, message: { role: 'assistant', content }, logprobs: null, finish_reason: 'stop' }],
      usage: { prompt_tokens: estIn, completion_tokens: estOut, total_tokens: estIn + estOut },
    });
  }

  /* ── استریم SSE ── */
  const includeUsage = !!(parsed.stream_options && parsed.stream_options.include_usage);
  return sseResponse(async (write, close, onCancel) => {
    let outChars = 0;
    let gotText = false;
    let gotReasoning = false;
    let finished = false;
    let up = null;

    onCancel(() => {
      finished = true;
      if (up) up.cancel();
    });

    const chunk = (delta, finish) => {
      if (finished) return;
      write(
        'data: ' +
          JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta, finish_reason: finish == null ? null : finish }],
          }) +
          '\n\n'
      );
    };
    const endStream = () => {
      if (finished) return;
      finished = true;
      chunk({}, 'stop');
      if (includeUsage) {
        const estOut = Math.max(1, Math.ceil(outChars / 4));
        write(
          'data: ' +
            JSON.stringify({
              id,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [],
              usage: { prompt_tokens: estIn, completion_tokens: estOut, total_tokens: estIn + estOut },
            }) +
            '\n\n'
        );
      }
      write('data: [DONE]\n\n');
      close();
      if (up) up.finish();
      log('POST /v1/chat/completions → استریم تمام شد (' + (Date.now() - started) + 'ms · ' + outChars + ' کاراکتر)');
    };

    const parser = makeUpstreamParser((d) => {
      if (d.error) {
        chunk({ content: '\n\n⚠️ ' + d.error });
        return;
      }
      if (d.reasoning) {
        gotReasoning = true;
        chunk({ reasoning_content: d.reasoning });
      }
      if (d.text) {
        gotText = true;
        outChars += d.text.length;
        chunk({ content: d.text });
      }
    });

    try {
      up = await openUpstream(env, JSON.stringify(payload), { signal: req.signal });
    } catch (err) {
      chunk({ content: '⚠️ اتصال به سرویس چت برقرار نشد: ' + ((err && err.message) || err) });
      endStream();
      return;
    }
    if (up.status >= 400) {
      const txt = await readBodyText(up.body, 4000);
      up.cancel();
      chunk({ content: '⚠️ خطای سرویس چت (HTTP ' + up.status + '): ' + txt.trim().slice(0, 200) });
      finished = false; // endStream باید اجرا شود
      endStream();
      return;
    }

    write(': connected\n\n');
    chunk({ role: 'assistant', content: '' });

    try {
      const reader = up.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(dec.decode(value, { stream: true }));
        if (finished) break; // کلاینت رفته
      }
    } catch (e) {
      /* استریم قطع شد */
    }
    parser.end();
    if (!gotText && !gotReasoning) chunk({ content: '⚠️ پاسخ خالی از سرور دریافت شد.' });
    endStream();
  });
}

/* ---------- POST /v1/messages (Anthropic) ---------- */
async function handleAnthropic(env, req) {
  const started = Date.now();
  const { keys } = await getKeys(env);
  const apiKey = (req.headers.get('x-api-key') || '').trim();
  const auth = req.headers.get('authorization') || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth.trim());
  const key = apiKey || (bearer ? bearer[1].trim() : null);
  if (!keyIsValid(key, keys)) return anthropicError(401, 'authentication_error', 'کلید API نامعتبر است (هدر x-api-key).');

  const body = await readRequestBody(req, MAX_BODY_BYTES);
  if (body.tooLarge) return anthropicError(413, 'invalid_request_error', 'حجم درخواست بیش از حد مجاز (۵ مگابایت) است.');
  let parsed;
  try {
    parsed = JSON.parse(body.data || '{}');
  } catch (e) {
    return anthropicError(400, 'invalid_request_error', 'بدنهٔ JSON نامعتبر است.');
  }
  if (!parsed.model || typeof parsed.model !== 'string') return anthropicError(400, 'invalid_request_error', 'model: Field required');
  if (typeof parsed.max_tokens !== 'number') return anthropicError(400, 'invalid_request_error', 'max_tokens: Field required');

  const upstreamMsgs = [];
  let sysText = '';
  if (typeof parsed.system === 'string') sysText = parsed.system;
  else if (Array.isArray(parsed.system)) sysText = parsed.system.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
  if (sysText.trim()) upstreamMsgs.push({ role: 'system', content: sysText.trim() });
  for (const m of Array.isArray(parsed.messages) ? parsed.messages : []) {
    if (!m || typeof m !== 'object') continue;
    const content = flattenContent(m.content);
    if (content) upstreamMsgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
  }
  if (!upstreamMsgs.length) return anthropicError(400, 'invalid_request_error', 'messages: at least one message is required');

  const model = resolveModelId(parsed.model);
  const wantStream = !!parsed.stream;
  const payload = {
    messages: upstreamMsgs,
    modelId: model,
    thinking: parsed.thinking === true,
    deepSearch: false,
    stream: wantStream,
  };
  const promptChars = upstreamMsgs.reduce((n, m) => n + m.content.length, 0);
  const estIn = Math.max(1, Math.ceil(promptChars / 4));
  const msgId = 'msg_' + randHex(10);

  /* ── غیراستریم ── */
  if (!wantStream) {
    let up;
    try {
      up = await openUpstream(env, JSON.stringify(payload), { signal: req.signal });
    } catch (err) {
      const msg = (err && err.message) || String(err);
      log('POST /v1/messages ✖ ' + msg);
      return anthropicError(err.timedOut ? 504 : 502, 'api_error', 'اتصال به سرویس چت برقرار نشد: ' + msg);
    }
    if (up.status >= 400) {
      const txt = await readBodyText(up.body, 4000);
      up.cancel();
      return anthropicError(up.status, up.status === 429 ? 'rate_limit_error' : 'api_error', 'خطای سرویس چت (HTTP ' + up.status + '): ' + txt.trim().slice(0, 300));
    }
    const full = await readBodyText(up.body, 8 * 1024 * 1024);
    up.finish();
    const acc = collectUpstreamText(full);
    const blocks = [];
    if (acc.reasoning) blocks.push({ type: 'thinking', thinking: acc.reasoning });
    blocks.push({ type: 'text', text: acc.text || (acc.error ? '⚠️ ' + acc.error : '') });
    if (!acc.text && !acc.reasoning && !acc.error) blocks.push({ type: 'text', text: '⚠️ پاسخ خالی از سرور دریافت شد.' });
    log('POST /v1/messages → 200 (' + (Date.now() - started) + 'ms)');
    return jsonResponse(200, {
      id: msgId,
      type: 'message',
      role: 'assistant',
      model,
      content: blocks,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: estIn, output_tokens: Math.max(1, Math.ceil((acc.text || '').length / 4)) },
    });
  }

  /* ── استریم SSE به سبک Anthropic ── */
  return sseResponse(async (write, close, onCancel) => {
    let blockIdx = -1;
    let blockType = null;
    let outChars = 0;
    let gotAny = false;
    let finished = false;
    let up = null;

    onCancel(() => {
      finished = true;
      if (up) up.cancel();
    });

    const ev = (name, obj) => {
      if (finished && name !== 'message_stop') {
        /* همچنان allow — ساده نگه داشته شد */
      }
      write('event: ' + name + '\ndata: ' + JSON.stringify(obj) + '\n\n');
    };
    const closeBlock = () => {
      if (blockType) {
        ev('content_block_stop', { type: 'content_block_stop', index: blockIdx });
        blockType = null;
      }
    };
    const openBlock = (t) => {
      if (blockType === t) return;
      closeBlock();
      blockIdx++;
      blockType = t;
      ev('content_block_start', {
        type: 'content_block_start',
        index: blockIdx,
        content_block: t === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' },
      });
    };
    const endStream = () => {
      if (finished) return;
      finished = true;
      closeBlock();
      ev('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: Math.max(1, Math.ceil(outChars / 4)) },
      });
      ev('message_stop', { type: 'message_stop' });
      close();
      if (up) up.finish();
      log('POST /v1/messages → استریم تمام شد (' + (Date.now() - started) + 'ms · ' + outChars + ' کاراکتر)');
    };

    const parser = makeUpstreamParser((d) => {
      if (d.error) {
        openBlock('text');
        ev('content_block_delta', { type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: '\n\n⚠️ ' + d.error } });
        return;
      }
      if (d.reasoning) {
        gotAny = true;
        openBlock('thinking');
        ev('content_block_delta', { type: 'content_block_delta', index: blockIdx, delta: { type: 'thinking_delta', thinking: d.reasoning } });
      }
      if (d.text) {
        gotAny = true;
        openBlock('text');
        outChars += d.text.length;
        ev('content_block_delta', { type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: d.text } });
      }
    });

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

    try {
      up = await openUpstream(env, JSON.stringify(payload), { signal: req.signal });
    } catch (err) {
      openBlock('text');
      ev('content_block_delta', { type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: '⚠️ اتصال به سرویس چت برقرار نشد: ' + ((err && err.message) || err) } });
      endStream();
      return;
    }
    if (up.status >= 400) {
      const txt = await readBodyText(up.body, 4000);
      up.cancel();
      up = null;
      openBlock('text');
      ev('content_block_delta', { type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: '⚠️ خطای سرویس چت (HTTP ' + txt.trim().slice(0, 200) + ')' } });
      endStream();
      return;
    }

    try {
      const reader = up.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(dec.decode(value, { stream: true }));
        if (finished) break;
      }
    } catch (e) {
      /* استریم قطع شد */
    }
    parser.end();
    if (!gotAny) {
      openBlock('text');
      ev('content_block_delta', { type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: '⚠️ پاسخ خالی از سرور دریافت شد.' } });
    }
    endStream();
  });
}

/* ───────────────────────── روتر ───────────────────────── */

const worker = {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: OPEN_CORS });

      if (method === 'GET' && (path === '/' || path === '/index.html')) return await handleHome(env);

      if (method === 'GET' && EMBEDDED_LOGOS[path]) return handleLogo(EMBEDDED_LOGOS[path]);

      if ((method === 'GET' || method === 'HEAD') && (path === '/healthz' || path === '/health')) {
        const info = await getKeys(env);
        return handleHealthz(env, info, method === 'HEAD');
      }

      if (method === 'POST' && path === '/api/chat') return await handleChat(env, req);
      if (method === 'GET' && path === '/api/ping') return await handlePing(env, req);
      if (method === 'GET' && path === '/v1/models') return handleModels();
      if (method === 'POST' && path === '/v1/chat/completions') return await handleOpenAI(env, req);
      if (method === 'POST' && path === '/v1/messages') return await handleAnthropic(env, req);

      return new Response('404 — مسیر یافت نشد', {
        status: 404,
        headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, OPEN_CORS),
      });
    } catch (e) {
      /* هیچ خطایی نباید کل Worker را بیندازد */
      log('✖ ' + method + ' ' + path + ' → ' + ((e && e.stack) || e));
      if (ctx && typeof ctx.waitUntil === 'function') {
        try {
          ctx.waitUntil(Promise.resolve());
        } catch (e2) {
          /* noop */
        }
      }
      return jsonResponse(500, { error: { message: 'خطای داخلی سرور' } });
    }
  },
};

export default worker;
