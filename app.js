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

/* ---------- ثابت‌های آپستریم (پورت از src/lib/upstream.ts) ---------- */
const UPSTREAM_URL = 'https://freemodels-chat.freemodels.workers.dev/';
const MAX_BODY_BYTES = 5 * 1024 * 1024; // حداکثر حجم بدنهٔ درخواست: ۵ مگابایت
const UPSTREAM_TIMEOUT_MS = 180 * 1000; // تایم‌اوت آپستریم: ۱۸۰ ثانیه

/** هدرهایی که به‌جای مرورگر به آپستریم فرستاده می‌شود (دور زدن CORS آپستریم) */
const SPOOFED_HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://freemodels.pro',
  'Referer': 'https://freemodels.pro/',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
  'Accept-Encoding': 'identity', // پاسخ فشرده نباشد تا pipe مستقیم ممکن باشد
};

/** هدرهای CORS باز برای پاسخ‌های خود سرور */
const OPEN_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
  'Access-Control-Max-Age': '86400',
};

/* ---------- مدل‌های سرویس freemodels (طبق سایت) ---------- */
const FM_MODELS = [
  { id: 'claude-sonnet-5',  name: 'Claude Sonnet 5',  vendor: 'Anthropic',   group: 'Claude Pro' },
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   vendor: 'Anthropic',   group: 'Claude Pro' },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', vendor: 'Anthropic',   group: 'Claude Pro' },
  { id: 'gpt-5.6-sol',      name: 'GPT 5.6 Sol',      vendor: 'OpenAI',      group: 'ChatGPT Pro' },
  { id: 'gpt-5.6-terra',    name: 'GPT 5.6 Terra',    vendor: 'OpenAI',      group: 'ChatGPT Pro' },
  { id: 'glm-5.2',          name: 'GLM 5.2',          vendor: 'Z.AI',        group: 'Other Pro Models' },
  { id: 'kimi-k3',          name: 'Kimi K3',          vendor: 'Moonshot AI', group: 'Other Pro Models' },
];
const DEFAULT_MODEL_ID = 'claude-fable-5.1'; // مدل پیش‌فرض (انتخاب‌شده در سایت)
const BOOT_AT = Math.floor(Date.now() / 1000); // برای فیلد created در /v1/models

/** تطبیق نرم نام مدل: «Claude Fable 5.1» یا «claude_fable 5.1» هم پذیرفته می‌شود */
function resolveModelId(input) {
  if (!input || typeof input !== 'string') return DEFAULT_MODEL_ID;
  const t = input.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const hit = FM_MODELS.find((m) => m.id === t || m.name.toLowerCase() === input.trim().toLowerCase());
  return hit ? hit.id : t || DEFAULT_MODEL_ID;
}

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

