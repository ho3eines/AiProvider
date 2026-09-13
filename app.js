#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  چت هوشمند — نسخهٔ تک‌فایل Node.js خالص (بدون هیچ وابستگی خارجی)
 * ─────────────────────────────────────────────────────────────────────────────
 *  اجرا:  node app.js          (پورت پیش‌فرض 3000 — با متغیر محیطی PORT قابل تغییر)
 *
 *  روت‌ها:
 *    GET  /                    → صفحهٔ HTML چت (فارسی، RTL، تم تاریک)
 *    POST /api/chat            → پروکسی استریم به آپستریم (SSE زنده، pipe مستقیم)
 *    GET  /api/ping            → تست اتصال به آپستریم → {status, ms, sample}
 *    GET  /v1/models           → لیست مدل‌ها (فرمت OpenAI — با کلید)
 *    POST /v1/chat/completions → اندپوینت سازگار OpenAI (استریم + غیراستریم)
 *    POST /v1/messages         → اندپوینت سازگار Anthropic (استریم + غیراستریم)
 *    OPTIONS *                 → 204 با هدرهای CORS باز
 *    بقیه                      → 404
 *
 *  کلیدهای API (طبق قوانین OpenAI و Anthropic): اولین اجرا ساخته و در
 *  api-keys.json کنار همین فایل ذخیره می‌شوند — در بنر اجرا و ⚙️ تنظیمات هم هست.
 *
 *  منطق پروکسی/مارک‌داون/پارسر SSE پورتِ دقیقِ نسخهٔ Next.js است:
 *    src/lib/upstream.ts ، src/app/api/chat/route.ts ، src/app/api/ping/route.ts
 *    src/lib/markdown.ts ، src/lib/sse.ts ، src/app/page.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------- لاگ رنگی ANSI کنسول (باید قبل از رجیستری پروایدرها تعریف شود؛
   چون getProviders() در لحظهٔ شروع ممکن است logReq صدا بزند) ---------- */
const C = {
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function logReq(color, msg) {
  const t = new Date().toLocaleTimeString('en-GB');
  console.log(C.dim + '[' + t + ']' + C.reset + ' ' + (C[color] || C.cyan) + msg + C.reset);
}

function safeDestroy(r) {
  try {
    if (r) r.destroy();
  } catch (e) {
    /* نادیده بگیر */
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   رجیستری پروایدرها — منبع حقیقت: providers.json (ریشهٔ پروژه)
   ───────────────────────────────────────────────────────────────────────────
   معادل خطیِ `src/lib/catalog.ts` + `src/lib/providers.ts` در نسخهٔ Next.js.
   برای افزودن مدل/پروایدر/سایت جدید فقط providers.json را ویرایش کنید؛
   این سرور فایل را با تغییرش دوباره می‌خواند (hot reload — بدون restart).
   اگر فایل نبود یا خراب بود، از BUILTIN_PROVIDERS (کپی داخلی، دقیقاً همان
   محتوای providers.json) استفاده می‌شود تا نسخهٔ تک‌فایل مستقل بماند.
   راهنما: skills/add-provider/SKILL.md · skills/add-model/SKILL.md
   ═══════════════════════════════════════════════════════════════════════════ */

/** هدرهای CORS باز برای پاسخ‌های خود سرور */
const OPEN_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
  'Access-Control-Max-Age': '86400',
};

const PROVIDERS_FILE = (process.env.FM_PROVIDERS_FILE || '').trim() || path.join(__dirname, 'providers.json');
const PROVIDERS_RELOAD_MS = 1000; // حداقل فاصلهٔ بین دو بررسی دیسک
const DEFAULT_TIMEOUT_MS = 180 * 1000;
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

/** نگاشت نام فیلدهای نرمال → نام فیلد آپستریم، برای هر «شکل» درخواست */
const DEFAULT_FIELDS = {
  freemodels: { model: 'modelId', messages: 'messages', stream: 'stream', thinking: 'thinking', deepSearch: 'deepSearch' },
  openai: { model: 'model', messages: 'messages', stream: 'stream' },
  anthropic: { model: 'model', messages: 'messages', stream: 'stream', system: 'system', maxTokens: 'max_tokens' },
  passthrough: { model: 'model', messages: 'messages', stream: 'stream' },
};

/* کپی داخلیِ providers.json — با `npm run sync:builtin` از روی فایل بازسازی می‌شود
   و `npm run verify` همگامی‌اش را می‌سنجد. دستی ویرایش نکنید (skills/add-provider).
   اگر providers.json کنار app.js نباشد، اپ با همین کپی بالا می‌آید. */
const BUILTIN_PROVIDERS = {
    "version": 1,
    "defaults": {
      "providerId": "freemodels",
      "modelId": "claude-fable-5.1",
      "timeoutMs": 180000,
      "maxBodyBytes": 5242880
    },
    "providers": [
      {
        "id": "freemodels",
        "name": "freemodels",
        "site": "https://freemodels.pro",
        "enabled": true,
        "ownedByPrefix": "freemodels",
        "upstream": {
          "url": "https://freemodels-chat.freemodels.workers.dev/",
          "method": "POST",
          "timeoutMs": 180000,
          "maxBodyBytes": 5242880,
          "headers": {
            "Content-Type": "application/json",
            "Origin": "https://freemodels.pro",
            "Referer": "https://freemodels.pro/",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
            "sec-ch-ua": "\"Chromium\";v=\"152\", \"Not?A_Brand\";v=\"24\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "cross-site",
            "Accept-Encoding": "identity"
          },
          "auth": null
        },
        "request": {
          "shape": "freemodels",
          "passthrough": true,
          "fields": {
            "model": "modelId",
            "messages": "messages",
            "stream": "stream",
            "thinking": "thinking",
            "deepSearch": "deepSearch"
          },
          "constants": {}
        },
        "response": {
          "profile": "universal"
        },
        "groups": [
          {
            "title": "Claude Pro",
            "icon": "sparkles"
          },
          {
            "title": "ChatGPT Pro",
            "icon": "zap"
          },
          {
            "title": "Other Pro Models",
            "icon": "globe"
          }
        ],
        "models": [
          {
            "id": "claude-sonnet-5",
            "name": "Claude Sonnet 5",
            "vendor": "Anthropic",
            "group": "Claude Pro",
            "logo": "/Claude-ai-logo.webp"
          },
          {
            "id": "claude-fable-5",
            "name": "Claude Fable 5",
            "vendor": "Anthropic",
            "group": "Claude Pro",
            "logo": "/Claude-ai-logo.webp"
          },
          {
            "id": "claude-fable-5.1",
            "name": "Claude Fable 5.1",
            "vendor": "Anthropic",
            "group": "Claude Pro",
            "logo": "/Claude-ai-logo.webp",
            "default": true
          },
          {
            "id": "gpt-5.6-sol",
            "name": "GPT 5.6 Sol",
            "vendor": "OpenAI",
            "group": "ChatGPT Pro",
            "logo": "/ChatGPT-Logo.svg.webp"
          },
          {
            "id": "gpt-5.6-terra",
            "name": "GPT 5.6 Terra",
            "vendor": "OpenAI",
            "group": "ChatGPT Pro",
            "logo": "/ChatGPT-Logo.svg.webp"
          },
          {
            "id": "glm-5.2",
            "name": "GLM 5.2",
            "vendor": "Z.AI",
            "group": "Other Pro Models",
            "logo": "/zai.png"
          },
          {
            "id": "kimi-k3",
            "name": "Kimi K3",
            "vendor": "Moonshot AI",
            "group": "Other Pro Models",
            "logo": "/kimi-logo-png_seeklogo-611650.png"
          }
        ]
      },
      {
        "id": "mock",
        "name": "Mock (local test)",
        "site": "http://127.0.0.1:4100",
        "enabled": false,
        "ownedByPrefix": "mock",
        "upstream": {
          "url": "http://127.0.0.1:${MOCK_PORT:-4100}/chat",
          "method": "POST",
          "timeoutMs": 30000,
          "maxBodyBytes": 5242880,
          "headers": {
            "Content-Type": "application/json",
            "Accept": "*/*"
          },
          "auth": null
        },
        "request": {
          "shape": "openai",
          "passthrough": false,
          "fields": {
            "model": "model",
            "messages": "messages",
            "stream": "stream"
          },
          "constants": {}
        },
        "response": {
          "profile": "universal"
        },
        "groups": [
          {
            "title": "Local Mock",
            "icon": "flask"
          }
        ],
        "models": [
          {
            "id": "mock-echo",
            "name": "Mock Echo",
            "vendor": "Local",
            "group": "Local Mock",
            "logo": "/logo.svg"
          }
        ]
      }
    ]
  };

/**
 * فعال/غیرفعال‌کردن پروایدرها با env (بدون ویرایش providers.json):
 *   FM_ENABLE_PROVIDERS="mock,mockfm"  ·  FM_DISABLE_PROVIDERS="freemodels"
 * معادل `withEnvToggles` در src/lib/catalog.ts — برای توسعهٔ آفلاین و تست دود.
 */
function withEnvToggles(cfg) {
  const enable = String(process.env.FM_ENABLE_PROVIDERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const disable = String(process.env.FM_DISABLE_PROVIDERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!enable.length && !disable.length) return cfg;
  return Object.assign({}, cfg, {
    providers: (cfg.providers || []).map((p) => {
      if (!p || !p.id) return p;
      if (disable.indexOf(p.id) >= 0) return Object.assign({}, p, { enabled: false });
      if (enable.indexOf(p.id) >= 0) return Object.assign({}, p, { enabled: true });
      return p;
    }),
  });
}

let providersCache = { cfg: withEnvToggles(BUILTIN_PROVIDERS), mtimeMs: 0, checkedAt: 0, source: 'builtin' };
let providersWarned = false;

function providersWarn(msg) {
  if (providersWarned) return;
  providersWarned = true;
  logReq('yellow', '[providers] ' + msg);
}

function isProviderEnabled(p) {
  return !!p && p.enabled !== false;
}

/** خواندن/اعتبارسنجی providers.json (در صورت نبود یا خرابی ← BUILTIN_PROVIDERS) */
function readProvidersConfig() {
  let mtimeMs = 0;
  try {
    if (fs.existsSync(PROVIDERS_FILE)) mtimeMs = fs.statSync(PROVIDERS_FILE).mtimeMs;
  } catch (e) {
    mtimeMs = 0;
  }
  if (!mtimeMs) return { cfg: withEnvToggles(BUILTIN_PROVIDERS), mtimeMs: 0, checkedAt: Date.now(), source: 'builtin' };
  try {
    const parsed = withEnvToggles(JSON.parse(fs.readFileSync(PROVIDERS_FILE, 'utf8')));
    if (!parsed || !Array.isArray(parsed.providers)) throw new Error('کلید providers آرایه نیست');
    if (!enabledProviders(parsed).length) throw new Error('هیچ پروایدر فعال/معتبری نیست');
    if (!listModels(parsed).length) throw new Error('هیچ مدلی در پروایدرهای فعال تعریف نشده');
    return { cfg: parsed, mtimeMs: mtimeMs, checkedAt: Date.now(), source: 'file' };
  } catch (e) {
    providersWarn('providers.json خوانده نشد (' + e.message + ') — از کپی داخلی استفاده می‌شود.');
    return { cfg: withEnvToggles(BUILTIN_PROVIDERS), mtimeMs: mtimeMs, checkedAt: Date.now(), source: 'builtin' };
  }
}

/** پیکربندی فعلی پروایدرها (hot reload با throttle یک ثانیه‌ای) */
function getProviders() {
  const now = Date.now();
  if (now - providersCache.checkedAt < PROVIDERS_RELOAD_MS) return providersCache.cfg;
  let mtimeMs = 0;
  try {
    if (fs.existsSync(PROVIDERS_FILE)) mtimeMs = fs.statSync(PROVIDERS_FILE).mtimeMs;
  } catch (e) {
    mtimeMs = 0;
  }
  if (providersCache.mtimeMs === mtimeMs) {
    providersCache.checkedAt = now;
    return providersCache.cfg;
  }
  providersCache = readProvidersConfig();
  if (providersCache.source === 'file') {
    providersWarned = false;
    logReq('cyan', '[providers] providers.json دوباره خوانده شد ← ' + providersSummary(providersCache.cfg));
  }
  return providersCache.cfg;
}

/** همهٔ پروایدرهای فعال و معتبر */
function enabledProviders(cfg) {
  const src = cfg || BUILTIN_PROVIDERS;
  return (src.providers || []).filter((p) => p && typeof p.id === 'string' && p.upstream && p.upstream.url && isProviderEnabled(p));
}

/** پروایدر پیش‌فرض (defaults.providerId یا اولین پروایدر فعال) */
function defaultProvider(cfg) {
  const src = cfg || getProviders();
  const list = enabledProviders(src);
  const want = src.defaults && src.defaults.providerId;
  return (want && list.find((p) => p.id === want)) || list[0] || (src.providers || [])[0];
}

/** لیست مسطح مدل‌های همهٔ پروایدرهای فعال */
function listModels(cfg) {
  const src = cfg || getProviders();
  const out = [];
  for (const p of enabledProviders(src)) {
    for (const m of p.models || []) {
      if (!m || typeof m.id !== 'string') continue;
      out.push(
        Object.assign({}, m, {
          name: m.name || m.id,
          vendor: m.vendor || p.name || p.id,
          group: m.group || p.name || p.id,
          logo: m.logo || '/logo.svg',
          providerId: p.id,
          providerName: p.name || p.id,
        })
      );
    }
  }
  return out;
}

/** گروه‌های پیکر مدل به‌ترتیب تعریف (+ گروه‌های استخراج‌شده از خود مدل‌ها) */
function listGroups(cfg) {
  const src = cfg || getProviders();
  const seen = [];
  const push = (title, icon) => {
    if (!title) return;
    if (!seen.some((g) => g.title === title)) seen.push({ title: title, icon: icon || 'globe' });
  };
  for (const p of enabledProviders(src)) {
    for (const g of p.groups || []) push(g && g.title, g && g.icon);
    for (const m of p.models || []) push(m && m.group, null);
  }
  return seen;
}

/** مدل پیش‌فرض کل سیستم */
function defaultModelId(cfg) {
  const src = cfg || getProviders();
  const models = listModels(src);
  const want = src.defaults && src.defaults.modelId;
  if (want && models.some((m) => m.id === want)) return want;
  const flagged = models.find((m) => m.default === true);
  if (flagged) return flagged.id;
  return (models[0] && models[0].id) || want || '';
}

function normModelKey(s) {
  return String(s || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function vendorSlug(vendor) {
  return String(vendor || 'unknown').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
}

/** owned_by برای /v1/models — مثل قبل: freemodels-anthropic */
function ownedBy(model, cfg) {
  const src = cfg || getProviders();
  const p = (src.providers || []).find((x) => x && x.id === model.providerId);
  const prefix = (p && (p.ownedByPrefix || p.id)) || 'provider';
  return prefix + '-' + vendorSlug(model.vendor);
}

/** جای‌گذاری `${VAR}` و `${VAR:-default}` با متغیرهای محیطی */
function expandVars(input, missing) {
  return String(input == null ? '' : input).replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/gi, (all, name, fallback) => {
    const v = process.env[name];
    if ((v == null || v === '') && fallback == null) {
      if (missing && missing.indexOf(name) < 0) missing.push(name);
      return '';
    }
    return v == null || v === '' ? fallback || '' : v;
  });
}

/** URL + هدرهای نهاییِ یک پروایدر (با جای‌گذاری متغیرهای محیطی و هدر احراز هویت) */
function upstreamOptions(provider, cfg) {
  const src = cfg || getProviders();
  const p = provider || defaultProvider(src);
  const missing = [];
  const headers = {};
  const rawHeaders = (p.upstream && p.upstream.headers) || {};
  for (const k of Object.keys(rawHeaders)) headers[k] = expandVars(rawHeaders[k], missing);

  const auth = p.upstream && p.upstream.auth;
  if (auth && (auth.header || auth.env)) {
    const header = auth.header || 'Authorization';
    let value = '';
    if (auth.value) value = expandVars(auth.value, missing);
    else if (auth.env) {
      const got = process.env[auth.env];
      if (got) value = (auth.prefix == null ? 'Bearer ' : auth.prefix) + got;
      else missing.push(auth.env);
    }
    if (value) headers[header] = value;
  }

  const d = src.defaults || {};
  return {
    url: expandVars(p.upstream.url, missing),
    method: String(p.upstream.method || 'POST').toUpperCase(),
    headers: headers,
    timeoutMs: p.upstream.timeoutMs || d.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxBodyBytes: p.upstream.maxBodyBytes || d.maxBodyBytes || DEFAULT_MAX_BODY_BYTES,
    missingEnv: missing,
    providerId: p.id,
  };
}

/** ساخت بدنهٔ درخواست آپستریم در «شکل» مورد انتظار همان پروایدر */
function buildUpstreamPayload(provider, req) {
  const p = provider || defaultProvider();
  const shape = (p.request && p.request.shape) || 'freemodels';
  if (shape === 'passthrough' && req.extra) return Object.assign({}, req.extra);

  const fields = Object.assign({}, DEFAULT_FIELDS[shape] || DEFAULT_FIELDS.freemodels, (p.request && p.request.fields) || {});
  const out = {};
  const put = (key, value) => {
    if (key) out[key] = value;
  };

  if (req.extra && p.request && p.request.passthrough) Object.assign(out, req.extra);

  put(fields.messages, req.messages);
  put(fields.model, req.modelId);
  if (req.stream !== undefined) put(fields.stream, req.stream === true);
  if (fields.thinking) put(fields.thinking, req.thinking === true);
  if (fields.deepSearch) put(fields.deepSearch, req.deepSearch === true);
  if (fields.maxTokens && req.maxTokens != null) put(fields.maxTokens, req.maxTokens);

  const sys = req.system && String(req.system).trim();
  if (sys) {
    if (fields.system && shape !== 'freemodels') put(fields.system, sys);
    else {
      const list = out[fields.messages];
      if (Array.isArray(list)) out[fields.messages] = [{ role: 'system', content: sys }].concat(list);
    }
  }
  if (p.request && p.request.constants) Object.assign(out, p.request.constants);
  return out;
}

/** فقط آن‌چه UI لازم دارد (بدون URL/هدر/احراز هویت) — داخل window.__FM__ تزریق می‌شود */
function publicCatalog(cfg) {
  const src = cfg || getProviders();
  return {
    defaultModel: defaultModelId(src),
    groups: listGroups(src),
    models: listModels(src).map((m) => ({
      id: m.id,
      name: m.name,
      vendor: m.vendor,
      group: m.group,
      logo: m.logo,
      providerId: m.providerId,
      default: m.default === true,
    })),
  };
}

function providersSummary(cfg) {
  const src = cfg || getProviders();
  const ps = enabledProviders(src);
  return ps.length + ' provider (' + ps.map((p) => p.id).join(', ') + ') · ' + listModels(src).length + ' model · default ' + defaultModelId(src);
}

/* ───── ثابت‌های سازگار با کد قبلی (مقادیرِ پروایدر پیش‌فرض در لحظهٔ شروع) ─────
   هندلرها از توابع زندهٔ بالا استفاده می‌کنند؛ این‌ها برای بنر اجرا و سازگاری‌اند. */
const BOOT_CFG = getProviders();
const BOOT_UPSTREAM = upstreamOptions(defaultProvider(BOOT_CFG), BOOT_CFG);
const UPSTREAM_URL = BOOT_UPSTREAM.url;
const SPOOFED_HEADERS = BOOT_UPSTREAM.headers;
const MAX_BODY_BYTES = BOOT_UPSTREAM.maxBodyBytes;
const UPSTREAM_TIMEOUT_MS = BOOT_UPSTREAM.timeoutMs;
const FM_MODELS = listModels(BOOT_CFG);
const DEFAULT_MODEL_ID = defaultModelId(BOOT_CFG);

/**
 * تطبیق نرم نام مدل + انتخاب پروایدر
 * «Claude Fable 5.1» / «claude_fable 5.1» / «claude-fable-5.1» همه یکی‌اند.
 * ورودی خالی ← مدل پیش‌فرض؛ ورودی ناشناخته ← دست‌نخورده با پروایدر پیش‌فرض.
 */
function resolveModel(input, cfg) {
  const src = cfg || getProviders();
  const models = listModels(src);
  const dp = defaultProvider(src);
  const raw = typeof input === 'string' ? input.trim() : '';

  if (!raw) {
    const id = defaultModelId(src);
    const m = models.find((x) => x.id === id) || null;
    const prov = m ? (src.providers || []).find((p) => p && p.id === m.providerId) || dp : dp;
    return { id: (m && m.upstreamId) || id, publicId: id, model: m, provider: prov, known: !!m };
  }

  const t = normModelKey(raw);
  const tl = raw.toLowerCase();
  let hit = models.find((m) => m.id === t || m.id === tl || String(m.name || '').toLowerCase() === tl);
  if (!hit) hit = models.find((m) => (m.aliases || []).some((a) => normModelKey(a) === t || String(a).toLowerCase() === tl));
  if (hit) {
    const prov = (src.providers || []).find((p) => p && p.id === hit.providerId) || dp;
    return { id: hit.upstreamId || hit.id, publicId: hit.id, model: hit, provider: prov, known: true };
  }
  return { id: t, publicId: t, model: null, provider: dp, known: false };
}

/** سازگار با کد قبلی: فقط id نرمال‌شده */
function resolveModelId(input) {
  return resolveModel(input).publicId;
}

/* لوگوهای ارائه‌دهنده به‌صورت base64 داخل همین فایل embed شده‌اند تا نسخهٔ تک‌فایل مستقل بماند
   (سایت مرجع همین مسیرها را سرو می‌کند؛ محتوا نسخهٔ ۹۶px بهینه‌شده است) */
const EMBEDDED_LOGOS = {"/Claude-ai-logo.webp":{"mime":"image/webp","b64":"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"},"/ChatGPT-Logo.svg.webp":{"mime":"image/webp","b64":"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"},"/zai.png":{"mime":"image/png","b64":"iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAFFklEQVR42u2dP4hcVRTGf29mDKsBSawUhAQsjCIYLWxMCklhGkHIgtjo2KTQpLEyKSwEN6aMiY2F2UpR1lLcgJUGRNAUFjGCxVoZFFeERPfP/LGYc9zHsPPeHSHe7753D1x2d+bN7rnnnfu9c86391zIkiVLlixZskSR4g5f/3/IOHH926G8qv7FHNeNgXuAu+f0ujvp+XcBt21USQcYAfeJrdyFXsCFrvwB4AubxDiyR43s7/8JPAP8ZT+Pdrm2BwyA14C3gCHQjWz8IbAAfBTi+T27CV+a4ZXGC6bnLIP6608Cm2K6/wjsq7sBvkLetg9tmZfFHFumy4UpHXdzng6wF7hhnxlE1n0IbAMbwOE647v3PGvKb9sviek1A/v6LbDHdCxqnGe5pH9sr3cdTtc4Dx2b2P3AL6W7F1P5kd2AW8DDJT2rjN8XNP5KnfGL0pufT3mewgReqpmA35RDFh0NBVauO+8asN907NTh/hlB7/kgAPe7Bk/XRJxnZPoPgaM1QcO/bxwpPTBUvOe65SEhuH9J0HnOhOB+x0KjtanJx8b9ctRQF3IuChnfV99qyfhFnfd/bB/atBswiDg8dn81EPcPAOum91Bg5Y6AmxbMFFW478Z/QzDZ+iQA93s2h6tiuD+2MH7myvUsdwg8CDwHfGOTillq8FLHH8DJijKDT2wALAFP2/c94srQdHgHuFIqhwQlXimJ63xcMFn8ypy7N68zF0KjU6F8OVm8KZIs+rNn3Z5HVcli8rV9h5lVwWRxMWFUCRLlZPFiXbyfurhXHRVKFn31XQsoEiYtnizuF0sWh1YkPNRk3C8v6xVB6Ok3HXp8YqcFjb/cFtx3anEgVCT8wVi3TlNx30vMe22ySkXCTXOKVoScitTiqbbgfl+wxLzSdOOXqcVbYri/RgC12ATcT5ZabAr0XCRBarEpxj9BotRiE3D/IDvUogLuB1OLTcD9DhMyQ41aPN4W3D8niPtLbSk1KFKLV/mP1GJKuK9MLR5scolZnVo80ZaQU5FavNQW3Pf/Q1UoNbSGWvRYWo1a9P0HraMWlXC/3xbcP0WmFqPhvjK12GjcV6UWt8jUovauxaYYvy9YYv606cZXphZ/ZodabDTuq1GLAzK1GB33z7YF9xWpxSslHRtNLSa7a7EJJeZMLUaGniVB3D/XllKDYosb37XY6N0rii1uMrUoAD2LbQk5867FiLiv1OIm71pEg1p8pC0hZ6YWIxo/U4sRcT9Ti5FCTm+ImnctRoSeZTK1GM34fUHjt27XYnINUVPH/bxrUQB68q7FiCFn3rUYEfdTpRa9RK405i4xp0otqq6IYjdsnwU93hD1CHoNUVeZ3RC1a9c+BbxL/Ea0hem5h8lRMK9T3YxWmlqs27XokHQv8JPA86o8toBHp+B9Jm6m2hDVV+mH6DQh3zBdnq8Ll1NviOq6nyRRZi7lXYt+Ux4D/kZr0993BDBzKVOLnqkvAN8LRWzBm/6UqcXbARPwVfG+4Mp9eR7oUWyI+kog9LwoqPvleYyfYkNUXxEPMTlXUqlCe30eZu5xC5W2S5OINRy7b1DdENVxvwt8PZWvxDyq0Jm5J0IrtPuYHCyplrDUUYv++gUx3cdMTm4NqtD2gPPAA8BvaBzz2gXetMinrtRwzB5yvwqVST4D3iPw3JjCjL8hVrxaZ+cc4yrxA5rHIvoXwO8lXcYkKo2s7c+aqOJkxwnfqDFZsmTJkiVLFn35B1qlFEc6E28rAAAAAElFTkSuQmCC"},"/kimi-logo-png_seeklogo-611650.png":{"mime":"image/png","b64":"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"}};
const BOOT_AT = Math.floor(Date.now() / 1000); // برای فیلد created در /v1/models

/* ---------- کلیدهای API (طبق قوانین OpenAI و Anthropic) ----------
   • کلید سبک OpenAI    : sk-...      → هدر Authorization: Bearer <key>
   • کلید سبک Anthropic : sk-ant-...  → هدر x-api-key: <key>
   اولین اجرا: ساخته و در api-keys.json کنار همین فایل ذخیره می‌شود؛
   اجراهای بعدی همان‌ها لود می‌شوند. با env هم قابل تعیین دستی است:
   OPENAI_API_KEY / ANTHROPIC_API_KEY */
const KEY_FILE = path.join(__dirname, 'api-keys.json');

function randomToken(len, alphabet) {
  const abc = alphabet || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += abc[bytes[i] % abc.length];
  return s;
}

function loadOrCreateKeys() {
  const envOpen = (process.env.OPENAI_API_KEY || '').trim();
  const envAnt = (process.env.ANTHROPIC_API_KEY || '').trim();
  try {
    if (fs.existsSync(KEY_FILE)) {
      const j = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
      if (j && typeof j.openai === 'string' && typeof j.anthropic === 'string' && j.openai && j.anthropic) {
        return { openai: envOpen || j.openai, anthropic: envAnt || j.anthropic };
      }
    }
  } catch (e) {
    /* فایل خراب — دوباره می‌سازیم */
  }
  const fresh = {
    openai: envOpen || ('sk-' + randomToken(48)),
    anthropic: envAnt || ('sk-ant-api03-' + randomToken(88)),
    createdAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(KEY_FILE, JSON.stringify(fresh, null, 2) + '\n', { mode: 0o600 });
  } catch (e) {
    /* فایل‌سیستم اجازه نداد — کلیدها فقط تا پایان اجرا در حافظه می‌مانند */
  }
  return { openai: fresh.openai, anthropic: fresh.anthropic };
}

const API_KEYS = loadOrCreateKeys();

/** اعتبارسنجی کلید — هر دو کلید روی هر دو اندپوینت پذیرفته می‌شوند */
function keyIsValid(k) {
  return !!k && (k === API_KEYS.openai || k === API_KEYS.anthropic);
}


/* ═══════════════════════════════════════════════════════════════════════════
   استایل صفحه (PAGE_CSS) — بدون backtick
   ═══════════════════════════════════════════════════════════════════════════ */
const PAGE_CSS = String.raw`
/* ─── پایه ─── */
:root{
  --bg:#0b1220; --panel:#0d1526; --surface:#111a2e; --line:#243352; --line2:#1a2440;
  --accent:#3b82f6; --accent2:#38bdf8; --txt:#e2e8f0; --muted:#94a3b8; --faint:#64748b;
}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;padding:0;height:100%}
body{background:var(--bg);color:var(--txt);font-family:'Vazirmatn',Vazir,Tahoma,'Segoe UI',system-ui,sans-serif;font-size:15px;-webkit-font-smoothing:antialiased}
button{font-family:inherit}
#app{display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden}

/* ─── اسکرول‌بار سفارشی ─── */
*::-webkit-scrollbar{width:8px;height:8px}
*::-webkit-scrollbar-thumb{background:#243352;border-radius:8px}
*::-webkit-scrollbar-thumb:hover{background:#3b82f6}
*::-webkit-scrollbar-track{background:transparent}

/* ─── هدر ─── */
#topbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 14px;background:rgba(13,21,38,.95);border-bottom:1px solid var(--line);z-index:55}
/* نکته: چون topbar و sidebar هر دو flex-item هستند، z-index حتی با position:static هم
   stacking-context می‌سازد؛ ۵۵ انتخاب شد تا پاپ‌آپ پیکر مدل بالای سایدبار (۵۰) بیاید
   و زیر مودال (۶۰) و توست‌ها (۷۰) بماند */
.brand{display:none;align-items:center;gap:8px;font-weight:800;font-size:14px;color:#f1f5f9}
.brand-ic{display:flex;width:32px;height:32px;align-items:center;justify-content:center;border-radius:9px;background:linear-gradient(135deg,var(--accent),var(--accent2));font-size:15px}
/* ─── پیکر مدل (مثل سایت freemodels) ─── */
.mp-wrap{position:relative}
#model-btn{display:inline-flex;align-items:center;gap:8px;height:36px;min-width:150px;max-width:220px;border-radius:10px;border:1px solid var(--line);background:var(--surface);padding:0 10px;cursor:pointer;transition:border-color .15s}
#model-btn:hover,#model-btn.mp-open{border-color:var(--accent)}
.mp-btn-logo{width:20px;height:20px;border-radius:6px;border:1px solid rgba(10,10,11,.1);background:#fff;object-fit:contain;padding:2px;flex:none;box-sizing:border-box}
.mp-btn-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500;color:var(--txt);direction:ltr;text-align:left;font-family:inherit}
.mp-chev{flex:none;color:#94a3b8;transition:transform .15s}
.mp-open .mp-chev{transform:rotate(180deg)}
#model-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:60;width:264px;max-height:min(55dvh,320px);overflow:auto;overscroll-behavior:contain;border-radius:12px;border:1px solid rgba(10,10,11,.08);background:#fff;padding:6px;box-shadow:0 16px 40px rgba(0,0,0,.35);direction:ltr;text-align:left}
.mp-group{margin-bottom:6px}
.mp-group:last-child{margin-bottom:0}
.mp-ghead{display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:rgba(10,10,11,.6)}
.mp-ghead svg{width:12px;height:12px;flex:none}
.mp-row{display:flex;width:100%;align-items:center;gap:8px;border:0;background:transparent;border-radius:8px;padding:10px 8px;cursor:pointer;text-align:left;transition:background .12s;min-height:44px;font-family:inherit}
.mp-row:hover{background:#FFFBF5}
.mp-row:active{background:#F5F3EF}
@media(min-width:640px){.mp-row{min-height:0;padding-top:8px;padding-bottom:8px}}
.mp-logo{width:20px;height:20px;border-radius:6px;border:1px solid rgba(10,10,11,.1);background:#fff;object-fit:contain;padding:2px;flex:none;box-sizing:border-box}
.mp-txt{flex:1;min-width:0}
.mp-mname{font-size:12px;font-weight:500;line-height:1;color:#0A0A0B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mp-mvendor{font-size:11px;line-height:1;margin-top:2px;color:rgba(10,10,11,.6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mp-row.sel{background:#0A0A0B}
.mp-row.sel:hover{background:#0A0A0B}
.mp-row.sel .mp-mname{color:#fff}
.mp-row.sel .mp-mvendor{color:rgba(255,255,255,.6)}
.mp-check{width:14px;height:14px;color:#fff;flex:none}
.opts{display:none;align-items:center;gap:14px;border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:6px 12px}
.opts label{display:flex;align-items:center;gap:6px;font-size:12px;color:#cbd5e1;cursor:pointer;user-select:none;white-space:nowrap}
.opts input{accent-color:var(--accent);width:14px;height:14px;cursor:pointer}
.spacer{flex:1}
.hbtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 10px;border-radius:10px;border:1px solid var(--line);background:transparent;color:#cbd5e1;font-size:12px;cursor:pointer;transition:border-color .15s,background .15s}
.hbtn:hover{border-color:var(--accent);background:var(--line2)}
.hbtn.on{border-color:var(--accent);background:#14203c;color:var(--accent2)}
.icon-btn{display:inline-flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:10px;border:1px solid var(--line);background:transparent;color:#cbd5e1;font-size:14px;cursor:pointer;transition:border-color .15s,background .15s}
.icon-btn:hover{border-color:var(--accent);background:var(--line2)}
.status{display:flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:8px 10px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
.dot-ok{background:#34d399;box-shadow:0 0 8px rgba(52,211,153,.8)}
.dot-check{background:#fbbf24;animation:fm-pulse 1.2s ease-in-out infinite}
.dot-fail{background:#ef4444}
@keyframes fm-pulse{50%{opacity:.35}}
.status-t{font-size:12px;color:var(--muted);white-space:nowrap}

/* ─── بدنه ─── */
#body-main{display:flex;flex:1;min-height:0}
#overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(2px);z-index:40}

/* ─── سایدبار راست ─── */
#sidebar{position:fixed;top:0;bottom:0;right:0;z-index:50;width:260px;display:flex;flex-direction:column;background:var(--panel);border-left:1px solid var(--line);transform:translateX(100%);transition:transform .2s ease}
#sidebar.open{transform:translateX(0)}
@media(min-width:769px){#sidebar{position:static;transform:none}}
.sb-head{display:flex;align-items:center;justify-content:space-between;padding:12px;border-bottom:1px solid var(--line);font-weight:800;font-size:14px;color:#f1f5f9}
.sb-title{display:flex;align-items:center;gap:8px}
.sb-new{padding:12px}
.btn-primary{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;border:none;border-radius:12px;background:var(--accent);color:#fff;font-weight:700;font-size:14px;padding:10px 0;cursor:pointer;transition:background .15s}
.btn-primary:hover{background:#2563eb}
.btn-primary:disabled{opacity:.4;cursor:not-allowed}
#chat-list{flex:1;min-height:0;overflow-y:auto;padding:0 12px 12px;display:flex;flex-direction:column;gap:6px}
.chat-item{display:flex;align-items:center;gap:8px;border:1px solid transparent;border-radius:12px;padding:10px 12px;font-size:13px;color:var(--muted);cursor:pointer;transition:background .15s}
.chat-item:hover{background:var(--surface);color:#cbd5e1}
.chat-item.active{border-color:rgba(59,130,246,.6);background:#14203c;color:#f1f5f9}
.chat-ic{flex:none;font-size:13px}
.chat-ic.dim{opacity:.5}
.chat-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chat-del{flex:none;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:none;border-radius:7px;background:transparent;color:var(--faint);cursor:pointer;opacity:0;transition:opacity .15s}
.chat-item:hover .chat-del{opacity:1}
.chat-del:hover{background:rgba(239,68,68,.15);color:#fca5a5}
.sb-foot{border-top:1px solid var(--line);padding:12px;display:flex;flex-direction:column;gap:8px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sb-foot .hbtn{height:34px}
.btn-danger{width:100%;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(239,68,68,.3);border-radius:10px;background:transparent;color:#fca5a5;font-size:12px;padding:8px 0;cursor:pointer;transition:background .15s}
.btn-danger:hover{background:rgba(239,68,68,.1)}

/* ─── ناحیهٔ چت ─── */
#main{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column}
#chat-area{flex:1;min-height:0;overflow-y:auto;padding:16px 14px}
#chat-inner{max-width:768px;margin:0 auto;display:flex;flex-direction:column;gap:20px;min-height:100%}

/* ─── پیام‌ها ─── */
.msg-col{display:flex;flex-direction:column;gap:6px}
.from-user{align-items:flex-end}
.from-assistant{align-items:flex-start}
.msg-role{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--faint);padding:0 4px}
.avatar{width:16px;height:16px;border-radius:6px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:inline-flex;align-items:center;justify-content:center;font-size:9px}
.bubble{border-radius:16px;padding:12px 16px;font-size:15px;line-height:2;max-width:88%;overflow-wrap:anywhere;word-break:break-word}
.bub-user{background:#233457;color:#f1f5f9;border-bottom-left-radius:6px}
.user-text{white-space:pre-wrap}
.bub-asst{width:100%;max-width:720px;background:var(--surface);border:1px solid var(--line);color:#e2e8f0;border-bottom-right-radius:6px}
.bub-err{width:100%;max-width:720px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.4);color:#fecaca;font-size:14px;line-height:1.8;border-bottom-right-radius:6px}
.msg-actions{display:flex;align-items:center;gap:6px;padding:0 4px;flex-wrap:wrap}
.act-btns{display:flex;align-items:center;gap:6px;opacity:1;transition:opacity .15s}
@media(min-width:769px){.act-btns{opacity:0}.msg-col:hover .act-btns{opacity:1}}
.act-btn{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--muted);font-size:12px;cursor:pointer;transition:border-color .15s,color .15s}
.act-btn:hover{border-color:var(--accent);color:#f1f5f9}
.act-btn.danger:hover{border-color:#ef4444;color:#fca5a5}
.msg-stats{font-size:11px;color:var(--faint)}
.msg-err{margin-top:8px;border:1px solid rgba(239,68,68,.4);background:rgba(239,68,68,.1);border-radius:10px;padding:8px 12px;font-size:13px;line-height:1.8;color:#fecaca}
.badge-stop{margin-top:6px;display:inline-flex;align-items:center;gap:4px;background:rgba(245,158,11,.15);color:#fcd34d;font-size:11px;border-radius:7px;padding:2px 8px;width:max-content}

/* ─── باکس تفکر مدل ─── */
.think-box{border:1px solid var(--line);background:#0d1730;border-radius:12px;margin-bottom:10px;overflow:hidden;font-size:13px}
.think-box summary{cursor:pointer;padding:8px 12px;color:#93c5fd;font-weight:600;font-size:12px;user-select:none;list-style:none}
.think-box summary::-webkit-details-marker{display:none}
.think-box summary::before{content:'\25B8  ';color:var(--accent2)}
.think-box[open] summary::before{content:'\25BE  '}
.think-body{max-height:240px;overflow-y:auto;padding:4px 12px 12px;font-size:12px;line-height:1.9;color:var(--muted);white-space:pre-wrap;word-break:break-word}

/* ─── مارک‌داون ─── */
.md-body{overflow-wrap:anywhere}
.md-p{margin:0 0 8px}
.md-p:last-child{margin-bottom:0}
.md-h{margin:14px 0 8px;font-weight:800;line-height:1.6;color:#f1f5f9}
.md-body h1.md-h{font-size:1.45em}
.md-body h2.md-h{font-size:1.3em}
.md-body h3.md-h{font-size:1.15em}
.md-body h4.md-h,.md-body h5.md-h,.md-body h6.md-h{font-size:1em}
.md-list{margin:4px 0 10px;padding-right:22px}
.md-list li{margin:2px 0}
.md-quote{margin:6px 0 10px;border-right:3px solid var(--accent);background:#0d1730;border-radius:8px;padding:8px 12px;color:#cbd5e1}
.md-hr{border:none;border-top:1px solid var(--line);margin:14px 0}
.md-link{color:var(--accent2);text-decoration:underline}
.md-icode{direction:ltr;unicode-bidi:embed;font-family:ui-monospace,Consolas,monospace;font-size:.88em;background:#0d1730;border:1px solid var(--line);border-radius:6px;padding:1px 6px;color:#7dd3fc}
.md-code{direction:ltr;border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:10px 0;background:#0a1120}
.md-code-head{display:flex;align-items:center;justify-content:space-between;background:#101b31;padding:6px 12px;border-bottom:1px solid var(--line)}
.md-code-lang{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--muted);direction:ltr}
.md-code-copy{border:1px solid var(--line);background:transparent;color:#cbd5e1;font-size:11px;border-radius:7px;padding:3px 10px;cursor:pointer;transition:border-color .15s,color .15s}
.md-code-copy:hover{border-color:var(--accent);color:#fff}
.md-pre{margin:0;padding:12px 14px;overflow-x:auto;font-family:ui-monospace,Consolas,monospace;font-size:13px;line-height:1.7;tab-size:4}
.md-pre code{font-family:inherit}
.tok-keyword{color:#38bdf8}
.tok-string{color:#86efac}
.tok-number{color:#facc15}
.tok-comment{color:#64748b;font-style:italic}

/* ─── کرسر چشمک‌زن استریم ─── */
.stream-cursor{display:inline-block;width:9px;height:1.05em;border-radius:2px;background:var(--accent2);vertical-align:text-bottom;margin-inline-start:2px;animation:fm-blink 1s steps(1) infinite}
@keyframes fm-blink{50%{opacity:0}}

/* ─── صفحهٔ خوش‌آمد ─── */
.welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;text-align:center;padding:40px 0}
.w-ic{width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:30px;box-shadow:0 10px 30px rgba(59,130,246,.25)}
.w-head h2{margin:0 0 8px;font-size:24px;font-weight:800;color:#f1f5f9}
.w-head p{margin:0;font-size:13px;color:var(--muted)}
.w-grid{display:grid;grid-template-columns:1fr;gap:12px;width:100%;max-width:576px}
@media(min-width:640px){.w-grid{grid-template-columns:1fr 1fr}}
.w-card{display:flex;align-items:flex-start;gap:12px;text-align:right;border:1px solid var(--line);background:var(--surface);border-radius:16px;padding:16px;cursor:pointer;transition:border-color .15s,background .15s}
.w-card:hover{border-color:var(--accent);background:#14203c}
.w-card-ic{flex:none;width:36px;height:36px;border-radius:12px;background:#0d1730;display:flex;align-items:center;justify-content:center;font-size:16px;transition:background .15s}
.w-card:hover .w-card-ic{background:var(--accent)}
.w-card-title{display:block;font-size:13px;font-weight:700;color:#e2e8f0}
.w-card-text{display:block;margin-top:4px;font-size:11.5px;line-height:1.8;color:var(--muted)}

/* ─── کامپوزر پایین (چسبان با flex) ─── */
#composer{flex:none;border-top:1px solid var(--line);background:var(--panel);padding:12px 14px;padding-bottom:max(12px,env(safe-area-inset-bottom))}
.comp-row{max-width:768px;margin:0 auto;display:flex;align-items:flex-end;gap:8px}
#ta{flex:1;resize:none;border:1px solid var(--line);background:var(--surface);border-radius:16px;padding:11px 16px;color:#f1f5f9;font-size:15px;line-height:1.8;font-family:inherit;min-height:46px;max-height:200px}
#ta:focus{outline:none;border-color:var(--accent)}
#ta::placeholder{color:var(--faint)}
#btn-send{flex:none;width:52px;height:46px;border:none;border-radius:16px;background:var(--accent);color:#fff;font-size:17px;cursor:pointer;transition:background .15s}
#btn-send:hover{background:#2563eb}
#btn-stop{flex:none;height:46px;padding:0 16px;border:none;border-radius:16px;background:rgba(239,68,68,.9);color:#fff;font-weight:700;font-size:13px;cursor:pointer;transition:background .15s}
#btn-stop:hover{background:#ef4444}
.comp-note{max-width:768px;margin:8px auto 0;text-align:center;font-size:11px;color:var(--faint)}

/* ─── ویرایش اینلاین ─── */
.edit-wrap{display:flex;flex-direction:column;gap:8px;width:100%}
.edit-ta{width:100%;resize:none;border:1px solid var(--accent);background:#0d1730;border-radius:12px;padding:8px 12px;color:#f1f5f9;font-size:13px;line-height:1.9;font-family:inherit}
.edit-ta:focus{outline:none}
.edit-row{display:flex;gap:8px}
.btn-mini{display:inline-flex;align-items:center;gap:6px;border-radius:10px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;transition:background .15s}
.btn-save{border:none;background:var(--accent);color:#fff}
.btn-save:hover{background:#2563eb}
.btn-cancel{border:1px solid var(--line);background:transparent;color:#cbd5e1}
.btn-cancel:hover{background:var(--line2)}

/* ─── پنل Raw SSE (شناور پایین-چپ) ─── */
#raw-panel{position:fixed;bottom:16px;left:16px;z-index:50;display:flex;flex-direction:column;width:min(92vw,460px);max-height:300px;border:1px solid var(--line);background:#0d1526;border-radius:12px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.5)}
.raw-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line);font-size:12px;font-weight:700;color:#cbd5e1}
.raw-title{flex:1}
.raw-size{font-size:10px;color:var(--faint)}
.raw-mini{width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:none;border-radius:7px;background:transparent;color:var(--muted);cursor:pointer;font-size:12px}
.raw-mini:hover{background:var(--line2);color:#e2e8f0}
#raw-pre{flex:1;margin:0;overflow:auto;padding:12px;text-align:left;font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.6;color:#cbd5e1;direction:ltr}

/* ─── مودال تنظیمات ─── */
#modal{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:16px}
#modal-ov{position:absolute;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(3px)}
#modal-box{position:relative;width:100%;max-width:512px;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:20px;box-shadow:0 25px 60px rgba(0,0,0,.5)}
.m-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.m-head h3{margin:0;font-size:15px;font-weight:800;color:#f1f5f9}
.m-label{display:block;font-size:13px;font-weight:700;color:#cbd5e1;margin-bottom:8px}
#sys-prompt{width:100%;resize:none;border:1px solid var(--line);background:#0d1730;border-radius:12px;padding:10px 12px;color:#f1f5f9;font-size:13px;line-height:1.9;font-family:inherit}
#sys-prompt:focus{outline:none;border-color:var(--accent)}
.m-hint{font-size:11px;line-height:1.9;color:var(--faint);margin:8px 0 0}
.m-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.m-foot .btn-primary{width:auto;padding:8px 18px;border-radius:10px;font-size:13px}
.m-foot .hbtn{height:36px}
/* ─── بخش API و کلیدها در مودال تنظیمات ─── */
.api-sec{border-top:1px dashed var(--line);margin-top:14px;padding-top:12px}
.api-sec h4{margin:0 0 6px;font-size:13px;font-weight:800;color:var(--accent2)}
.api-hint{font-size:11px;line-height:1.9;color:var(--faint);margin:0 0 10px}
.key-row{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:7px 10px;margin-bottom:6px}
.key-tag{font-size:10.5px;font-weight:700;color:var(--muted);width:64px;flex-shrink:0}
.key-row code{flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:#7dd3fc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:ltr;text-align:left}
.key-copy{background:transparent;border:1px solid var(--line);color:var(--txt);font-size:10.5px;padding:3px 9px;border-radius:7px;cursor:pointer;flex-shrink:0;font-family:inherit}
.key-copy:hover{border-color:var(--accent2);color:var(--accent2)}
.api-eps{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;color:#9fb3d1;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 11px;line-height:1.9;text-align:left;white-space:pre;overflow-x:auto;margin:0 0 8px}
.api-curl{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;background:#0a101f;border:1px solid var(--line);border-radius:10px;padding:10px 12px;overflow-x:auto;line-height:1.8;color:#d7e3f8;white-space:pre;text-align:left;margin:0}

/* ─── توست‌ها ─── */
#toasts{pointer-events:none;position:fixed;left:0;right:0;bottom:96px;z-index:70;display:flex;flex-direction:column;align-items:center;gap:8px;padding:0 16px}
.toast{pointer-events:auto;border-radius:12px;padding:8px 16px;font-size:13px;box-shadow:0 10px 30px rgba(0,0,0,.4);backdrop-filter:blur(6px)}
.toast-ok{border:1px solid rgba(16,185,129,.4);background:rgba(15,32,24,.95);color:#a7f3d0}
.toast-err{border:1px solid rgba(239,68,68,.5);background:rgba(42,18,32,.95);color:#fecaca}

/* ─── ریسپانسیو ─── */
.only-mobile{display:inline-flex}
@media(min-width:769px){.only-mobile{display:none}}
@media(min-width:1024px){.brand{display:flex}}
@media(max-width:640px){
  .opts{display:none}
  .status-t{display:none}
  #model-btn{min-width:132px;max-width:170px}
  #chat-area{padding:12px 10px}
  .bubble{max-width:92%}
}
`;

/* ═══════════════════════════════════════════════════════════════════════════
   اسکریپت سمت کلاینت (PAGE_JS)
   قواعد سخت: در این بخش هیچ backtick و هیچ ${ مجاز نیست؛
   backtick های مارک‌داون با \x60 ساخته شده‌اند.
   ═══════════════════════════════════════════════════════════════════════════ */
const PAGE_JS = String.raw`
(function () {
'use strict';

/* ================= ثابت‌ها ================= */
/* دیتای تزریق‌شدهٔ سرور: کاتالوگ زندهٔ مدل‌ها/گروه‌ها (providers.json) + کلیدها */
var FM_DATA = (typeof window !== 'undefined' && window.__FM__) ? window.__FM__ : {};
/* لیست پشتیبان — فقط اگر تزریق سرور انجام نشود (مثلاً بازکردن مستقیم HTML) */
var MODELS_FALLBACK = [
  { id: 'claude-sonnet-5',  name: 'Claude Sonnet 5',  vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'gpt-5.6-sol',      name: 'GPT 5.6 Sol',      vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: '/ChatGPT-Logo.svg.webp' },
  { id: 'gpt-5.6-terra',    name: 'GPT 5.6 Terra',    vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: '/ChatGPT-Logo.svg.webp' },
  { id: 'glm-5.2',          name: 'GLM 5.2',          vendor: 'Z.AI',        group: 'Other Pro Models', logo: '/zai.png' },
  { id: 'kimi-k3',          name: 'Kimi K3',          vendor: 'Moonshot AI', group: 'Other Pro Models', logo: '/kimi-logo-png_seeklogo-611650.png' }
];
/* منبع واحد در زمان اجرا: همان چیزی که سرور از providers.json فرستاده است */
var MODELS = (FM_DATA.models && FM_DATA.models.length) ? FM_DATA.models : MODELS_FALLBACK;
var DEFAULT_SETTINGS = { modelId: FM_DATA.defaultModel || 'claude-fable-5.1', thinking: false, deepSearch: false, stream: true, systemPrompt: '' };
var MAX_RAW_LOG = 80 * 1024; // پنل Raw SSE: نگه‌داری آخرین ~80KB

var SUGGESTIONS = [
  { icon: '🧠', title: 'توضیح مفهومی', text: 'به زبان ساده توضیح بده مدل‌های زبانی بزرگ (LLM) چطور کار می‌کنند؟' },
  { icon: '💻', title: 'کد بنویس', text: 'یک اسکریپت پایتون بنویس که پرتکرارترین کلمات یک متن را پیدا کند.' },
  { icon: '✉️', title: 'ایمیل رسمی', text: 'یک ایمیل رسمی و محترمانه به مدیرم بنویس و درخواست یک روز مرخصی کن.' },
  { icon: '🌍', title: 'ترجمه', text: 'این جمله را به انگلیسی روان ترجمه کن: زندگی زیباست و باید از هر لحظه لذت برد.' }
];

/* ================= وضعیت کلی ================= */
var chats = [];
var activeId = '';
var settings = Object.assign({}, DEFAULT_SETTINGS);
var streaming = false;
var liveMsgId = null;
var status = 'checking'; // ok | checking | fail
var rawOpen = false;
var settingsOpen = false;
var editingId = null;
var editingText = '';
var rawLog = '';
var aborter = null;
var streamState = null;
var rafId = 0;
var rawRafId = 0;
var nearBottom = true;
var saveTimer = 0;

/* ================= ابزارهای DOM ================= */
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function findChatById(id) {
  for (var i = 0; i < chats.length; i++) if (chats[i].id === id) return chats[i];
  return null;
}
function getChat() { return findChatById(activeId) || chats[0] || null; }
function freshChat() {
  return { id: uid(), title: 'گفتگوی جدید', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
}
function fmtTime(ts) {
  var d = new Date(ts);
  return d.toLocaleDateString('fa-IR') + ' ' + d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
}

/* ================= localStorage ================= */
function loadChats() {
  try {
    var raw = localStorage.getItem('fm_chats');
    if (raw) {
      var arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch (e) { /* داده خراب — نادیده بگیر */ }
  return [];
}
function loadSettings() {
  try {
    var raw = localStorage.getItem('fm_settings');
    if (raw) return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
  } catch (e) { /* نادیده بگیر */ }
  return Object.assign({}, DEFAULT_SETTINGS);
}
function saveChats() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    try { localStorage.setItem('fm_chats', JSON.stringify(chats)); } catch (e) { /* حافظه پر */ }
  }, 250);
}
function saveSettingsNow() {
  try { localStorage.setItem('fm_settings', JSON.stringify(settings)); } catch (e) { /* نادیده بگیر */ }
}

/* ================= کپی و دانلود ================= */
async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch (e) {
    try {
      var ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) { return false; }
  }
}
function downloadFile(name, content, mime) {
  try {
    var blob = new Blob([content], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  } catch (e) { toast('دانلود ناموفق بود', 'err'); }
}

/* ═══════════ مارک‌داون امن (پورت دقیق از src/lib/markdown.ts) ═══════════ */

/* ---------- ذخیره کد بلوک‌ها برای دکمه «کپی» ---------- */
var codeStore = new Map();
var codeCounter = 0;
var MAX_STORE = 80;
function registerCode(code) {
  codeCounter++;
  var id = 'cb' + codeCounter;
  codeStore.set(id, code);
  if (codeStore.size > MAX_STORE) {
    var first = codeStore.keys().next();
    if (!first.done) codeStore.delete(first.value);
  }
  return id;
}
function getCodeById(id) {
  return codeStore.has(id) ? codeStore.get(id) : null;
}

/* ---------- escape امن HTML ---------- */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- هایلایت سینتکس ساده: کلیدواژه/رشته/عدد/کامنت ---------- */
var KEYWORDS = [
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'elif', 'for', 'while', 'do', 'switch',
  'case', 'break', 'continue', 'default', 'class', 'extends', 'new', 'this', 'self', 'super',
  'import', 'export', 'from', 'as', 'async', 'await', 'yield', 'try', 'catch', 'finally', 'throw',
  'raise', 'except', 'typeof', 'instanceof', 'delete', 'in', 'of', 'not', 'and', 'or', 'is', 'with',
  'def', 'pass', 'lambda', 'print', 'True', 'False', 'None', 'true', 'false', 'null', 'undefined',
  'void', 'int', 'float', 'str', 'bool', 'public', 'private', 'static', 'struct', 'enum',
  'interface', 'type', 'func', 'fn', 'impl', 'match', 'use', 'mut', 'pub', 'end', 'then'
];

var HASH_COMMENT_LANGS = /^(py|python|rb|ruby|sh|bash|zsh|shell|yml|yaml|toml|ini|conf|config|makefile|dockerfile|r|pl|perl)$/i;

function highlightCode(code, lang) {
  var hashComment = HASH_COMMENT_LANGS.test(lang.trim());
  var commentPart = hashComment
    ? '(#[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)'
    : '(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)';
  var re = new RegExp(
    commentPart +
      "|('(?:\\\\.|[^'\\\\\\n])*'|\"(?:\\\\.|[^\"\\\\\\n])*\"|\x60(?:\\\\.|[^\x60\\\\])*\x60)" +
      '|\\b(\\d+(?:\\.\\d+)?)\\b' +
      '|\\b(' + KEYWORDS.join('|') + ')\\b',
    'g'
  );
  var out = '';
  var last = 0;
  var m;
  while ((m = re.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    if (m[1]) out += '<span class="tok-comment">' + escapeHtml(m[1]) + '</span>';
    else if (m[2]) out += '<span class="tok-string">' + escapeHtml(m[2]) + '</span>';
    else if (m[3]) out += '<span class="tok-number">' + escapeHtml(m[3]) + '</span>';
    else out += '<span class="tok-keyword">' + escapeHtml(m[4]) + '</span>';
    last = m.index + m[0].length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

/* ---------- ساخت HTML بلوک کد با هدر زبان + دکمه کپی ---------- */
function codeBlockHtml(lang, code) {
  var id = registerCode(code);
  var shownLang = escapeHtml(lang || 'code');
  return (
    '<div class="md-code" dir="ltr">' +
    '<div class="md-code-head"><span class="md-code-lang">' + shownLang + '</span>' +
    '<button type="button" class="md-code-copy" data-code-id="' + id + '">کپی</button>' +
    '</div>' +
    '<pre class="md-pre"><code>' + highlightCode(code, lang) + '</code></pre>' +
    '</div>'
  );
}

/* ---------- پردازش inline: لینک/بولد/ایتالیک/خط‌خورده ---------- */
function inlineFormat(s) {
  var out = s;
  // لینک [متن](https://…) — فقط http/https برای امنیت
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>'
  );
  // بولد **…**
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // ایتالیک *…*
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  // خط‌خورده ~~…~~
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return out;
}

/**
 * تبدیل مارک‌داون به HTML امن
 * مراحل: استخراج بلوک کد → escape → کد اینلاین → پردازش بلاکی → بازگردانی placeholder ها
 */
function renderMarkdown(src) {
  if (!src) return '';

  /* ۱) استخراج بلوک‌های کد (حتی اگر در حین استریم هنوز بسته نشده باشند) */
  var codeBlocks = [];
  var text = src.replace(/\x60{3}([^\n\x60]*)\n?([\s\S]*?)(?:\x60{3}|$)/g, function (all, langLine, code) {
    codeBlocks.push({ lang: (langLine || '').trim().split(/\s+/)[0] || '', code: code });
    return '\u0000CB' + (codeBlocks.length - 1) + '\u0000';
  });

  /* ۲) escape کل متن — قبل از هر درج تگ */
  text = escapeHtml(text);

  /* ۳) کد اینلاین … → placeholder */
  var inlineCodes = [];
  text = text.replace(/\x60([^\x60\n]+)\x60/g, function (all, c) {
    inlineCodes.push(c);
    return '\u0000IC' + (inlineCodes.length - 1) + '\u0000';
  });

  /* ۴) پردازش بلاکی خط‌به‌خط */
  var lines = text.split('\n');
  var html = [];
  var para = [];
  var list = null; // {type:'ul'|'ol', items:[]}

  function flushParagraph() {
    if (!para.length) return;
    html.push('<p class="md-p">' + para.map(inlineFormat).join('<br/>') + '</p>');
    para = [];
  }
  function closeList() {
    if (!list) return;
    html.push(
      '<' + list.type + ' class="md-list">' +
      list.items.map(function (it) { return '<li>' + inlineFormat(it) + '</li>'; }).join('') +
      '</' + list.type + '>'
    );
    list = null;
  }

  var i = 0;
  while (i < lines.length) {
    var trimmed = lines[i].trim();

    // placeholder بلوک کد در خط مستقل
    var cb = trimmed.match(/^\u0000CB(\d+)\u0000$/);
    if (cb) {
      flushParagraph();
      closeList();
      var b = codeBlocks[Number(cb[1])];
      html.push(b ? codeBlockHtml(b.lang, b.code) : '');
      i++;
      continue;
    }

    // خط خالی
    if (!trimmed) {
      flushParagraph();
      closeList();
      i++;
      continue;
    }

    // هدینگ # … ######
    var h = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flushParagraph();
      closeList();
      var lv = h[1].length;
      html.push('<h' + lv + ' class="md-h">' + inlineFormat(h[2]) + '</h' + lv + '>');
      i++;
      continue;
    }

    // خط افقی --- *** ___
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      closeList();
      html.push('<hr class="md-hr"/>');
      i++;
      continue;
    }

    // نقل‌قول > (در متن escape شده به صورت &gt;)
    if (/^(&gt;|>)\s?/.test(trimmed)) {
      flushParagraph();
      closeList();
      var quote = [];
      while (i < lines.length) {
        var m2 = lines[i].trim().match(/^(&gt;|>)\s?(.*)$/);
        if (!m2) break;
        quote.push(m2[2]);
        i++;
      }
      html.push('<blockquote class="md-quote">' + quote.map(inlineFormat).join('<br/>') + '</blockquote>');
      continue;
    }

    // لیست نامرتب - * +
    var ul = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ul) {
      flushParagraph();
      if (!list || list.type !== 'ul') {
        closeList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(ul[1]);
      i++;
      continue;
    }

    // لیست مرتب 1. 2)
    var ol = trimmed.match(/^(\d{1,3})[.)]\s+(.+)$/);
    if (ol) {
      flushParagraph();
      if (!list || list.type !== 'ol') {
        closeList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(ol[2]);
      i++;
      continue;
    }

    // پاراگراف
    para.push(trimmed);
    i++;
  }
  flushParagraph();
  closeList();

  /* ۵) بازگردانی placeholder ها */
  var out = html.join('\n');
  out = out.replace(/\u0000CB(\d+)\u0000/g, function (a, n) {
    var bb = codeBlocks[Number(n)];
    return bb ? codeBlockHtml(bb.lang, bb.code) : '';
  });
  out = out.replace(/\u0000IC(\d+)\u0000/g, function (a, n) {
    return '<code class="md-icode">' + inlineCodes[Number(n)] + '</code>';
  });
  return out;
}

/** افزودن کرسر چشمک‌زن به انتهای HTML در حال استریم */
function appendCursor(html) {
  var cursor = '<span class="stream-cursor" aria-hidden="true"></span>';
  if (!html) return cursor;
  var idx = html.lastIndexOf('</p>');
  if (idx !== -1) return html.slice(0, idx) + cursor + html.slice(idx);
  return html + cursor;
}

/* ═══════════ پارسر جهانی SSE (پورت دقیق از src/lib/sse.ts) ═══════════
   پشتیبانی از همهٔ فرمت‌ها:
   - data: {"choices":[{"delta":{"content":"..."}}]}  (سبک OpenAI)
   - data: {"content":"..."} یا {"text":"..."}         (فیلد مستقیم)
   - {"content":"..."} بدون پیشوند data:               (آبجکت خام)
   - رشتهٔ خام غیر JSON                                 (مستقیم به متن)
   - data: [DONE]                                       (پایان استریم)
   فیلدهای تفکر: reasoning_content / reasoning / thinking / delta.thinking
*/
function createSseParser(opts) {
  var buf = '';         // بافر خطوط ناقص
  var pendingJson = ''; // JSON چندخطیِ ناقص

  function emit(text, reasoning, error) {
    text = text || '';
    reasoning = reasoning || '';
    if (text || reasoning || error) opts.onEvent({ text: text, reasoning: reasoning, error: error });
  }

  function addText(v, out) {
    if (typeof v === 'string') out.text += v;
    else if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) {
        var b = v[i];
        if (typeof b === 'string') out.text += b;
        else if (b && typeof b === 'object' && typeof b.text === 'string') out.text += b.text;
      }
    }
  }
  function addReason(v, out) {
    if (typeof v === 'string') out.reasoning += v;
  }

  function applyObject(obj) {
    var out = { text: '', reasoning: '' };
    var error;
    var o = obj;
    if (!o || typeof o !== 'object') {
      emit(String(obj));
      return;
    }

    // --- سبک OpenAI: choices[0].delta / choices[0].message ---
    var choice = Array.isArray(o.choices) ? o.choices[0] : undefined;
    if (choice && typeof choice === 'object') {
      var delta = choice.delta;
      var message = choice.message;
      if (delta && typeof delta === 'object') {
        addText(delta.content, out);
        addText(delta.text, out);
        addReason(delta.reasoning_content, out);
        addReason(delta.reasoning, out);
        addReason(delta.thinking, out);
      }
      if (message && typeof message === 'object') {
        addText(message.content, out);
        addText(message.text, out);
        addReason(message.reasoning_content, out);
        addReason(message.reasoning, out);
        addReason(message.thinking, out);
      }
      if (typeof choice.text === 'string') addText(choice.text, out);
    }

    // --- سبک Claude: delta.text / delta.thinking ---
    var topDelta = o.delta;
    if (topDelta && typeof topDelta === 'object') {
      addText(topDelta.text, out);
      addText(topDelta.content, out);
      addReason(topDelta.thinking, out);
      addReason(topDelta.reasoning_content, out);
      addReason(topDelta.reasoning, out);
    }
    var topMessage = o.message;
    if (topMessage && typeof topMessage === 'object') {
      addText(topMessage.content, out);
      addReason(topMessage.reasoning_content, out);
      addReason(topMessage.thinking, out);
    }

    // --- فیلدهای مستقیم روی ریشه ---
    addText(o.content, out);
    addText(o.text, out);
    addReason(o.reasoning_content, out);
    addReason(o.reasoning, out);
    addReason(o.thinking, out);

    // --- خطای داخل استریم ---
    if (o.error) {
      error = typeof o.error === 'string'
        ? o.error
        : (o.error && typeof o.error.message === 'string')
          ? o.error.message
          : JSON.stringify(o.error);
    }

    emit(out.text, out.reasoning, error);
  }

  function flushPending() {
    if (!pendingJson) return;
    emit(pendingJson); // JSON ناتمام → به‌صورت خام
    pendingJson = '';
  }

  function handlePayload(payload) {
    var t = payload.trim();
    if (!t) return;
    if (t === '[DONE]') return; // پایان استریم
    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      // JSON ممکن است چندخطی باشد؛ تا کامل شدن نگه می‌داریم
      pendingJson = pendingJson ? pendingJson + '\n' + payload : payload;
      try {
        applyObject(JSON.parse(pendingJson));
        pendingJson = '';
      } catch (e) { /* هنوز ناقص است؛ خط بعدی ادامه می‌دهد */ }
    } else {
      // رشتهٔ خام غیر JSON → مستقیم به متن
      flushPending();
      emit(payload);
    }
  }

  function processLine(line) {
    if (line === '') { flushPending(); return; }
    if (line.charAt(0) === ':') return; // کامنت SSE مثل ": ping"
    if (line.indexOf('data:') === 0) {
      var p = line.slice(5);
      if (p.charAt(0) === ' ') p = p.slice(1);
      handlePayload(p);
      return;
    }
    if (/^(event|id|retry)\s*:/i.test(line)) return; // متادیتای SSE
    handlePayload(line); // خط خام (مثلاً {"content":"..."} بدون data:)
  }

  return {
    feed: function (chunk) {
      buf += chunk;
      var nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        var line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        processLine(line);
      }
    },
    end: function () {
      if (buf.trim()) {
        processLine(buf.replace(/\r$/, ''));
        buf = '';
      }
      if (pendingJson) {
        emit(pendingJson);
        pendingJson = '';
      }
    }
  };
}

/* ================= توست ================= */
function toast(text, kind) {
  try {
    var box = $('toasts');
    var t = el('div', 'toast ' + (kind === 'err' ? 'toast-err' : 'toast-ok'), text);
    box.appendChild(t);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2800);
  } catch (e) { /* نادیده بگیر */ }
}

/* ═══════════ رندر UI ═══════════ */

function renderStatus() {
  var dot = $('status-dot');
  var txt = $('status-text');
  dot.className = 'dot ' + (status === 'ok' ? 'dot-ok' : status === 'checking' ? 'dot-check' : 'dot-fail');
  txt.textContent = status === 'ok' ? 'متصل' : status === 'checking' ? 'در حال بررسی…' : 'بدون اتصال';
  $('status-box').title = txt.textContent;
}

function renderComposer() {
  $('btn-send').hidden = streaming;
  $('btn-stop').hidden = !streaming;
  $('btn-new').disabled = streaming;
}

function renderSidebar() {
  var listEl = $('chat-list');
  listEl.innerHTML = '';
  var cur = getChat();
  for (var i = 0; i < chats.length; i++) {
    (function (c) {
      var isActive = !!(cur && c.id === cur.id);
      var item = el('div', 'chat-item' + (isActive ? ' active' : ''));
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      var ic = el('span', 'chat-ic' + (isActive ? '' : ' dim'), '💬');
      var t = el('span', 'chat-title', c.title);
      t.title = c.title;
      var del = el('button', 'chat-del', '✕');
      del.type = 'button';
      del.setAttribute('aria-label', 'حذف گفتگوی ' + c.title);
      del.title = 'حذف';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteChat(c.id);
      });
      item.appendChild(ic);
      item.appendChild(t);
      item.appendChild(del);
      item.addEventListener('click', function () { switchChat(c.id); });
      item.addEventListener('keydown', function (e) { if (e.key === 'Enter') switchChat(c.id); });
      listEl.appendChild(item);
    })(chats[i]);
  }
}

/* ---------- ساخت المان یک پیام ---------- */
function messageEl(m, isLastAssistant, liveFlag) {
  var isUser = m.role === 'user';
  var col = el('div', 'msg-col ' + (isUser ? 'from-user' : 'from-assistant'));
  if (liveFlag) col.id = 'msg-live';

  // برچسب نقش
  var role = el('div', 'msg-role');
  if (isUser) {
    role.appendChild(el('span', null, '👤 شما'));
  } else {
    role.appendChild(el('span', 'avatar', '🤖'));
    role.appendChild(el('span', null, 'دستیار'));
  }
  col.appendChild(role);

  // حباب پیام
  var bub = el('div', 'bubble ' + (isUser ? 'bub-user' : (m.isError && !m.content ? 'bub-err' : 'bub-asst')));
  bub.dir = 'auto';

  // باکس تفکر مدل (بالای پاسخ)
  if (!isUser && m.reasoning) {
    var th = el('details', 'think-box');
    var sum = el('summary', null, '💭 فرایند تفکر مدل');
    th.appendChild(sum);
    var tb = el('div', 'think-body', m.reasoning);
    tb.dir = 'auto';
    th.appendChild(tb);
    if (liveFlag) {
      // حین استریم: حین تفکر باز، بعد از شروع پاسخ بسته (و بعدش انتخاب کاربر محترم است)
      if (!m.content) th.open = true;
      else if (!streamState.thinkSwitched) { th.open = false; streamState.thinkSwitched = true; }
      else {
        var oldNode = document.getElementById('msg-live');
        var oldThink = oldNode ? oldNode.querySelector('details.think-box') : null;
        th.open = oldThink ? oldThink.open : false;
      }
    } else {
      th.open = false;
    }
    bub.appendChild(th);
  }

  // محتوای پیام / ویرایش اینلاین
  if (editingId === m.id && isUser) {
    var wrap = el('div', 'edit-wrap');
    var eta = el('textarea', 'edit-ta');
    eta.dir = 'auto';
    eta.value = editingText;
    eta.rows = Math.min(10, Math.max(2, editingText.split('\n').length + 1));
    eta.addEventListener('input', function () {
      editingText = eta.value;
      eta.rows = Math.min(10, Math.max(2, eta.value.split('\n').length + 1));
    });
    wrap.appendChild(eta);
    var row = el('div', 'edit-row');
    var save = el('button', 'btn-mini btn-save', '✓ ذخیره و ارسال دوباره');
    save.type = 'button';
    save.addEventListener('click', function () { onEditSave(m.id); });
    var cancel = el('button', 'btn-mini btn-cancel', '✕ انصراف');
    cancel.type = 'button';
    cancel.addEventListener('click', onEditCancel);
    row.appendChild(save);
    row.appendChild(cancel);
    wrap.appendChild(row);
    bub.appendChild(wrap);
    setTimeout(function () { eta.focus(); }, 0);
  } else if (isUser) {
    bub.appendChild(el('span', 'user-text', m.content));
  } else if (m.content) {
    var md = el('div', 'md-body');
    md.innerHTML = liveFlag ? appendCursor(renderMarkdown(m.content)) : renderMarkdown(m.content);
    bub.appendChild(md);
  } else if (liveFlag) {
    bub.appendChild(el('span', 'stream-cursor'));
  }

  // خطای داخل پیام
  if (!isUser && m.errorText) bub.appendChild(el('div', 'msg-err', m.errorText));
  // نشان توقف
  if (!isUser && m.stopped) bub.appendChild(el('span', 'badge-stop', '⏹ متوقف شد'));
  col.appendChild(bub);

  // اکشن‌ها + آمار
  var foot = el('div', 'msg-actions');
  var acts = el('div', 'act-btns');
  function mkBtn(label, title, fn, cls) {
    var b = el('button', 'act-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', fn);
    return b;
  }
  acts.appendChild(mkBtn('📋', 'کپی', function () { copyMsg(m); }));
  if (isUser) acts.appendChild(mkBtn('✏️', 'ویرایش', function () { onEditStart(m); }));
  if (!isUser && isLastAssistant && !liveFlag && !streaming) {
    acts.appendChild(mkBtn('↻', 'بازتولید', function () { onRegenerate(m.id); }));
  }
  acts.appendChild(mkBtn('🗑', 'حذف', function () { deleteMsg(m.id); }, 'danger'));
  foot.appendChild(acts);

  if (!isUser && (liveFlag || m.timeSec != null)) {
    var stats = el('span', 'msg-stats');
    if (liveFlag && !m.content) {
      stats.textContent = '⏳ در حال دریافت پاسخ…';
    } else {
      var parts = [];
      if (m.timeSec != null) parts.push('⏱ ' + m.timeSec + ' ثانیه');
      if (m.chunks != null) parts.push('🧩 ' + m.chunks + ' تکه');
      if (m.chars != null) parts.push('✍️ ' + m.chars + ' نویسه');
      stats.textContent = parts.join(' · ');
    }
    foot.appendChild(stats);
  }
  col.appendChild(foot);
  return col;
}

/* ---------- صفحهٔ خوش‌آمد با ۴ پیشنهاد ---------- */
function welcomeEl() {
  var w = el('div', 'welcome');
  w.appendChild(el('div', 'w-ic', '✨'));
  var hw = el('div', 'w-head');
  hw.appendChild(el('h2', null, 'چت هوشمند'));
  hw.appendChild(el('p', null, 'سوالی داری؟ بپرس — پاسخ را زنده و استریمی می‌گیری.'));
  w.appendChild(hw);
  var grid = el('div', 'w-grid');
  for (var i = 0; i < SUGGESTIONS.length; i++) {
    (function (s) {
      var b = el('button', 'w-card');
      b.type = 'button';
      b.appendChild(el('span', 'w-card-ic', s.icon));
      var bt = el('span', 'w-card-t');
      bt.appendChild(el('span', 'w-card-title', s.title));
      bt.appendChild(el('span', 'w-card-text', s.text));
      b.appendChild(bt);
      b.addEventListener('click', function () { send(s.text); });
      grid.appendChild(b);
    })(SUGGESTIONS[i]);
  }
  w.appendChild(grid);
  return w;
}

/* ---------- اسکرول خودکار ---------- */
function maybeScroll() {
  if (!nearBottom) return;
  var c = $('chat-area');
  c.scrollTop = c.scrollHeight;
}

/* ---------- رندر کل ناحیهٔ چت ---------- */
function renderChat() {
  var area = $('chat-inner');
  area.innerHTML = '';
  var chat = getChat();
  var msgs = chat ? chat.messages : [];
  if (!msgs.length && !streaming) {
    area.appendChild(welcomeEl());
    return;
  }
  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    area.appendChild(messageEl(m, m.role === 'assistant' && i === msgs.length - 1, m.id === liveMsgId));
  }
  maybeScroll();
}

/* ---------- به‌روزرسانی زندهٔ پیام در حال استریم (هر فریم حداکثر یک بار) ---------- */
function updateLive() {
  var chat = getChat();
  if (!chat || !streamState) return;
  var msgs = chat.messages;
  var m = null, idx = -1;
  for (var i = 0; i < msgs.length; i++) {
    if (msgs[i].id === streamState.msgId) { m = msgs[i]; idx = i; break; }
  }
  if (!m) return;
  m.content = streamState.content;
  m.reasoning = streamState.reasoning || null;
  var node = messageEl(m, m.role === 'assistant' && idx === msgs.length - 1, true);
  var old = document.getElementById('msg-live');
  if (old && old.parentNode) old.parentNode.replaceChild(node, old);
  else renderChat();
  maybeScroll();
}
function flushNow() { if (streamState) updateLive(); }
function scheduleFlush() {
  if (rafId) return;
  rafId = requestAnimationFrame(function () {
    rafId = 0;
    flushNow();
  });
}

/* ---------- پنل Raw SSE ---------- */
function appendRaw(s) {
  rawLog += s;
  if (rawLog.length > MAX_RAW_LOG) rawLog = rawLog.slice(-MAX_RAW_LOG);
  if (!rawOpen || rawRafId) return;
  rawRafId = requestAnimationFrame(function () {
    rawRafId = 0;
    var p = $('raw-pre');
    p.textContent = rawLog;
    p.scrollTop = p.scrollHeight;
    $('raw-size').textContent = (rawLog.length / 1024).toFixed(1) + 'KB';
  });
}
function renderRaw() {
  $('raw-panel').hidden = !rawOpen;
  $('btn-raw').className = 'hbtn' + (rawOpen ? ' on' : '');
  if (rawOpen) {
    var p = $('raw-pre');
    p.textContent = rawLog;
    p.scrollTop = p.scrollHeight;
    $('raw-size').textContent = (rawLog.length / 1024).toFixed(1) + 'KB';
  }
}
function clearRaw() {
  rawLog = '';
  $('raw-pre').textContent = '';
  $('raw-size').textContent = '0.0KB';
}

/* ═══════════ اکشن‌های پیام ═══════════ */

function copyMsg(m) {
  copyText(m.content).then(function (ok) {
    toast(ok ? 'پیام کپی شد ✓' : 'کپی ناموفق بود', ok ? 'ok' : 'err');
  });
}
function deleteMsg(id) {
  if (streaming) return;
  var chat = getChat();
  if (!chat) return;
  chat.messages = chat.messages.filter(function (x) { return x.id !== id; });
  toast('پیام حذف شد');
  renderChat();
  saveChats();
}
function onEditStart(m) {
  editingId = m.id;
  editingText = m.content;
  renderChat();
}
function onEditCancel() {
  editingId = null;
  renderChat();
}
function onEditSave(id) {
  var newText = editingText.trim();
  if (!newText || streaming) return;
  var chat = getChat();
  if (!chat) return;
  var idx = -1;
  for (var i = 0; i < chat.messages.length; i++) {
    if (chat.messages[i].id === id) { idx = i; break; }
  }
  if (idx === -1) return;
  // ذخیره = حذف پیام‌های بعدی + ارسال دوباره
  var history = chat.messages.slice(0, idx).concat([Object.assign({}, chat.messages[idx], { content: newText })]);
  editingId = null;
  chat.messages = history;
  chat.updatedAt = Date.now();
  toast('پیام ویرایش شد — پاسخ دوباره تولید می‌شود');
  renderChat();
  saveChats();
  runCompletion(chat.id, history);
}
function onRegenerate(id) {
  if (streaming) return;
  var chat = getChat();
  if (!chat) return;
  var idx = -1;
  for (var i = 0; i < chat.messages.length; i++) {
    if (chat.messages[i].id === id) { idx = i; break; }
  }
  if (idx === -1) return;
  var history = chat.messages.slice(0, idx).filter(function (m) { return !m.isError && !m.errorText; });
  chat.messages = history;
  chat.updatedAt = Date.now();
  renderChat();
  saveChats();
  runCompletion(chat.id, history);
}

/* ═══════════ اکشن‌های گفتگو ═══════════ */

function newChat() {
  if (streaming) return;
  var c = freshChat();
  chats.unshift(c);
  activeId = c.id;
  closeSidebar();
  renderSidebar();
  renderChat();
}
function deleteChat(id) {
  if (streaming && id === activeId) return;
  chats = chats.filter(function (c) { return c.id !== id; });
  if (!chats.length) chats = [freshChat()];
  if (id === activeId) activeId = chats[0].id;
  toast('گفتگو حذف شد');
  renderSidebar();
  renderChat();
  saveChats();
}
function clearAllChats() {
  if (!window.confirm('همه گفتگوها پاک شوند؟ این عمل قابل بازگشت نیست.')) return;
  chats = [freshChat()];
  activeId = chats[0].id;
  closeSidebar();
  toast('همه گفتگوها پاک شد');
  renderSidebar();
  renderChat();
  saveChats();
}
function switchChat(id) {
  if (streaming) return;
  activeId = id;
  editingId = null;
  closeSidebar();
  nearBottom = true;
  renderSidebar();
  renderChat();
}

/* ═══════════ خروجی Markdown / JSON ═══════════ */

function exportMarkdown() {
  var chat = getChat();
  if (!chat || !chat.messages.length) { toast('این گفتگو خالی است', 'err'); return; }
  var lines = ['# ' + chat.title, '', '- مدل: ' + settings.modelId, '- تاریخ خروجی: ' + fmtTime(Date.now()), '', '---', ''];
  for (var i = 0; i < chat.messages.length; i++) {
    var m = chat.messages[i];
    lines.push(m.role === 'user' ? '## 👤 کاربر' : '## 🤖 دستیار');
    lines.push('');
    lines.push(m.content || (m.errorText != null ? m.errorText : ''));
    if (m.timeSec != null) {
      lines.push('');
      lines.push('> ⏱ ' + m.timeSec + ' ثانیه · 🧩 ' + m.chunks + ' تکه · ✍️ ' + m.chars + ' نویسه' + (m.stopped ? ' · ⏹ متوقف شد' : ''));
    }
    lines.push('');
  }
  var name = (chat.title || 'chat').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 40);
  downloadFile(name + '.md', lines.join('\n'), 'text/markdown');
  toast('فایل Markdown دانلود شد ✓');
}
function exportJson() {
  if (!chats.length) { toast('گفتگویی برای خروجی نیست', 'err'); return; }
  downloadFile('fm-chats-backup.json', JSON.stringify({ exportedAt: new Date().toISOString(), chats: chats }, null, 2), 'application/json');
  toast('فایل JSON دانلود شد ✓');
}

/* ═══════════ تست اتصال (ping) ═══════════ */

function runPing() {
  status = 'checking';
  renderStatus();
  fetch('/api/ping')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j && j.status === 'ok') {
        status = 'ok';
        renderStatus();
        toast('اتصال برقرار است · ' + (j.ms != null ? j.ms : '?') + ' ms');
      } else {
        status = 'fail';
        renderStatus();
        toast('اتصال به سرویس برقرار نیست', 'err');
      }
    })
    .catch(function () {
      status = 'fail';
      renderStatus();
      toast('خطا در بررسی اتصال', 'err');
    });
}

/* ═══════════ هستهٔ ارسال و استریم ═══════════ */

/** توقف استریم (دکمه ⏹ یا Esc) */
function stopStream() {
  if (aborter) aborter.abort();
}

/** اتمام پیام استریمی — آمار/خطا/نشان توقف را نهایی می‌کند */
function finishMsg(abortedFlag, err) {
  var st = streamState;
  if (!st) return;
  var chat = findChatById(st.chatId);
  if (!chat) return;
  var msgs = chat.messages;
  var idx = -1, m = null;
  for (var i = 0; i < msgs.length; i++) {
    if (msgs[i].id === st.msgId) { idx = i; m = msgs[i]; break; }
  }

  // توقف قبل از رسیدن هرچیزی → حباب خالی حذف شود
  if (abortedFlag && !st.content && !st.reasoning) {
    if (idx !== -1) msgs.splice(idx, 1);
    renderChat();
    return;
  }

  var secs = Math.round((Date.now() - st.started) / 100) / 10;
  var content = st.content;
  var errorText = null;
  var isError = false;
  var stopped = abortedFlag;

  if (!abortedFlag) {
    if (st.error) {
      errorText = '❌ ' + st.error;
      isError = true;
    } else if (err && err.httpStatus) {
      errorText = '❌ HTTP ' + err.httpStatus + (err.httpBody ? ' — ' + err.httpBody : '');
      isError = true;
    } else if (err) {
      errorText = '❌ خطا در ارتباط با سرور — مطمئن شوید سرور در حال اجرا است و اتصال اینترنت برقرار است. (' + (err.message || '') + ')';
      isError = true;
    } else if (!content.trim() && !st.reasoning) {
      content = 'پاسخ خالی از سرور دریافت شد';
      isError = true;
    }
  }

  if (idx !== -1) {
    m.content = content;
    m.reasoning = st.reasoning || null;
    m.errorText = errorText;
    m.isError = isError ? true : undefined;
    m.stopped = stopped ? true : undefined;
    m.timeSec = secs;
    m.chunks = st.chunks;
    m.chars = content.length;
  }
  chat.updatedAt = Date.now();
  renderChat();
}

/** اجرای پاسخ: payload → /api/chat → استریم زنده یا JSON */
async function runCompletion(chatId, history) {
  var aid = uid();
  var chat = findChatById(chatId);
  if (!chat) return;

  // پیام placeholder دستیار
  chat.messages = history.concat([{ id: aid, role: 'assistant', content: '', createdAt: Date.now() }]);
  chat.updatedAt = Date.now();
  streamState = { chatId: chatId, msgId: aid, content: '', reasoning: '', chunks: 0, error: null, started: Date.now(), thinkSwitched: false };
  streaming = true;
  liveMsgId = aid;
  nearBottom = true;
  renderChat();
  renderComposer();
  renderSidebar();
  saveChats();

  aborter = new AbortController();

  try {
    // حافظه مکالمه: کل تاریخچه (فقط role و content) + system prompt اختیاری
    var payloadMsgs = [];
    var sp = (settings.systemPrompt || '').trim();
    if (sp) payloadMsgs.push({ role: 'system', content: sp });
    for (var i = 0; i < history.length; i++) {
      var hm = history[i];
      if (hm.isError || hm.errorText) continue; // پیام‌های خطا از payload حذف شوند
      payloadMsgs.push({ role: hm.role, content: hm.content });
    }

    var res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: payloadMsgs,
        modelId: settings.modelId,
        thinking: settings.thinking,
        deepSearch: settings.deepSearch,
        stream: settings.stream
      }),
      signal: aborter.signal
    });

    if (!res.ok) {
      var errBody = '';
      try { errBody = (await res.text()).slice(0, 300); } catch (e2) { /* noop */ }
      var he = new Error('http');
      he.httpStatus = res.status;
      he.httpBody = errBody;
      throw he;
    }

    var parser = createSseParser({
      onEvent: function (ev) {
        var st = streamState;
        if (!st) return;
        st.chunks++;
        if (ev.text) st.content += ev.text;
        if (ev.reasoning) st.reasoning += ev.reasoning;
        if (ev.error) st.error = ev.error;
        scheduleFlush();
      }
    });

    if (settings.stream && res.body) {
      /* استریم زنده */
      var reader = res.body.getReader();
      var dec = new TextDecoder('utf-8');
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        var chunk = dec.decode(r.value, { stream: true });
        appendRaw(chunk);
        parser.feed(chunk);
      }
      parser.end();
    } else {
      /* پاسخ JSON معمولی */
      var full = await res.text();
      appendRaw(full);
      parser.feed(full);
      parser.end();
    }
    flushNow();
    finishMsg(false, null);
  } catch (e) {
    flushNow();
    var wasAbort = (aborter && aborter.signal.aborted) || (e && e.name === 'AbortError');
    finishMsg(wasAbort, e);
  } finally {
    streamState = null;
    aborter = null;
    liveMsgId = null;
    streaming = false;
    renderChat();
    renderComposer();
    renderSidebar();
    saveChats();
  }
}

/** ارسال پیام (Enter یا کلیک یا کلیک روی پیشنهاد) */
function send(rawText) {
  var text = (rawText != null ? rawText : $('ta').value).trim();
  if (!text || streaming) return;

  var chat = getChat();
  if (!chat) {
    chat = freshChat();
    chats.unshift(chat);
    activeId = chat.id;
  }

  var isFirst = chat.messages.length === 0;
  var userMsg = { id: uid(), role: 'user', content: text, createdAt: Date.now() };
  var history = chat.messages.concat([userMsg]);

  $('ta').value = '';
  autoResize();

  if (isFirst) chat.title = text.slice(0, 40); // عنوان = ۴۰ کاراکتر اول اولین پیام
  chat.messages = history;
  chat.updatedAt = Date.now();
  renderSidebar();
  renderChat();
  saveChats();
  runCompletion(chat.id, history);
}

/* ═══════════ سایدبار موبایل / مودال ═══════════ */

function openSidebar() {
  $('sidebar').classList.add('open');
  $('overlay').hidden = false;
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('overlay').hidden = true;
}
function openSettings() {
  $('sys-prompt').value = settings.systemPrompt || '';
  settingsOpen = true;
  $('modal').hidden = false;
  $('sys-prompt').focus();
}
function closeSettings() {
  settingsOpen = false;
  $('modal').hidden = true;
}

/* ═══════════ ابزارهای فرم ═══════════ */

function autoResize() {
  var ta = $('ta');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
}

/* ═══════════ بخش API و کلیدها در مودال تنظیمات ═══════════ */
function renderApiInfo() {
  var FM = window.__FM__ || {};
  var openaiKey = FM.openaiKey || '—';
  var anthropicKey = FM.anthropicKey || '—';
  var base = window.location.origin;
  var model = (settings.modelId || FM.defaultModel || 'claude-fable-5.1').trim() || 'claude-fable-5.1';

  var ko = $('key-openai');
  var ka = $('key-anthropic');
  if (ko) ko.textContent = openaiKey;
  if (ka) ka.textContent = anthropicKey;

  var eps = $('api-eps');
  if (eps) {
    eps.textContent = 'POST ' + base + '/v1/chat/completions    (OpenAI-compatible)\nPOST ' + base + '/v1/messages               (Anthropic-compatible)\nGET  ' + base + '/v1/models';
  }

  var curl = $('api-curl');
  if (curl) {
    curl.textContent =
      '# OpenAI\ncurl ' + base + '/v1/chat/completions \\\n' +
      '  -H "Authorization: Bearer ' + openaiKey + '" \\\n' +
      '  -H "Content-Type: application/json" \\\n' +
      '  -d \'{"model":"' + model + '","messages":[{"role":"user","content":"Hello"}],"stream":true}\'\n\n' +
      '# Anthropic\ncurl ' + base + '/v1/messages \\\n' +
      '  -H "x-api-key: ' + anthropicKey + '" \\\n' +
      '  -H "anthropic-version: 2023-06-01" \\\n' +
      '  -H "Content-Type: application/json" \\\n' +
      '  -d \'{"model":"' + model + '","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}\'';
  }

  var b1 = $('btn-key-openai');
  var b2 = $('btn-key-anthropic');
  if (b1) b1.addEventListener('click', async function () {
    var ok = await copyText(openaiKey);
    if (ok) { b1.textContent = 'کپی شد ✓'; setTimeout(function () { b1.textContent = 'کپی'; }, 1500); }
  });
  if (b2) b2.addEventListener('click', async function () {
    var ok = await copyText(anthropicKey);
    if (ok) { b2.textContent = 'کپی شد ✓'; setTimeout(function () { b2.textContent = 'کپی'; }, 1500); }
  });
}

/* ═══════════ پیکر مدل (مثل سایت freemodels — گروهی با لوگو و تیک) ═══════════ */

var mpOpen = false; // پیکر مدل باز است؟

/* آیکن‌های SVG گروه‌ها (دقیقاً مسیرهای lucide در سایت مرجع) */
var MP_GROUP_ICONS = {
  'Claude Pro': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"></path><path d="M20 2v4"></path><path d="M22 4h-4"></path><circle cx="4" cy="20" r="2"></circle></svg>',
  'ChatGPT Pro': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"></path></svg>',
  'Other Pro Models': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>'
};
var MP_CHECK_SVG = '<svg class="mp-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';

/* نگاشت «نام» آیکن (providers.json → groups[].icon) به SVG — تا گروه جدید بدون
   تغییر کد آیکن درست بگیرد؛ نام ناشناخته ← globe */
var MP_ICON_SVG = {
  sparkles: MP_GROUP_ICONS['Claude Pro'],
  zap: MP_GROUP_ICONS['ChatGPT Pro'],
  globe: MP_GROUP_ICONS['Other Pro Models'],
  flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2v7.31"></path><path d="M14 9.3V1.99"></path><path d="M8.5 2h7"></path><path d="M14 9.3a6.5 6.5 0 1 1-4 0"></path><path d="M5.58 16.5h12.85"></path></svg>',
  bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2"></path><path d="M20 14h2"></path><path d="M15 13v2"></path><path d="M9 13v2"></path></svg>',
  brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"></path><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"></path><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"></path><path d="M6 18a4 4 0 0 1-1.967-.516"></path><path d="M19.967 17.484A4 4 0 0 1 18 18"></path></svg>',
};

/** مدل فعلی بر اساس تنظیمات (تطبیق نرم با نام هم انجام می‌شود) */
function currentModel() {
  var raw = (settings.modelId || '').trim();
  var idNorm = raw.toLowerCase().replace(/[\s_]+/g, '-');
  for (var i = 0; i < MODELS.length; i++) {
    if (MODELS[i].id === idNorm || MODELS[i].name.toLowerCase() === raw.toLowerCase()) return MODELS[i];
  }
  return null;
}

/** به‌روزرسانی دکمهٔ هدر (لوگو + نام مدل فعلی) */
function updateModelBtn() {
  var m = currentModel();
  var img = $('model-btn-logo');
  var name = $('model-btn-name');
  if (m) {
    img.src = m.logo;
    img.style.display = '';
    name.textContent = m.name;
  } else {
    img.style.display = 'none';
    name.textContent = settings.modelId || 'modelId';
  }
}

/** باز/بسته کردن پاپ‌آپ پیکر */
function setPickerOpen(v) {
  mpOpen = v;
  var pop = $('model-pop');
  var btn = $('model-btn');
  if (!pop || !btn) return;
  pop.hidden = !v;
  btn.classList.toggle('mp-open', v);
  btn.setAttribute('aria-expanded', v ? 'true' : 'false');
}

/** ساخت محتوای پاپ‌آپ — گروه‌بندی شده مثل سایت */
function buildPicker() {
  var pop = $('model-pop');
  if (!pop) return;
  pop.innerHTML = '';

  /* ترتیب و آیکن گروه‌ها: اول از سرور (providers.json → groups)، بعد گروه‌های
     دیده‌شده در MODELS (تا هیچ مدلی بی‌گروه نماند) */
  var groups = [];
  var groupIcons = {};
  var srvGroups = FM_DATA.groups || [];
  var k;
  for (k = 0; k < srvGroups.length; k++) {
    var gt = srvGroups[k] && srvGroups[k].title;
    if (!gt || groups.indexOf(gt) >= 0) continue;
    groups.push(gt);
    groupIcons[gt] = MP_ICON_SVG[srvGroups[k].icon] || MP_GROUP_ICONS[gt] || MP_ICON_SVG.globe;
  }
  for (var i = 0; i < MODELS.length; i++) {
    var mg = MODELS[i].group;
    if (groups.indexOf(mg) < 0) {
      groups.push(mg);
      groupIcons[mg] = MP_GROUP_ICONS[mg] || MP_ICON_SVG.globe;
    }
  }

  groups.forEach(function (g) {
    var gd = el('div', 'mp-group');

    var gh = el('div', 'mp-ghead');
    gh.innerHTML = (groupIcons[g] || '') + '<span></span>';
    gh.lastChild.textContent = g; // عنوان گروه به‌صورت متن امن
    gd.appendChild(gh);

    var list = el('div'); // نگه‌دارندهٔ سادهٔ ردیف‌ها
    for (var j = 0; j < MODELS.length; j++) {
      var m = MODELS[j];
      if (m.group !== g) continue;
      (function (model) {
        var sel = model.id === settings.modelId;
        var row = el('button', 'mp-row' + (sel ? ' sel' : ''));
        row.type = 'button';
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', sel ? 'true' : 'false');

        var img = document.createElement('img');
        img.className = 'mp-logo';
        img.src = model.logo;
        img.width = 20;
        img.height = 20;
        img.alt = model.name;
        row.appendChild(img);

        var txt = el('div', 'mp-txt');
        txt.appendChild(el('div', 'mp-mname', model.name));
        txt.appendChild(el('div', 'mp-mvendor', model.vendor));
        row.appendChild(txt);

        if (sel) {
          var chkWrap = document.createElement('span');
          chkWrap.innerHTML = MP_CHECK_SVG;
          row.appendChild(chkWrap.firstChild);
        }

        row.addEventListener('click', function () {
          settings.modelId = model.id;
          saveSettingsNow();
          updateModelBtn();
          buildPicker();          // جای تیک را به‌روز کن
          setPickerOpen(false);
          toast('مدل روی ' + model.name + ' تنظیم شد ✓');
        });
        list.appendChild(row);
      })(m);
    }
    gd.appendChild(list);
    pop.appendChild(gd);
  });
}

/* ═══════════ اتصال رویدادها و شروع ═══════════ */

function init() {
  // بارگذاری از localStorage
  chats = loadChats();
  if (chats.length) {
    activeId = chats[0].id;
  } else {
    var c = freshChat();
    chats = [c];
    activeId = c.id;
  }
  settings = loadSettings();

  // اعمال تنظیمات روی هدر
  buildPicker();
  updateModelBtn();
  $('ck-thinking').checked = !!settings.thinking;
  $('ck-deep').checked = !!settings.deepSearch;
  $('ck-stream').checked = !!settings.stream;

  // هدر
  $('btn-ping').addEventListener('click', runPing);
  $('btn-raw').addEventListener('click', function () {
    rawOpen = !rawOpen;
    renderRaw();
  });
  $('btn-settings').addEventListener('click', openSettings);
  $('model-btn').addEventListener('click', function (e) {
    e.stopPropagation();
    setPickerOpen(!mpOpen);
  });
  /* بستن پیکر با کلیک بیرون از آن */
  document.addEventListener('mousedown', function (e) {
    if (!mpOpen) return;
    var wrap = $('model-picker');
    if (wrap && !wrap.contains(e.target)) setPickerOpen(false);
  });
  document.addEventListener('touchstart', function (e) {
    if (!mpOpen) return;
    var wrap = $('model-picker');
    if (wrap && !wrap.contains(e.target)) setPickerOpen(false);
  }, { passive: true });
  $('ck-thinking').addEventListener('change', function () { settings.thinking = this.checked; saveSettingsNow(); });
  $('ck-deep').addEventListener('change', function () { settings.deepSearch = this.checked; saveSettingsNow(); });
  $('ck-stream').addEventListener('change', function () { settings.stream = this.checked; saveSettingsNow(); });

  // سایدبار
  $('btn-menu').addEventListener('click', openSidebar);
  $('btn-sb-close').addEventListener('click', closeSidebar);
  $('overlay').addEventListener('click', closeSidebar);
  $('btn-new').addEventListener('click', newChat);
  $('btn-exp-md').addEventListener('click', exportMarkdown);
  $('btn-exp-json').addEventListener('click', exportJson);
  $('btn-clear').addEventListener('click', clearAllChats);

  // پنل Raw SSE
  $('raw-clear').addEventListener('click', clearRaw);
  $('raw-close').addEventListener('click', function () {
    rawOpen = false;
    renderRaw();
  });

  // مودال تنظیمات
  $('modal-x').addEventListener('click', closeSettings);
  $('modal-cancel').addEventListener('click', closeSettings);
  $('modal-ov').addEventListener('click', closeSettings);
  $('modal-save').addEventListener('click', function () {
    settings.systemPrompt = $('sys-prompt').value.trim();
    saveSettingsNow();
    closeSettings();
    toast('تنظیمات ذخیره شد ✓');
  });

  // بخش API و کلیدها (مقادیر از سرور تزریق شده‌اند)
  renderApiInfo();

  // کامپوزر
  var ta = $('ta');
  ta.addEventListener('input', autoResize);
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  $('btn-send').addEventListener('click', function () { send(); });
  $('btn-stop').addEventListener('click', stopStream);

  // اسکرول و کپی بلوک کد (delegation)
  var area = $('chat-area');
  area.addEventListener('scroll', function () {
    nearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 90;
  });
  area.addEventListener('click', async function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button[data-code-id]') : null;
    if (!btn) return;
    var code = getCodeById(btn.getAttribute('data-code-id') || '');
    if (code != null) {
      var ok = await copyText(code);
      if (ok) {
        btn.textContent = 'کپی شد ✓';
        setTimeout(function () { btn.textContent = 'کپی'; }, 1500);
      } else {
        toast('کپی ناموفق بود', 'err');
      }
    }
  });

  // میان‌بر Esc: توقف استریم / بستن پنل‌ها
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (streaming) {
      stopStream();
    } else if (mpOpen) {
      setPickerOpen(false);
    } else if (settingsOpen) {
      closeSettings();
    } else if (rawOpen) {
      rawOpen = false;
      renderRaw();
    }
  });

  // قطع درخواست هنگام بستن صفحه
  window.addEventListener('pagehide', function () { if (aborter) aborter.abort(); });

  // رندر اولیه
  renderStatus();
  renderComposer();
  renderRaw();
  renderSidebar();
  renderChat();

  // ping خودکار هنگام لود
  runPing();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
`;

/* ═══════════════════════════════════════════════════════════════════════════
   صفحهٔ HTML (ترکیب CSS و JS بالا)
   ═══════════════════════════════════════════════════════════════════════════ */
/* دیتای تزریق‌شده به کلاینت: کاتالوگ زندهٔ مدل‌ها/گروه‌ها (از providers.json)
   + کلیدهای API برای بخش ⚙️ تنظیمات. در هر درخواست ساخته می‌شود تا تغییر
   providers.json بدون restart در پیکر مدل دیده شود. */
function serverDataJson() {
  const cat = publicCatalog(getProviders());
  return JSON.stringify({
    models: cat.models,
    groups: cat.groups,
    defaultModel: cat.defaultModel,
    openaiKey: API_KEYS.openai,
    anthropicKey: API_KEYS.anthropic,
  });
}

const PAGE_HTML = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1220">
<title>چت هوشمند</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
${PAGE_CSS}
</style>
</head>
<body>
<div id="app">

  <!-- ═══ هدر ═══ -->
  <header id="topbar">
    <button id="btn-menu" class="icon-btn only-mobile" type="button" aria-label="باز کردن منوی گفتگوها" title="گفتگوها">☰</button>
    <div class="brand"><span class="brand-ic">✨</span><span>چت هوشمند</span></div>
    <div id="model-picker" class="mp-wrap">
      <button id="model-btn" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="انتخاب مدل" title="انتخاب مدل">
        <img id="model-btn-logo" class="mp-btn-logo" src="/Claude-ai-logo.webp" alt="" width="20" height="20">
        <span id="model-btn-name" class="mp-btn-name">Claude Fable 5.1</span>
        <svg class="mp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
      </button>
      <div id="model-pop" role="listbox" aria-label="مدل‌ها" hidden></div>
    </div>
    <div class="opts" role="group" aria-label="گزینه‌های مدل">
      <label><input type="checkbox" id="ck-thinking"> تفکر</label>
      <label><input type="checkbox" id="ck-deep"> جستجوی عمیق</label>
      <label><input type="checkbox" id="ck-stream"> استریم</label>
    </div>
    <div class="spacer"></div>
    <button id="btn-ping" class="hbtn" type="button" title="تست اتصال به سرویس">⚡ اتصال؟</button>
    <button id="btn-raw" class="hbtn" type="button" title="پنل دیتای خام استریم">⌨️ Raw SSE</button>
    <button id="btn-settings" class="icon-btn" type="button" aria-label="تنظیمات" title="تنظیمات">⚙️</button>
    <div class="status" id="status-box" title="وضعیت اتصال">
      <span id="status-dot" class="dot dot-check"></span>
      <span id="status-text" class="status-t">در حال بررسی…</span>
    </div>
  </header>

  <!-- ═══ بدنه ═══ -->
  <div id="body-main">
    <div id="overlay" hidden></div>

    <!-- سایدبار راست -->
    <aside id="sidebar" aria-label="گفتگوها">
      <div class="sb-head">
        <span class="sb-title">✨ گفتگوها</span>
        <button id="btn-sb-close" class="icon-btn only-mobile" type="button" aria-label="بستن">✕</button>
      </div>
      <div class="sb-new">
        <button id="btn-new" class="btn-primary" type="button">＋ چت جدید</button>
      </div>
      <nav id="chat-list" aria-label="لیست گفتگوها"></nav>
      <div class="sb-foot">
        <div class="grid2">
          <button id="btn-exp-md" class="hbtn" type="button" title="خروجی Markdown از گفتگوی فعلی">⬇ Markdown</button>
          <button id="btn-exp-json" class="hbtn" type="button" title="خروجی JSON از همه گفتگوها">⬇ JSON</button>
        </div>
        <button id="btn-clear" class="btn-danger" type="button">🗑 پاک کردن همه</button>
      </div>
    </aside>

    <!-- ناحیهٔ اصلی چت -->
    <main id="main">
      <div id="chat-area" role="log" aria-live="polite" aria-label="گفتگو">
        <div id="chat-inner"></div>
      </div>

      <!-- کامپوزر پایین (چسبان) -->
      <div id="composer">
        <div class="comp-row">
          <textarea id="ta" rows="1" dir="auto" aria-label="متن پیام"
            placeholder="پیام خود را بنویسید… (Enter ارسال · Shift+Enter خط جدید)"></textarea>
          <button id="btn-send" type="button" aria-label="ارسال پیام" title="ارسال">➤</button>
          <button id="btn-stop" type="button" hidden title="توقف پاسخ (Esc)">⏹ توقف</button>
        </div>
        <p class="comp-note">پاسخ‌ها زنده استریم می‌شوند · Esc برای توقف — پاسخ‌های هوش مصنوعی ممکن است نادرست باشند.</p>
      </div>
    </main>
  </div>

  <!-- ═══ پنل Raw SSE (شناور پایین-چپ) ═══ -->
  <div id="raw-panel" hidden>
    <div class="raw-head">
      <span class="raw-title">📡 Raw SSE — دیتای خام استریم</span>
      <span id="raw-size" class="raw-size">0.0KB</span>
      <button id="raw-clear" class="raw-mini" type="button" aria-label="پاک کردن" title="پاک کردن">🗑</button>
      <button id="raw-close" class="raw-mini" type="button" aria-label="بستن" title="بستن">✕</button>
    </div>
    <pre id="raw-pre"></pre>
  </div>

  <!-- ═══ مودال تنظیمات ═══ -->
  <div id="modal" hidden>
    <div id="modal-ov"></div>
    <div id="modal-box" role="dialog" aria-modal="true" aria-label="تنظیمات">
      <div class="m-head">
        <h3>⚙️ تنظیمات</h3>
        <button id="modal-x" class="icon-btn" type="button" aria-label="بستن">✕</button>
      </div>
      <label for="sys-prompt" class="m-label">System Prompt (اختیاری)</label>
      <textarea id="sys-prompt" rows="5" dir="auto" placeholder="مثلاً: همیشه به فارسی و خلاصه پاسخ بده…"></textarea>
      <p class="m-hint">این متن در هر درخواست به‌صورت اولین پیام {role:"system"} به مدل ارسال می‌شود. گفتگوها و تنظیمات به‌صورت محلی در مرورگر شما ذخیره می‌شوند.</p>
      <div class="api-sec">
        <h4>🔑 اندپوینت‌های API و کلیدها</h4>
        <p class="api-hint">این سرور هم‌زمان API سازگار با OpenAI و Anthropic ارائه می‌دهد؛ کلیدها در اولین اجرای سرور ساخته و در فایل api-keys.json ذخیره شده‌اند.</p>
        <div class="key-row"><span class="key-tag">OpenAI</span><code id="key-openai" dir="ltr">—</code><button id="btn-key-openai" class="key-copy" type="button">کپی</button></div>
        <div class="key-row"><span class="key-tag">Anthropic</span><code id="key-anthropic" dir="ltr">—</code><button id="btn-key-anthropic" class="key-copy" type="button">کپی</button></div>
        <div id="api-eps" class="api-eps" dir="ltr"></div>
        <pre id="api-curl" class="api-curl" dir="ltr"></pre>
      </div>
      <div class="m-foot">
        <button id="modal-cancel" class="hbtn" type="button">انصراف</button>
        <button id="modal-save" class="btn-primary" type="button">ذخیره</button>
      </div>
    </div>
  </div>

  <!-- ═══ توست‌ها ═══ -->
  <div id="toasts" aria-live="polite"></div>

</div>
<script>
window.__FM__ = __SERVER_DATA_JSON__;
</script>
<script>
${PAGE_JS}
</script>
</body>
</html>`;

/* ═══════════════════════════════════════════════════════════════════════════
   سرور HTTP — روت‌ها و پروکسی آپستریم
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * باز کردن درخواست به آپستریمِ یک پروایدر با هدرهای جعلی؛
 * همان لحظهٔ رسیدن هدرهای پاسخ resolve می‌شود تا بدنه تکه‌تکه pipe شود (بدون بافر).
 * پروتکل از روی URL انتخاب می‌شود (https برای سایت‌های واقعی، http برای آپستریم محلی/mock).
 * @param {string} body       بدنهٔ JSON
 * @param {number} [timeoutMs] تایم‌اوت — پیش‌فرض از تنظیمات همان پروایدر
 * @param {object} [provider]  پروایدر — پیش‌فرض: پروایدر پیش‌فرض رجیستری
 */
function openUpstream(body, timeoutMs, provider) {
  const cfg = getProviders();
  const p = provider || defaultProvider(cfg);
  const up = upstreamOptions(p, cfg);
  const ms = timeoutMs || up.timeoutMs;
  const doRequest = /^https:/i.test(up.url) ? https.request : http.request;

  return new Promise((resolve, reject) => {
    if (!up.url) {
      reject(new Error('UPSTREAM_CONFIG — پروایدر «' + p.id + '» آدرس آپستریم ندارد (providers.json)'));
      return;
    }
    if (up.missingEnv.length) {
      logReq('yellow', '[upstream] ' + p.id + ': متغیر محیطی تعریف‌نشده ← ' + up.missingEnv.join(', '));
    }
    const req = doRequest(
      up.url,
      {
        method: up.method || 'POST',
        headers: Object.assign({}, up.headers, {
          'Content-Length': String(Buffer.byteLength(body, 'utf8')),
        }),
      },
      (res) => resolve({ status: res.statusCode || 502, headers: res.headers, res, req, providerId: p.id })
    );
    req.setTimeout(ms, () =>
      req.destroy(new Error('UPSTREAM_TIMEOUT — پاسخ آپستریم بیش از حد طول کشید (' + Math.round(ms / 1000) + ' ثانیه)'))
    );
    req.on('error', (err) => reject(err));
    req.write(body, 'utf8');
    req.end();
  });
}

/** خواندن کامل بدنهٔ درخواست با محدودیت حجم */
function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on('data', (c) => {
      if (tooLarge) return;
      size += c.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => done({ data: tooLarge ? '' : Buffer.concat(chunks).toString('utf8'), tooLarge }));
    req.on('error', () => done({ data: '', tooLarge: true }));
    req.on('close', () => done({ data: '', tooLarge: true }));
  });
}

/** پاسخ JSON با CORS باز */
function sendJson(res, status, obj) {
  if (res.headersSent) return;
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, OPEN_CORS));
  res.end(JSON.stringify(obj));
}

/** GET / — صفحهٔ چت */
function handleHome(res) {
  /* جای‌گذاری کاتالوگ زنده در هر درخواست (function-replacement تا الگوهای $ در JSON مشکل نسازند) */
  const html = PAGE_HTML.replace('__SERVER_DATA_JSON__', () => serverDataJson());
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
  logReq('green', 'GET / → 200 HTML (' + Buffer.byteLength(html, 'utf8') + ' bytes)');
}

/* ---------- POST /api/chat — پروکسی استریم ---------- */
async function handleChat(req, res) {
  const started = Date.now();
  const log = (color, msg) => logReq(color, 'POST /api/chat ' + msg);

  try {
    /* محدودیت حجم بدنهٔ اعلام‌شده */
    const declared = parseInt(req.headers['content-length'] || '0', 10);
    if (declared > MAX_BODY_BYTES) {
      log('yellow', '→ 413 (declared too large)');
      sendJson(res, 413, { error: { message: 'حجم درخواست بیش از حد مجاز (۵ مگابایت) است.' } });
      req.resume();
      return;
    }

    /* خواندن کامل بدنه با سقف ۵ مگابایت */
    const body = await readBody(req, MAX_BODY_BYTES);
    if (body.tooLarge) {
      log('yellow', '→ 413 (body too large)');
      sendJson(res, 413, { error: { message: 'حجم درخواست بیش از حد مجاز (۵ مگابایت) است.' } });
      return;
    }

    /* انتخاب پروایدر از روی مدل + بازسازی بدنه در شکلِ همان آپستریم
       (نام مدل نرمال می‌شود: «Claude Fable 5.1» و «claude_fable 5.1» هم قبول است) */
    let bodyOut = body.data;
    let resolved = resolveModel(null);
    try {
      const j = JSON.parse(body.data);
      if (j && typeof j === 'object') {
        resolved = resolveModel(typeof j.modelId === 'string' ? j.modelId : typeof j.model === 'string' ? j.model : null);
        const extra = Object.assign({}, j);
        delete extra.modelId;
        delete extra.model;
        bodyOut = JSON.stringify(
          buildUpstreamPayload(resolved.provider, {
            messages: Array.isArray(j.messages) ? j.messages : [],
            modelId: resolved.id,
            thinking: j.thinking === true,
            deepSearch: j.deepSearch === true || j.deep_search === true,
            stream: typeof j.stream === 'boolean' ? j.stream : undefined,
            maxTokens: typeof j.max_tokens === 'number' ? j.max_tokens : undefined,
            system: typeof j.system === 'string' ? j.system : undefined,
            extra: extra,
          })
        );
      }
    } catch (e) {
      /* بدنهٔ JSON معتبر نبود — همان خام به پروایدر پیش‌فرض می‌رود */
    }

    /* اتصال به آپستریم */
    let up;
    try {
      up = await openUpstream(bodyOut, UPSTREAM_TIMEOUT_MS, resolved.provider);
    } catch (err) {
      const msg = (err && err.message) || String(err);
      const isTimeout = /timeout/i.test(msg);
      log('red', '✖ ' + msg + ' (' + (Date.now() - started) + 'ms)');
      sendJson(
        res,
        isTimeout ? 504 : 502,
        {
          error: {
            message: isTimeout
              ? 'پاسخ آپستریم بیش از حد طول کشید (۱۸۰ ثانیه).'
              : 'اتصال به سرویس چت برقرار نشد: ' + msg,
          },
        }
      );
      return;
    }
    log('cyan', '← [' + resolved.provider.id + '/' + resolved.publicId + '] آپستریم پاسخ داد: ' + up.status);

    /* هدرهای پاسخ — حذف access-control-* ، transfer-encoding ، content-encoding ، content-length */
    const outHeaders = {};
    for (const [k, v] of Object.entries(up.headers)) {
      const lk = k.toLowerCase();
      if (lk.startsWith('access-control-')) continue;
      if (lk === 'transfer-encoding' || lk === 'content-encoding' || lk === 'content-length') continue;
      if (lk === 'connection' || lk === 'keep-alive') continue;
      if (v == null) continue;
      outHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    outHeaders['Cache-Control'] = 'no-cache, no-transform';
    outHeaders['X-Accel-Buffering'] = 'no';
    outHeaders['X-Provider'] = resolved.provider.id;
    res.writeHead(up.status, outHeaders);

    /* pipe مستقیم: هر تکه همان لحظه رد می‌شود تا SSE زنده بماند (بدون تجمیع بافر) */
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        res.end();
      } catch (e) {
        /* بسته شده */
      }
      log('green', '✓ تمام شد (' + (Date.now() - started) + 'ms)');
    };
    up.res.on('data', (chunk) => {
      if (done) return;
      try {
        if (!res.write(chunk)) up.res.pause(); // backpressure
      } catch (e) {
        done = true;
        safeDestroy(up.req);
      }
    });
    res.on('drain', () => {
      try {
        up.res.resume();
      } catch (e) {
        /* noop */
      }
    });
    up.res.on('end', finish);
    up.res.on('error', finish);

    /* اگر کلاینت وسط کار قطع شد، درخواست آپستریم destroy شود (دکمهٔ توقف واقعاً کار کند) */
    const killUpstream = () => {
      if (done) return;
      log('yellow', '⏹ کلاینت قطع شد — آپستریم destroy می‌شود');
      safeDestroy(up.req);
    };
    res.on('close', () => {
      if (!done) {
        killUpstream();
        done = true;
        try {
          res.end();
        } catch (e) {
          /* noop */
        }
      }
    });
    req.on('close', killUpstream);
  } catch (e) {
    /* هر خطای غیرمنتظره — کل سرور نباید بیفتد */
    logReq('red', 'POST /api/chat ✖ ' + ((e && e.message) || e));
    sendJson(res, 500, { error: { message: 'خطای داخلی سرور' } });
  }
}

/* ---------- GET /api/models — کاتالوگ زندهٔ مدل‌ها/گروه‌ها برای UI ----------
   فقط دادهٔ عمومی (بدون URL/هدر/احراز هویت آپستریم) برمی‌گردد.
   در نسخهٔ Next: src/app/api/models/route.ts                              */
function handleCatalog(req, res) {
  const cfg = getProviders();
  const cat = publicCatalog(cfg);
  sendJson(res, 200, cat);
  logReq('green', 'GET /api/models → 200 (' + cat.models.length + ' مدل / ' + cat.groups.length + ' گروه)');
}

/* ---------- GET /api/keys — کلیدهای API برای مودال ⚙️ تنظیمات ----------
   معادل در نسخهٔ Next: src/app/api/keys/route.ts
   در app.js همین داده داخل window.__FM__ هم تزریق می‌شود؛ این endpoint برای
   یکسان بودن سطح API هر دو نسخه اضافه شده است. (اپ محلی/شخصی است) */
function handleKeys(req, res) {
  sendJson(res, 200, { openai: API_KEYS.openai, anthropic: API_KEYS.anthropic });
  logReq('green', 'GET /api/keys → 200');
}

/* ---------- GET /api/ping — تست اتصال (با ?model= همان پروایدر تست می‌شود) ---------- */
function handlePing(req, res) {
  const started = Date.now();
  const url = new URL(String(req.url || '/'), 'http://localhost');
  const resolved = resolveModel(url.searchParams.get('model'));
  const provider = resolved.provider;
  const upOpts = upstreamOptions(provider, getProviders());
  const body = JSON.stringify(
    buildUpstreamPayload(provider, {
      messages: [{ role: 'user', content: 'ping' }],
      modelId: resolved.id,
      thinking: false,
      deepSearch: false,
      stream: false,
    })
  );

  const doRequest = /^https:/i.test(upOpts.url) ? https.request : http.request;
  const upReq = doRequest(
    upOpts.url,
    {
      method: upOpts.method || 'POST',
      headers: Object.assign({}, upOpts.headers, {
        'Content-Length': String(Buffer.byteLength(body, 'utf8')),
      }),
    },
    (up) => {
      let data = '';
      up.on('data', (c) => {
        if (data.length < 200000) data += c.toString('utf8');
      });
      up.on('end', () => {
        const ms = Date.now() - started;
        let sample = data.slice(0, 200);
        try {
          const j = JSON.parse(data);
          if (j && typeof j === 'object' && 'error' in j) {
            const er = j.error;
            sample = typeof er === 'string' ? er : String(er && er.message != null ? er.message : JSON.stringify(er));
          } else if (j && typeof j.content === 'string') sample = j.content;
          else if (j && typeof j.text === 'string') sample = j.text;
          else if (j && Array.isArray(j.choices)) {
            const c = j.choices[0];
            if (c && c.message && typeof c.message.content === 'string') sample = c.message.content;
          }
        } catch (e) {
          /* پاسخ JSON نبود — همان متن خام */
        }
        sample = String(sample).slice(0, 200);
        logReq('green', 'GET /api/ping → ok [' + provider.id + '] (' + ms + 'ms)');
        sendJson(res, 200, { status: 'ok', ms, sample, provider: provider.id, model: resolved.publicId });
      });
      up.on('error', (err) => {
        const ms = Date.now() - started;
        logReq('red', 'GET /api/ping → error [' + provider.id + ']: ' + err.message + ' (' + ms + 'ms)');
        sendJson(res, 200, {
          status: 'error',
          ms,
          sample: String(err.message || err).slice(0, 200),
          provider: provider.id,
          model: resolved.publicId,
        });
      });
    }
  );
  upReq.setTimeout(20000, () => upReq.destroy(new Error('timeout')));
  upReq.on('error', (err) => {
    const ms = Date.now() - started;
    const msg = (err && err.message) || String(err);
    logReq('red', 'GET /api/ping → error [' + provider.id + ']: ' + msg + ' (' + ms + 'ms)');
    sendJson(res, 200, { status: 'error', ms, sample: msg.slice(0, 200), provider: provider.id, model: resolved.publicId });
  });
  upReq.write(body, 'utf8');
  upReq.end();
}

/* ═══════════════════════════════════════════════════════════════════════════
   اندپوینت‌های سازگار OpenAI و Anthropic
   • GET  /v1/models            ← لیست مدل‌ها (فرمت OpenAI)
   • POST /v1/chat/completions  ← فرمت OpenAI (Authorization: Bearer)
   • POST /v1/messages          ← فرمت Anthropic (x-api-key + anthropic-version)
   هر دو حالت استریم (SSE) و غیراستریم پشتیبانی می‌شود؛ پاسخ آپستریم با
   پارسر جهانی به فرمت استاندارد هر API تبدیل می‌شود.
   ═══════════════════════════════════════════════════════════════════════════ */

/** گرفتن توکن از هدر Authorization: Bearer */
function getBearerToken(req) {
  const h = req.headers['authorization'];
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(String(h).trim());
  return m ? m[1].trim() : null;
}

/** خطا به فرمت OpenAI */
function openaiError(res, status, message, code) {
  sendJson(res, status, {
    error: {
      message: message,
      type: status === 401 ? 'invalid_request_error' : status >= 500 ? 'api_error' : 'invalid_request_error',
      param: null,
      code: code == null ? null : code,
    },
  });
}

/** خطا به فرمت Anthropic */
function anthropicError(res, status, type, message) {
  sendJson(res, status, { type: 'error', error: { type: type, message: message } });
}

/** تبدیل محتوای پیام (رشته یا آرایهٔ بلوک) به متن ساده برای آپستریم */
function flattenContent(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    let s = '';
    for (const b of c) {
      if (typeof b === 'string') s += b;
      else if (b && typeof b === 'object' && typeof b.text === 'string') s += b.text;
    }
    return s;
  }
  return '';
}

/** خواندن کامل یک استریم آپستریم به رشته (با سقف) */
function readStreamText(stream, cap) {
  return new Promise((resolve) => {
    let s = '';
    stream.on('data', (c) => {
      if (s.length < cap) s += c.toString('utf8');
      else safeDestroy(stream);
    });
    stream.on('end', () => resolve(s));
    stream.on('error', () => resolve(s));
  });
}

/** پارسر SSE سمت سرور (همان منطق پارسر کلاینت) → دلتای {text, reasoning, error} */
function makeUpstreamParser(onDelta, opts) {
  let buf = '';
  let pendingJson = '';
  /* فیلدهای سفارشیِ همان پروایدر (providers.json → response.textFields/reasoningFields/doneToken) */
  const extraText = (opts && opts.extraTextFields) || [];
  const extraReason = (opts && opts.extraReasoningFields) || [];
  const doneToken = (opts && opts.doneToken) || '[DONE]';

  function applyObject(obj) {
    const out = { text: '', reasoning: '', error: null };
    const addText = (v) => {
      if (typeof v === 'string') out.text += v;
      else if (Array.isArray(v)) {
        for (const b of v) {
          if (typeof b === 'string') out.text += b;
          else if (b && typeof b === 'object' && typeof b.text === 'string') out.text += b.text;
        }
      }
    };
    const addReason = (v) => {
      if (typeof v === 'string') out.reasoning += v;
    };
    if (!obj || typeof obj !== 'object') {
      if (typeof obj === 'string' && obj) out.text += obj;
    } else {
      /* سبک OpenAI: choices[0].delta / choices[0].message */
      const choice = Array.isArray(obj.choices) ? obj.choices[0] : undefined;
      if (choice && typeof choice === 'object') {
        const d = choice.delta;
        const m = choice.message;
        if (d && typeof d === 'object') {
          addText(d.content); addText(d.text);
          addReason(d.reasoning_content); addReason(d.reasoning); addReason(d.thinking);
        }
        if (m && typeof m === 'object') {
          addText(m.content); addText(m.text);
          addReason(m.reasoning_content); addReason(m.reasoning); addReason(m.thinking);
        }
        if (typeof choice.text === 'string') addText(choice.text);
      }
      /* سبک Claude: delta.thinking و امثال آن */
      const td = obj.delta;
      if (td && typeof td === 'object') {
        addText(td.text); addText(td.content);
        addReason(td.thinking); addReason(td.reasoning_content); addReason(td.reasoning);
      }
      const tm = obj.message;
      if (tm && typeof tm === 'object') {
        addText(tm.content); addText(tm.text);
        addReason(tm.reasoning_content); addReason(tm.thinking);
      }
      /* فیلدهای مستقیم ریشه */
      addText(obj.content); addText(obj.text);
      addReason(obj.reasoning_content); addReason(obj.reasoning); addReason(obj.thinking);
      /* فیلدهای سفارشی پروایدر — روی ریشه، delta، message و choices[0].delta/message */
      if (extraText.length || extraReason.length) {
        const scopes = [obj];
        if (obj.delta && typeof obj.delta === 'object') scopes.push(obj.delta);
        if (obj.message && typeof obj.message === 'object') scopes.push(obj.message);
        const ch = Array.isArray(obj.choices) ? obj.choices[0] : undefined;
        if (ch && typeof ch === 'object') {
          scopes.push(ch);
          if (ch.delta && typeof ch.delta === 'object') scopes.push(ch.delta);
          if (ch.message && typeof ch.message === 'object') scopes.push(ch.message);
        }
        for (const s of scopes) {
          for (const f of extraText) addText(s[f]);
          for (const f of extraReason) addReason(s[f]);
        }
      }
      /* خطای داخل استریم */
      if (obj.error) {
        out.error = typeof obj.error === 'string'
          ? obj.error
          : (obj.error && typeof obj.error.message === 'string')
            ? obj.error.message
            : JSON.stringify(obj.error);
      }
    }
    if (out.text || out.reasoning || out.error) onDelta(out);
  }

  function handlePayload(p) {
    const t = p.trim();
    if (!t || t === '[DONE]' || t === doneToken) return;
    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      pendingJson = pendingJson ? pendingJson + '\n' + p : p;
      try {
        applyObject(JSON.parse(pendingJson));
        pendingJson = '';
      } catch (e) {
        /* هنوز ناقص است — با خط بعدی کامل می‌شود */
      }
    } else {
      if (pendingJson) {
        const s = pendingJson;
        pendingJson = '';
        applyObject(s); // JSON ناتمام → خام
      }
      applyObject(p); // رشتهٔ خام غیر JSON → متن
    }
  }

  function processLine(line) {
    if (!line) return;
    if (line.charAt(0) === ':') return; // کامنت SSE
    if (line.indexOf('data:') === 0) {
      let p = line.slice(5);
      if (p.charAt(0) === ' ') p = p.slice(1);
      handlePayload(p);
      return;
    }
    if (/^(event|id|retry)\s*:/i.test(line)) return; // متادیتای SSE
    handlePayload(line); // خط خام بدون data:
  }

  return {
    push(chunk) {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        processLine(line);
      }
    },
    end() {
      if (buf.trim()) {
        processLine(buf.replace(/\r$/, ''));
        buf = '';
      }
      if (pendingJson) {
        const s = pendingJson;
        pendingJson = '';
        applyObject(s);
      }
    },
  };
}

/** تجمیع کامل بدنهٔ آپستریم (پاسخ غیراستریم) به متن/تفکر/خطا */
function collectUpstreamText(full, opts) {
  const acc = { text: '', reasoning: '', error: null };
  const p = makeUpstreamParser((d) => {
    acc.text += d.text;
    acc.reasoning += d.reasoning;
    if (d.error && !acc.error) acc.error = d.error;
  }, opts);
  p.push(String(full || ''));
  p.end();
  if (!acc.text && !acc.reasoning && !acc.error) {
    const s = String(full || '').trim();
    if (s) acc.text = s;
  }
  return acc;
}

/* ---------- GET /v1/models — لیست مدل‌ها (فرمت OpenAI) ---------- */
function handleModels(req, res) {
  const key = getBearerToken(req) || (req.headers['x-api-key'] || '').trim();
  if (!keyIsValid(key)) {
    logReq('yellow', 'GET /v1/models → 401 (کلید نامعتبر)');
    openaiError(res, 401, 'کلید API نامعتبر است. کلید را از بنر اجرا یا بخش ⚙️ تنظیمات بگیرید.', 'invalid_api_key');
    return;
  }
  const cfg = getProviders();
  const extra = new URL(String(req.url || '/'), 'http://localhost').searchParams.get('extra') === '1';
  const data = listModels(cfg).map((m) => {
    const base = { id: m.id, object: 'model', created: BOOT_AT, owned_by: ownedBy(m, cfg) };
    if (extra) {
      base.group = m.group;
      base.vendor = m.vendor;
      base.logo = m.logo;
      base.provider = m.providerId;
    }
    return base;
  });
  sendJson(res, 200, { object: 'list', data });
  logReq('green', 'GET /v1/models → 200 (' + data.length + ' مدل)');
}

/* ---------- POST /v1/chat/completions — سازگار OpenAI ---------- */
async function handleOpenAI(req, res) {
  const started = Date.now();
  const log = (color, msg) => logReq(color, 'POST /v1/chat/completions ' + msg);

  try {
    /* احراز هویت: Authorization: Bearer <key> */
    const key = getBearerToken(req);
    if (!keyIsValid(key)) {
      log('yellow', '→ 401');
      openaiError(res, 401, 'کلید API نامعتبر است (هدر Authorization: Bearer).', 'invalid_api_key');
      return;
    }

    const body = await readBody(req, MAX_BODY_BYTES);
    if (body.tooLarge) {
      openaiError(res, 413, 'حجم درخواست بیش از حد مجاز (۵ مگابایت) است.');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(body.data || '{}');
    } catch (e) {
      openaiError(res, 400, 'بدنهٔ JSON نامعتبر است.');
      return;
    }

    /* پیام‌ها → فرمت آپستریم (نقش‌های ناشناخته → user) */
    const upstreamMsgs = [];
    const msgsIn = Array.isArray(parsed.messages) ? parsed.messages : [];
    for (const m of msgsIn) {
      if (!m || typeof m !== 'object') continue;
      const role = m.role === 'assistant' || m.role === 'system' ? m.role : 'user';
      const content = flattenContent(m.content);
      if (content) upstreamMsgs.push({ role: role, content: content });
    }
    if (!upstreamMsgs.length) {
      openaiError(res, 400, 'messages باید آرایه‌ای غیرخالی از پیام‌ها باشد.');
      return;
    }

    /* پروایدر از روی مدل انتخاب می‌شود؛ بدنه در شکلِ همان آپستریم ساخته می‌شود */
    const resolved = resolveModel(parsed.model);
    const provider = resolved.provider;
    const model = resolved.publicId;
    const wantStream = !!parsed.stream;
    const payload = buildUpstreamPayload(provider, {
      messages: upstreamMsgs,
      modelId: resolved.id,
      thinking: parsed.thinking === true,      // اکستنشن غیراستاندارد (اختیاری)
      deepSearch: parsed.deep_search === true, // اکستنشن غیراستاندارد (اختیاری)
      stream: wantStream,
    });
    const parserOpts = {
      extraTextFields: (provider.response && provider.response.textFields) || [],
      extraReasoningFields: (provider.response && provider.response.reasoningFields) || [],
      doneToken: provider.response && provider.response.doneToken,
    };

    const promptChars = upstreamMsgs.reduce((n, m) => n + m.content.length, 0);
    const estIn = Math.max(1, Math.ceil(promptChars / 4));
    const id = 'chatcmpl-' + crypto.randomBytes(10).toString('hex');
    const created = Math.floor(Date.now() / 1000);

    /* ─────────── پاسخ کامل (غیراستریم) ─────────── */
    if (!wantStream) {
      let up;
      try {
        up = await openUpstream(JSON.stringify(payload), UPSTREAM_TIMEOUT_MS, provider);
      } catch (err) {
        const msg = (err && err.message) || String(err);
        log('red', '✖ ' + msg);
        openaiError(res, /timeout/i.test(msg) ? 504 : 502, 'اتصال به سرویس چت برقرار نشد: ' + msg);
        return;
      }
      if (up.status >= 400) {
        const txt = await readStreamText(up.res, 4000);
        safeDestroy(up.req);
        log('red', '← آپستریم ' + up.status);
        openaiError(res, up.status, 'خطای سرویس چت (HTTP ' + up.status + '): ' + txt.trim().slice(0, 300));
        return;
      }
      const full = await readStreamText(up.res, 8 * 1024 * 1024);
      const acc = collectUpstreamText(full, parserOpts);
      const content = acc.text || acc.reasoning || '⚠️ پاسخ خالی از سرور دریافت شد.';
      const estOut = Math.max(1, Math.ceil(content.length / 4));
      sendJson(res, 200, {
        id: id,
        object: 'chat.completion',
        created: created,
        model: model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: content },
            logprobs: null,
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: estIn, completion_tokens: estOut, total_tokens: estIn + estOut },
      });
      log('green', '→ 200 (' + (Date.now() - started) + 'ms · ' + content.length + ' کاراکتر)');
      return;
    }

    /* ─────────── استریم SSE به سبک OpenAI ─────────── */
    res.writeHead(200, Object.assign(
      {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
      OPEN_CORS
    ));
    res.write(': connected\n\n');

    const includeUsage = !!(parsed.stream_options && parsed.stream_options.include_usage);
    let outChars = 0;
    let gotText = false;
    let gotReasoning = false;
    let finished = false;

    const chunk = (delta, finish) => {
      if (finished) return;
      const obj = {
        id: id,
        object: 'chat.completion.chunk',
        created: created,
        model: model,
        choices: [{ index: 0, delta: delta, finish_reason: finish == null ? null : finish }],
      };
      try {
        res.write('data: ' + JSON.stringify(obj) + '\n\n');
      } catch (e) {
        /* کلاینت رفته */
      }
    };
    const endStream = () => {
      if (finished) return;
      /* نکته: `finished` باید «بعد» از چانک پایان ست شود، وگرنه chunk() آن را
         به‌خاطر گارد finished نمی‌فرستد و finish_reason:"stop" هرگز منتشر نمی‌شود
         (باگ واقعی بود — با npm run smoke گرفته شد؛ نسخهٔ Next همین ترتیب را دارد) */
      chunk({}, 'stop');
      finished = true;
      if (includeUsage) {
        const estOut = Math.max(1, Math.ceil(outChars / 4));
        try {
          res.write('data: ' + JSON.stringify({
            id: id, object: 'chat.completion.chunk', created: created, model: model,
            choices: [],
            usage: { prompt_tokens: estIn, completion_tokens: estOut, total_tokens: estIn + estOut },
          }) + '\n\n');
        } catch (e) { /* noop */ }
      }
      try {
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (e) { /* noop */ }
      log('green', '→ استریم تمام شد (' + (Date.now() - started) + 'ms · ' + outChars + ' کاراکتر)');
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
    }, parserOpts);

    let up;
    try {
      up = await openUpstream(JSON.stringify(payload), UPSTREAM_TIMEOUT_MS, provider);
    } catch (err) {
      chunk({ content: '⚠️ اتصال به سرویس چت برقرار نشد: ' + ((err && err.message) || err) });
      endStream();
      return;
    }
    if (up.status >= 400) {
      const txt = await readStreamText(up.res, 4000);
      chunk({ content: '⚠️ خطای سرویس چت (HTTP ' + up.status + '): ' + txt.trim().slice(0, 200) });
      endStream();
      return;
    }

    chunk({ role: 'assistant', content: '' }); // چانک اول: نقش
    up.res.on('data', (c) => parser.push(c.toString('utf8')));
    up.res.on('end', () => {
      parser.end();
      if (!gotText && !gotReasoning) chunk({ content: '⚠️ پاسخ خالی از سرور دریافت شد.' });
      endStream();
    });
    up.res.on('error', () => endStream());
    /* قطع کلاینت → قطع آپستریم */
    res.on('close', () => {
      finished = true;
      safeDestroy(up.req);
    });
  } catch (e) {
    logReq('red', 'POST /v1/chat/completions ✖ ' + ((e && e.message) || e));
    if (!res.headersSent) openaiError(res, 500, 'خطای داخلی سرور');
    else try { res.end(); } catch (e2) { /* noop */ }
  }
}

/* ---------- POST /v1/messages — سازگار Anthropic ---------- */
async function handleAnthropic(req, res) {
  const started = Date.now();
  const log = (color, msg) => logReq(color, 'POST /v1/messages ' + msg);

  try {
    /* احراز هویت: x-api-key (یا Bearer به‌عنوان جایگزین) */
    const key = (req.headers['x-api-key'] || '').trim() || getBearerToken(req);
    if (!keyIsValid(key)) {
      log('yellow', '→ 401');
      anthropicError(res, 401, 'authentication_error', 'کلید API نامعتبر است (هدر x-api-key).');
      return;
    }

    const body = await readBody(req, MAX_BODY_BYTES);
    if (body.tooLarge) {
      anthropicError(res, 413, 'invalid_request_error', 'حجم درخواست بیش از حد مجاز (۵ مگابایت) است.');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(body.data || '{}');
    } catch (e) {
      anthropicError(res, 400, 'invalid_request_error', 'بدنهٔ JSON نامعتبر است.');
      return;
    }

    /* طبق قوانین Anthropic: model و max_tokens اجباری‌اند */
    if (!parsed.model || typeof parsed.model !== 'string') {
      anthropicError(res, 400, 'invalid_request_error', 'model: Field required');
      return;
    }
    if (typeof parsed.max_tokens !== 'number') {
      anthropicError(res, 400, 'invalid_request_error', 'max_tokens: Field required');
      return;
    }

    /* system (رشته یا بلوک) — جدا نگه داشته می‌شود تا buildUpstreamPayload آن را
       در شکلِ درستِ همان آپستریم بگذارد (freemodels: پیام system · anthropic: فیلد system) */
    const upstreamMsgs = [];
    let sysText = '';
    if (typeof parsed.system === 'string') sysText = parsed.system;
    else if (Array.isArray(parsed.system)) sysText = parsed.system.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');

    const msgsIn = Array.isArray(parsed.messages) ? parsed.messages : [];
    for (const m of msgsIn) {
      if (!m || typeof m !== 'object') continue;
      const content = flattenContent(m.content);
      if (content) upstreamMsgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: content });
    }
    if (!upstreamMsgs.length) {
      anthropicError(res, 400, 'invalid_request_error', 'messages: at least one message is required');
      return;
    }

    /* پروایدر از روی مدل انتخاب می‌شود؛ بدنه در شکلِ همان آپستریم ساخته می‌شود */
    const resolved = resolveModel(parsed.model);
    const provider = resolved.provider;
    const model = resolved.publicId;
    const wantStream = !!parsed.stream;
    const payload = buildUpstreamPayload(provider, {
      messages: upstreamMsgs,
      modelId: resolved.id,
      thinking: parsed.thinking === true, // اکستنشن غیراستاندارد (اختیاری)
      deepSearch: false,
      stream: wantStream,
      maxTokens: typeof parsed.max_tokens === 'number' ? parsed.max_tokens : undefined,
      system: sysText,
    });
    const parserOpts = {
      extraTextFields: (provider.response && provider.response.textFields) || [],
      extraReasoningFields: (provider.response && provider.response.reasoningFields) || [],
      doneToken: provider.response && provider.response.doneToken,
    };

    const promptChars = upstreamMsgs.reduce((n, m) => n + m.content.length, 0) + sysText.trim().length;
    const estIn = Math.max(1, Math.ceil(promptChars / 4));
    const msgId = 'msg_' + crypto.randomBytes(10).toString('hex');
    const version = String(req.headers['anthropic-version'] || '2023-06-01');

    /* ─────────── پاسخ کامل ─────────── */
    if (!wantStream) {
      let up;
      try {
        up = await openUpstream(JSON.stringify(payload), UPSTREAM_TIMEOUT_MS, provider);
      } catch (err) {
        const msg = (err && err.message) || String(err);
        log('red', '✖ ' + msg);
        anthropicError(res, /timeout/i.test(msg) ? 504 : 502, 'api_error', 'اتصال به سرویس چت برقرار نشد: ' + msg);
        return;
      }
      if (up.status >= 400) {
        const txt = await readStreamText(up.res, 4000);
        safeDestroy(up.req);
        log('red', '← آپستریم ' + up.status);
        anthropicError(res, up.status, up.status === 429 ? 'rate_limit_error' : 'api_error', 'خطای سرویس چت (HTTP ' + up.status + '): ' + txt.trim().slice(0, 300));
        return;
      }
      const full = await readStreamText(up.res, 8 * 1024 * 1024);
      const acc = collectUpstreamText(full, parserOpts);
      const blocks = [];
      if (acc.reasoning) blocks.push({ type: 'thinking', thinking: acc.reasoning });
      blocks.push({ type: 'text', text: acc.text || (acc.error ? '⚠️ ' + acc.error : '') });
      if (!acc.text && !acc.reasoning && !acc.error) blocks.push({ type: 'text', text: '⚠️ پاسخ خالی از سرور دریافت شد.' });
      sendJson(res, 200, {
        id: msgId,
        type: 'message',
        role: 'assistant',
        model: model,
        content: blocks,
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: estIn, output_tokens: Math.max(1, Math.ceil((acc.text || '').length / 4)) },
      });
      log('green', '→ 200 (' + (Date.now() - started) + 'ms · anthropic-version ' + version + ')');
      return;
    }

    /* ─────────── استریم SSE به سبک Anthropic ─────────── */
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const ev = (name, obj) => {
      try {
        res.write('event: ' + name + '\ndata: ' + JSON.stringify(obj) + '\n\n');
      } catch (e) { /* noop */ }
    };

    ev('message_start', {
      type: 'message_start',
      message: {
        id: msgId,
        type: 'message',
        role: 'assistant',
        model: model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: estIn, output_tokens: 0 },
      },
    });
    ev('ping', { type: 'ping' });

    let blockIdx = -1;
    let blockType = null;
    let outChars = 0;
    let gotAny = false;
    let finished = false;

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
      try {
        res.end();
      } catch (e) { /* noop */ }
      log('green', '→ استریم تمام شد (' + (Date.now() - started) + 'ms · ' + outChars + ' کاراکتر)');
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
    }, parserOpts);

    let up;
    try {
      up = await openUpstream(JSON.stringify(payload), UPSTREAM_TIMEOUT_MS, provider);
    } catch (err) {
      openBlock('text');
      ev('content_block_delta', { type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: '⚠️ اتصال به سرویس چت برقرار نشد: ' + ((err && err.message) || err) } });
      endStream();
      return;
    }
    if (up.status >= 400) {
      const txt = await readStreamText(up.res, 4000);
      openBlock('text');
      ev('content_block_delta', { type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: '⚠️ خطای سرویس چت (HTTP ' + up.status + '): ' + txt.trim().slice(0, 200) } });
      endStream();
      return;
    }

    up.res.on('data', (c) => parser.push(c.toString('utf8')));
    up.res.on('end', () => {
      parser.end();
      if (!gotAny) {
        openBlock('text');
        ev('content_block_delta', { type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: '⚠️ پاسخ خالی از سرور دریافت شد.' } });
      }
      endStream();
    });
    up.res.on('error', () => endStream());
    /* قطع کلاینت → قطع آپستریم */
    res.on('close', () => {
      finished = true;
      safeDestroy(up.req);
    });
  } catch (e) {
    logReq('red', 'POST /v1/messages ✖ ' + ((e && e.message) || e));
    if (!res.headersSent) anthropicError(res, 500, 'api_error', 'خطای داخلی سرور');
    else try { res.end(); } catch (e2) { /* noop */ }
  }
}

/* ---------- سرور اصلی و مسیریابی ---------- */
const PORT = parseInt(process.env.PORT || '3000', 10) || 3000;
/* آدرس bind — پیش‌فرض فقط لوپ‌بک (امن برای اجرای روی ماشین شخصی).
   برای دسترسی از بیرون/کانتینر/پیش‌نمایش:  HOST=0.0.0.0 node app.js  */
const HOST = (process.env.HOST || '').trim() || '127.0.0.1';

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];

  /* هر OPTIONS → 204 با CORS باز */
  if (req.method === 'OPTIONS') {
    res.writeHead(204, OPEN_CORS);
    res.end();
    logReq('cyan', 'OPTIONS ' + path + ' → 204');
    return;
  }

  /* صفحهٔ چت */
  if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
    handleHome(res);
    return;
  }

  /* لوگوهای embed شده برای پیکر مدل */
  if (req.method === 'GET' && EMBEDDED_LOGOS[path]) {
    const L = EMBEDDED_LOGOS[path];
    res.writeHead(200, {
      'Content-Type': L.mime,
      'Content-Length': String(Buffer.byteLength(L.b64, 'base64')),
      'Cache-Control': 'public, max-age=604800',
    });
    res.end(Buffer.from(L.b64, 'base64'));
    return;
  }

  /* پروکسی چت */
  if (req.method === 'POST' && path === '/api/chat') {
    handleChat(req, res);
    return;
  }

  /* کاتالوگ زندهٔ مدل‌ها (برای پیکر مدل) */
  if (req.method === 'GET' && path === '/api/models') {
    handleCatalog(req, res);
    return;
  }

  /* کلیدهای API (برای نمایش در تنظیمات) */
  if (req.method === 'GET' && path === '/api/keys') {
    handleKeys(req, res);
    return;
  }

  /* تست اتصال */
  if (req.method === 'GET' && path === '/api/ping') {
    handlePing(req, res);
    return;
  }

  /* ─── اندپوینت‌های سازگار OpenAI و Anthropic ─── */
  if (req.method === 'GET' && path === '/v1/models') {
    handleModels(req, res);
    return;
  }
  if (req.method === 'POST' && path === '/v1/chat/completions') {
    handleOpenAI(req, res);
    return;
  }
  if (req.method === 'POST' && path === '/v1/messages') {
    handleAnthropic(req, res);
    return;
  }

  /* بقیه → 404 */
  res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, OPEN_CORS));
  res.end('404 — مسیر یافت نشد');
  logReq('yellow', req.method + ' ' + path + ' → 404');
});

/* مقاوم‌سازی: هیچ خطایی نباید پروسه را بیندازد */
process.on('uncaughtException', (err) => logReq('red', 'uncaughtException: ' + ((err && err.message) || err)));
process.on('unhandledRejection', (err) => logReq('red', 'unhandledRejection: ' + ((err && err.message) || err)));

/* ---------- بنر خوش‌آمد رنگی ---------- */
server.listen(PORT, HOST, () => {
  const line = '─'.repeat(52);
  console.log('');
  console.log(C.dim + '┌' + line + '┐' + C.reset);
  console.log('  \x1b[1;36m⚡ چت هوشمند\x1b[0m — \x1b[1;37mنسخهٔ تک‌فایل Node.js\x1b[0m');
  console.log(C.dim + '└' + line + '┘' + C.reset);
  console.log('   \x1b[32m●\x1b[0m آدرس محلی : \x1b[1;34mhttp://127.0.0.1:' + PORT + '/\x1b[0m');
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    const nets = require('node:os').networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
      for (const ni of nets[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
      }
    }
    console.log('   \x1b[32m●\x1b[0m آدرس شبکه : \x1b[1;34mhttp://' + (HOST === '0.0.0.0' ? (ips[0] || '<ip>') : HOST) + ':' + PORT + '/\x1b[0m' + C.dim + '  (bind: ' + HOST + ')' + C.reset);
  }
  console.log('   \x1b[32m●\x1b[0m پورت      : \x1b[33m' + PORT + '\x1b[0m \x1b[2m(متغیر محیطی PORT)\x1b[0m');
  console.log('   \x1b[32m●\x1b[0m آپستریم   : \x1b[2m' + UPSTREAM_URL + '\x1b[0m');
  console.log('   \x1b[32m●\x1b[0m پروایدرها : \x1b[2m' + providersSummary() + '\x1b[0m');
  console.log('   \x1b[32m●\x1b[0m رجیستری   : \x1b[2m' + PROVIDERS_FILE + '\x1b[0m \x1b[2m(hot reload)\x1b[0m');
  console.log('   \x1b[32m●\x1b[0m مدل‌ها     : \x1b[2m' + FM_MODELS.map((m) => m.id).join(' · ') + '\x1b[0m');
  console.log('   \x1b[32m●\x1b[0m OpenAI API: \x1b[1;34mPOST /v1/chat/completions\x1b[0m \x1b[2m| GET /v1/models\x1b[0m');
  console.log('   \x1b[32m●\x1b[0m Anthropic : \x1b[1;34mPOST /v1/messages\x1b[0m \x1b[2m(سازگار SDK آنتروپیک)\x1b[0m');
  console.log('   \x1b[32m●\x1b[0m زمان شروع : \x1b[2m' + new Date().toLocaleString('en-GB') + '\x1b[0m');
  console.log('');
  console.log('   \x1b[1;33m🔑 کلید OpenAI   (Authorization: Bearer):\x1b[0m ' + API_KEYS.openai);
  console.log('   \x1b[1;33m🔑 کلید Anthropic (x-api-key):\x1b[0m           ' + API_KEYS.anthropic);
  console.log('   \x1b[2mفایل کلیدها: ' + KEY_FILE + '\x1b[0m');
  console.log('');
  logReq('green', 'سرور روی ' + HOST + ':' + PORT + ' آماده است ✓');
});