/* ---------- لاگ رنگی ANSI کنسول ---------- */
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
#topbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 14px;background:rgba(13,21,38,.95);border-bottom:1px solid var(--line);z-index:30}
.brand{display:none;align-items:center;gap:8px;font-weight:800;font-size:14px;color:#f1f5f9}
.brand-ic{display:flex;width:32px;height:32px;align-items:center;justify-content:center;border-radius:9px;background:linear-gradient(135deg,var(--accent),var(--accent2));font-size:15px}
#model-inp{height:36px;width:180px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--txt);padding:0 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;text-align:left;direction:ltr}
#model-inp:focus{outline:none;border-color:var(--accent)}
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
  #model-inp{width:130px}
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
var MODELS = [
  { id: 'claude-sonnet-5',  name: 'Claude Sonnet 5',  vendor: 'Anthropic' },
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   vendor: 'Anthropic' },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', vendor: 'Anthropic' },
  { id: 'gpt-5.6-sol',      name: 'GPT 5.6 Sol',      vendor: 'OpenAI' },
  { id: 'gpt-5.6-terra',    name: 'GPT 5.6 Terra',    vendor: 'OpenAI' },
  { id: 'glm-5.2',          name: 'GLM 5.2',          vendor: 'Z.AI' },
  { id: 'kimi-k3',          name: 'Kimi K3',          vendor: 'Moonshot AI' }
];
var DEFAULT_SETTINGS = { modelId: 'claude-fable-5.1', thinking: false, deepSearch: false, stream: true, systemPrompt: '' };
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
  $('model-inp').value = settings.modelId || '';
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
  $('model-inp').addEventListener('input', function () {
    settings.modelId = this.value;
    saveSettingsNow();
  });
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
/* دیتای تزریق‌شده به کلاینت (مدل‌ها + کلیدهای API برای بخش ⚙️ تنظیمات) */
const SERVER_DATA_JSON = JSON.stringify({
  models: FM_MODELS,
  defaultModel: DEFAULT_MODEL_ID,
  openaiKey: API_KEYS.openai,
  anthropicKey: API_KEYS.anthropic,
});

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
    <input id="model-inp" list="fm-models" aria-label="شناسه مدل" placeholder="modelId" spellcheck="false" autocomplete="off">
    <datalist id="fm-models">
      <option value="claude-sonnet-5">Claude Sonnet 5 — Anthropic</option>
      <option value="claude-fable-5">Claude Fable 5 — Anthropic</option>
      <option value="claude-fable-5.1">Claude Fable 5.1 — Anthropic</option>
      <option value="gpt-5.6-sol">GPT 5.6 Sol — OpenAI</option>
      <option value="gpt-5.6-terra">GPT 5.6 Terra — OpenAI</option>
      <option value="glm-5.2">GLM 5.2 — Z.AI</option>
      <option value="kimi-k3">Kimi K3 — Moonshot AI</option>
    </datalist>
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
window.__FM__ = ${SERVER_DATA_JSON};
</script>
<script>
${PAGE_JS}
</script>
</body>
</html>`;

/* ═══════════════════════════════════════════════════════════════════════════
   سرور HTTP — روت‌ها و پروکسی آپستریم
   ═══════════════════════════════════════════════════════════════════════════ */

/** باز کردن درخواست POST به آپستریم با هدرهای جعلی؛ همان لحظهٔ رسیدن هدرها resolve می‌شود */
function openUpstream(body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      UPSTREAM_URL,
      {
        method: 'POST',
        headers: Object.assign({}, SPOOFED_HEADERS, {
          'Content-Length': String(Buffer.byteLength(body, 'utf8')),
        }),
      },
      (res) => resolve({ status: res.statusCode || 502, headers: res.headers, res, req })
    );
    req.setTimeout(timeoutMs, () =>
      req.destroy(new Error('UPSTREAM_TIMEOUT — پاسخ آپستریم بیش از حد طول کشید (۱۸۰ ثانیه)'))
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
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(PAGE_HTML);
  logReq('green', 'GET / → 200 HTML (' + Buffer.byteLength(PAGE_HTML, 'utf8') + ' bytes)');
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

    /* نرمال‌سازی نام مدل (مقاوم): «Claude Fable 5.1» و «claude_fable 5.1» هم قبول می‌شود */
    let bodyOut = body.data;
    try {
      const j = JSON.parse(body.data);
      if (j && typeof j === 'object' && 'modelId' in j) {
        j.modelId = resolveModelId(j.modelId);
        bodyOut = JSON.stringify(j);
      }
    } catch (e) {
      /* بدنهٔ JSON معتبر نبود — همان خام به آپستریم می‌رود */
    }

    /* اتصال به آپستریم */
    let up;
    try {
      up = await openUpstream(bodyOut, UPSTREAM_TIMEOUT_MS);
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
    log('cyan', '← آپستریم پاسخ داد: ' + up.status);

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

/* ---------- GET /api/ping — تست اتصال ---------- */
function handlePing(res) {
  const started = Date.now();
  const body = JSON.stringify({
    messages: [{ role: 'user', content: 'ping' }],
    modelId: DEFAULT_MODEL_ID,
    thinking: false,
    deepSearch: false,
    stream: false,
  });

  const upReq = https.request(
    UPSTREAM_URL,
    {
      method: 'POST',
      headers: Object.assign({}, SPOOFED_HEADERS, {
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
        logReq('green', 'GET /api/ping → ok (' + ms + 'ms)');
        sendJson(res, 200, { status: 'ok', ms, sample });
      });
      up.on('error', (err) => {
        const ms = Date.now() - started;
        logReq('red', 'GET /api/ping → error: ' + err.message + ' (' + ms + 'ms)');
        sendJson(res, 200, { status: 'error', ms, sample: String(err.message || err).slice(0, 200) });
      });
    }
  );
  upReq.setTimeout(20000, () => upReq.destroy(new Error('timeout')));
  upReq.on('error', (err) => {
    const ms = Date.now() - started;
    const msg = (err && err.message) || String(err);
    logReq('red', 'GET /api/ping → error: ' + msg + ' (' + ms + 'ms)');
    sendJson(res, 200, { status: 'error', ms, sample: msg.slice(0, 200) });
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
function makeUpstreamParser(onDelta) {
  let buf = '';
  let pendingJson = '';

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
    if (!t || t === '[DONE]') return;
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
function collectUpstreamText(full) {
  const acc = { text: '', reasoning: '', error: null };
  const p = makeUpstreamParser((d) => {
    acc.text += d.text;
    acc.reasoning += d.reasoning;
    if (d.error && !acc.error) acc.error = d.error;
  });
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
  sendJson(res, 200, {
    object: 'list',
    data: FM_MODELS.map((m) => ({
      id: m.id,
      object: 'model',
      created: BOOT_AT,
      owned_by: 'freemodels-' + m.vendor.toLowerCase().replace(/\s+/g, '-'),
    })),
  });
  logReq('green', 'GET /v1/models → 200');
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

    const model = resolveModelId(parsed.model);
    const wantStream = !!parsed.stream;
    const payload = {
      messages: upstreamMsgs,
      modelId: model,
      thinking: parsed.thinking === true,      // اکستنشن غیراستاندارد (اختیاری)
      deepSearch: parsed.deep_search === true, // اکستنشن غیراستاندارد (اختیاری)
      stream: wantStream,
    };

    const promptChars = upstreamMsgs.reduce((n, m) => n + m.content.length, 0);
    const estIn = Math.max(1, Math.ceil(promptChars / 4));
    const id = 'chatcmpl-' + crypto.randomBytes(10).toString('hex');
    const created = Math.floor(Date.now() / 1000);

    /* ─────────── پاسخ کامل (غیراستریم) ─────────── */
    if (!wantStream) {
      let up;
      try {
        up = await openUpstream(JSON.stringify(payload), UPSTREAM_TIMEOUT_MS);
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
      const acc = collectUpstreamText(full);
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
      finished = true;
      chunk({}, 'stop');
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
    });

    let up;
    try {
      up = await openUpstream(JSON.stringify(payload), UPSTREAM_TIMEOUT_MS);
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

    /* system (رشته یا بلوک) + messages → فرمت آپستریم */
    const upstreamMsgs = [];
    let sysText = '';
    if (typeof parsed.system === 'string') sysText = parsed.system;
    else if (Array.isArray(parsed.system)) sysText = parsed.system.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
    if (sysText.trim()) upstreamMsgs.push({ role: 'system', content: sysText.trim() });

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

    const model = resolveModelId(parsed.model);
    const wantStream = !!parsed.stream;
    const payload = {
      messages: upstreamMsgs,
      modelId: model,
      thinking: parsed.thinking === true, // اکستنشن غیراستاندارد (اختیاری)
      deepSearch: false,
      stream: wantStream,
    };

    const promptChars = upstreamMsgs.reduce((n, m) => n + m.content.length, 0);
    const estIn = Math.max(1, Math.ceil(promptChars / 4));
    const msgId = 'msg_' + crypto.randomBytes(10).toString('hex');
    const version = String(req.headers['anthropic-version'] || '2023-06-01');

    /* ─────────── پاسخ کامل ─────────── */
    if (!wantStream) {
      let up;
      try {
        up = await openUpstream(JSON.stringify(payload), UPSTREAM_TIMEOUT_MS);
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
      const acc = collectUpstreamText(full);
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
    });

    let up;
    try {
      up = await openUpstream(JSON.stringify(payload), UPSTREAM_TIMEOUT_MS);
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
const HOST = '127.0.0.1';

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

  /* پروکسی چت */
  if (req.method === 'POST' && path === '/api/chat') {
    handleChat(req, res);
    return;
  }

  /* تست اتصال */
  if (req.method === 'GET' && path === '/api/ping') {
    handlePing(res);
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
  console.log('   \x1b[32m●\x1b[0m پورت      : \x1b[33m' + PORT + '\x1b[0m \x1b[2m(متغیر محیطی PORT)\x1b[0m');
  console.log('   \x1b[32m●\x1b[0m آپستریم   : \x1b[2m' + UPSTREAM_URL + '\x1b[0m');
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
