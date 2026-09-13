# چت هوشمند — Smart Chat · Project Documentation

> **مستندات کامل پروژه | Full Project Documentation** — نسخه ۲.۰ · ۱۳ سپتامبر ۲۰۲۶ (۲۲ شهریور ۱۴۰۵)
> ساختار انگلیسی + توضیحات فارسی · English structure + Persian body
> **جدید در این نسخه:** استقرار آمادهٔ Docker + Railway، اندپوینت `/healthz`، smoke test خودکار، و سخت‌سازی کلیدهای API

| Item | Value |
|---|---|
| **Project Name** | چت هوشمند (Smart Chat) |
| **Stack** | Next.js 16 · React 19 · Tailwind CSS 4 · TypeScript + نسخهٔ تک‌فایل Node خالص (`app.js`) |
| **Purpose** | Chat UI فارسی RTL متصل به سرویس رایگان freemodels + سرور API سازگار با OpenAI و Anthropic |
| **Entry Points** | `src/app/page.tsx` (Next.js) · `app.js` (standalone) |
| **Deployment** | `Dockerfile` (Next.js — پیش‌فرض Railway) · `Dockerfile.single` (app.js) · `docker-compose.yml` · `railway.json` |
| **Config Files** | `next.config.ts` · `package.json` · `package-lock.json` · `.env.example` · `api-keys.example.json` |
| **Docs** | `README.md` (همین فایل) · `HANDOFF.md` (سند تحویل) · `AI-GUIDE.md` · `worklog.md` (گزارش تسک‌ها) |
| **Verified** | `npm run build` ✓ · `npm run lint` (۰ خطا) ✓ · `npm run typecheck` (۰ خطا) ✓ · `npm run smoke` (۷/۷) ✓ |

---

## فهرست | Table of Contents

1. [Overview | معرفی پروژه](#1-overview--معرفی-پروژه)
2. [Quick Start | شروع سریع](#2-quick-start--شروع-سریع)
3. [System Requirements | پیش‌نیازها](#3-system-requirements--پیشنیازهای-سیستم)
4. [Installation & Run (Local) | نصب و اجرای محلی](#4-installation--run-local--نصب-و-اجرای-محلی)
5. [Docker | اجرای داکر](#5-docker--اجرای-داکر)
6. [Railway | استقرار روی Railway](#6-railway--استقرار-روی-railway)
7. [Environment Variables | متغیرهای محیطی](#7-environment-variables--متغیرهای-محیطی)
8. [Architecture | معماری](#8-architecture--معماری)
9. [Features | قابلیت‌ها](#9-features--قابلیتها)
10. [Models | مدل‌ها](#10-models--مدلها)
11. [API Reference | مرجع API](#11-api-reference--مرجع-api)
12. [Security & Production Checklist | امنیت و چک‌لیست پروداکشن](#12-security--production-checklist--امنیت-و-چکلیست-پروداکشن)
13. [Verification | راستی‌آزمایی](#13-verification--راستیآزمایی)
14. [Troubleshooting | رفع اشکال](#14-troubleshooting--رفع-اشکال)
15. [Development History | تاریخچهٔ توسعه](#15-development-history--تاریخچهٔ-توسعه)
16. [Known Issues & Roadmap | مشکلات و نقشهٔ راه](#16-known-issues--roadmap--مشکلات-شناختهشده-و-نقشهٔ-راه)

---

## 1. Overview | معرفی پروژه

این پروژه یک اپلیکیشن چت هوشمند کامل است که با هدف کار با سرویس رایگان **freemodels** ساخته شده است. رابط کاربری دقیقاً به سبک ابزارهای مدرن چت AI طراحی شده — تم تاریک، چیدمان راست‌به‌چپ فارسی، فونت Vazirmatn، پیکر مدل گروهی با لوگوی واقعی ارائه‌دهنده‌ها — و پاسخ‌ها به‌صورت زنده (streaming) با نمایش فرایند تفکر مدل (reasoning) رندر می‌شوند. پروژه در قالب **دو نسخهٔ موازی** تحویل داده شده است که هر دو از یک آپستریم مشترک استفاده می‌کنند و رفتار یکسانی دارند:

1. **نسخهٔ Next.js** — اپ کامل React با Tailwind 4 و کامپوننت‌های client-side؛ خروجی `standalone` می‌سازد و **گزینهٔ پیش‌فرض برای Docker و Railway** است.
2. **نسخهٔ تک‌فایل `app.js`** — یک فایل CommonJS خالص Node (بدون هیچ وابستگی خارجی) که سرور HTTP، پروکسی، API سازگار OpenAI/Anthropic و کل UI را در قالب HTML رشته‌ای داخل همان فایل سرو می‌کند؛ مناسب اجرای سریع با `node app.js` بدون `npm install`، و نیز یک تصویر Docker سبک (~۵۰MB) با `Dockerfile.single`.

هر دو نسخه علاوه بر رابط چت، یک **API کامل سازگار با OpenAI و Anthropic** نیز ارائه می‌دهند (`/v1/models`، `/v1/chat/completions`، `/v1/messages`) تا بتوان از هر کلاینت استانداردی (SDK رسمی، curl، ابزارهای شخص ثالث) به مدل‌های سرویس دسترسی داشت. احراز هویت با کلیدهای سبک OpenAI و Anthropic انجام می‌شود که یا از متغیرهای محیطی خوانده می‌شوند یا به‌صورت خودکار ساخته و در `api-keys.json` ذخیره می‌گردند.

> **کدام نسخه را روی Railway ببرم؟** نسخهٔ Next.js (`Dockerfile`) — همان چیزی است که `railway.json` به‌طور پیش‌فرض انتخاب می‌کند. اگر سرویس خیلی سبک و سریع بالا بیاد می‌خواهید، `Dockerfile.single` (نسخهٔ `app.js`) هم کاملاً آماده است و هر دو رفتار یکسانی دارند.

---

## 2. Quick Start | شروع سریع

### محلی (بدون Docker)

```bash
npm install          # نصب وابستگی‌ها (~۳۰ ثانیه؛ bun install هم کار می‌کند)
npm run dev          # → http://localhost:3000
```

### محلی (با Docker)

```bash
docker build -t smart-chat .                 # بیلد تصویر Next.js
docker run --rm -p 3000:3000 smart-chat      # → http://localhost:3000
```

### روی Railway (خلاصهٔ ۴ قدمی)

```bash
npm run keys:generate        # ۱) ساخت کلیدهای پایدار → خروجی را کپی کنید
railway login && railway init  # ۲) ورود و ساخت پروژه (یا از داشبورد ریپو را وصل کنید)
railway variables --set "OPENAI_API_KEY=sk-..." --set "ANTHROPIC_API_KEY=sk-ant-api03-..."
railway up                   # ۳) بیلد Docker و دیپلوی
railway domain               # ۴) ساخت/دریافت دامنهٔ عمومی → https://<app>.up.railway.app
```

جزئیات کامل (مسیر داشبورد، health check، لاگ‌ها، دیپلوی مجدد) در [بخش ۶](#6-railway--استقرار-روی-railway).

---

## 3. System Requirements | پیش‌نیازهای سیستم

| Requirement | Next.js Version | Single-File (`app.js`) | Docker / Railway |
|---|---|---|---|
| **Runtime** | Node.js ≥ **20.9** (تست‌شده با v22.22.3) | Node.js ≥ 18 (فقط ماژول‌های داخلی) | تصویر پایهٔ `node:22-slim` / `node:22-alpine` |
| **Package Manager** | npm (با `package-lock.json` قفل‌شده) یا bun ≥ 1.3 | **هیچ** — بدون نصب پکیج اجرا می‌شود | npm داخل بیلد (نیازی به نصب محلی نیست) |
| **Disk** | ~۹۵۰MB برای `node_modules` در توسعه (خروجی standalone فقط ~۳۶MB) | ~۱۵۰KB (فقط app.js + api-keys.json) | تصویر نهایی تقریباً ۱۵۰–۲۰۰MB (Next) / ۵۰–۶۰MB (single) |
| **Memory** | ~۵۱۲MB برای بیلد، ~۱۵۰–۲۵۰MB در اجرا | ~۶۰MB | Railway: پیش‌فرض کافی است (۱ vCPU / ۱GB توصیه) |
| **Network (خروجی)** | دسترسی به `freemodels-chat.freemodels.workers.dev` و `fonts.googleapis.com` | فقط آپستریم (لوگوها embed هستند) | همان — Railway دسترسی خروجی دارد |
| **OS** | Linux / macOS / Windows (WSL توصیه) | همان | Linux container |
| **Port** | 3000 پیش‌فرض · `PORT` env | 3000 پیش‌فرض · `PORT` env | Railway خودش `PORT` را تزریق می‌کند |
| **Bind address** | `HOSTNAME=0.0.0.0` (پیش‌فرض) | `HOST=0.0.0.0` (پیش‌فرض) | **باید** `0.0.0.0` باشد، نه `127.0.0.1` |

نکته‌های فنی:

- نسخهٔ تک‌فایل عمداً به‌جای `fetch` از `node:https` استفاده می‌کند تا بتواند هدرهای `Origin` و `Referer` (که در fetch استاندارد ممنوع‌اند) را واقعاً ارسال کند؛ بنابراین روی هر Node ≥ 18 بدون هیچ پیش‌نیاز دیگری کار می‌کند.
- هر دو نسخه به‌طور پیش‌فرض روی `0.0.0.0` گوش می‌دهند (الزام Docker/Railway). برای اجرای فقط-محلی: `HOST=127.0.0.1 node app.js`.
- Prisma + SQLite (`prisma/schema.prisma`، `src/lib/db.ts`) **اسکافلد اختیاری** است و اپ چت از آن استفاده نمی‌کند؛ برای استقرار به هیچ دیتابیسی نیاز ندارید.

---

## 4. Installation & Run (Local) | نصب و اجرای محلی

### 4.1 نسخهٔ Next.js

```bash
# ۱) نصب وابستگی‌ها — هر دو مدیر بسته کار می‌کنند
npm install          # از package-lock.json (قفل‌شده و تست‌شده برای Docker)
bun install          # از bun.lock (محیط توسعهٔ اصلی پروژه)

# ۲) محیط توسعه
npm run dev          # → http://localhost:3000   (Next 16 با Turbopack)

# ۳) بیلد پروداکشن + اجرای خروجی standalone
npm run build        # next build + کپی public و .next/static داخل .next/standalone
npm run start        # node .next/standalone/server.js
PORT=8080 npm run start   # پورت دلخواه
```

`npm run build` خروجی را در `.next/standalone` آماده می‌کند (حدود **۳۶MB**) — همان چیزی که داخل تصویر Docker کپی می‌شود. اسکریپت `scripts/finalize-standalone.mjs` کپی `public/` و `.next/static/` را انجام می‌دهد (بدون آن، CSS/JS/لوگوها در پروداکشن 404 می‌شوند) و در پایان حجم خروجی را گزارش می‌دهد.

### 4.2 نسخهٔ تک‌فایل (`app.js`)

```bash
node app.js                  # پورت 3000 روی 0.0.0.0
PORT=8080 node app.js        # پورت دلخواه
HOST=127.0.0.1 node app.js   # فقط از همین ماشین قابل دسترس باشد
node --check app.js          # بررسی صحت سینتکس (قبل از هر استقرار اجرا شود)
npm run smoke                # تست ۷ مسیر حیاتی روی سرور در حال اجرا
```

### 4.3 همهٔ اسکریپت‌های npm

| Script | What it does |
|---|---|
| `npm run dev` | سرور توسعه روی پورت 3000 (Turbopack + HMR) |
| `npm run build` | بیلد پروداکشن + آماده‌سازی `.next/standalone` |
| `npm run start` | اجرای خروجی standalone (همان چیزی که در Docker اجرا می‌شود) |
| `npm run start:single` | اجرای نسخهٔ تک‌فایل `node app.js` |
| `npm run lint` | ESLint (خروجی سالم: ۰ خطا) |
| `npm run typecheck` | `tsc --noEmit` (خروجی سالم: ۰ خطا) |
| `npm run smoke` | تست دود استقرار: ۷ مسیر حیاتی (`--url` برای سرور راه دور) |
| `npm run keys:generate` | ساخت کلیدهای API پایدار، آمادهٔ کپی در Railway (`-- --write` → ذخیره در فایل) |
| `npm run docker:build` | `docker build -t smart-chat:latest .` |
| `npm run docker:build:single` | بیلد تصویر نسخهٔ تک‌فایل |
| `npm run docker:run` | اجرای تصویر روی `http://localhost:3000` |
| `npm run db:generate` / `db:push` | Prisma (اختیاری — اپ چت به آن نیاز ندارد) |

### 4.4 رفتار اولین اجرا | First-Run Behavior

در اولین اجرا، اگر کلیدها در متغیرهای محیطی نباشند و `api-keys.json` وجود نداشته باشد، دو کلید جدید ساخته و در فایل کلیدها ذخیره می‌شود (permission `600`). ترتیب اولویت در **هر دو نسخه یکسان** است:

```
1) OPENAI_API_KEY / ANTHROPIC_API_KEY   (متغیر محیطی — توصیه‌شده برای استقرار)
2) فایل API_KEYS_FILE                   (پیش‌فرض: <project>/api-keys.json)
3) ساخت کلید تصادفی + تلاش برای ذخیره در همان فایل
```

هر دو کلید روی هر دو اندپوینت پذیرفته می‌شوند. اگر فایل‌سیستم قابل نوشتن نباشد (کانتینر read-only)، کلیدها فقط در حافظه می‌مانند و در لاگ راه‌اندازی چاپ می‌شوند.

> ⚠️ **برای استقرار، کلیدها را در env بگذارید.** فایل‌سیستم کانتینر ephemeral است: بدون `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`، با هر دیپلوی یا ری‌استارت کلید تازه ساخته می‌شود و کلاینت‌های `/v1` شما 401 می‌گیرند. با `npm run keys:generate` یک‌بار کلید بسازید و در Railway ▸ Variables بگذارید.

---

## 5. Docker | اجرای داکر

### 5.1 دو Dockerfile

| File | Base | Stage‌ها | حجم تصویر (تقریبی) | کاربرد |
|---|---|---|---|---|
| `Dockerfile` | `node:22-slim` | deps → build → runner | ~۱۵۰–۲۰۰MB | **پیش‌فرض** — نسخهٔ Next.js (همان چیزی که `railway.json` انتخاب می‌کند) |
| `Dockerfile.single` | `node:22-alpine` | تک‌مرحله‌ای | ~۵۰–۶۰MB | نسخهٔ تک‌فایل `app.js` — بدون `npm install` و بدون بیلد، بالا آمدن در چند ثانیه |

`Dockerfile` سه‌مرحله‌ای است؛ `node_modules` کامل (~۹۵۰MB) فقط در مرحلهٔ بیلد وجود دارد و تصویر نهایی **فقط خروجی trace‌شدهٔ standalone (~۳۶MB)** را می‌گیرد. کانتینر با کاربر غیر-root (`node`) اجرا می‌شود و `HEALTHCHECK` داخلی روی `/healthz` دارد (بدون نیاز به curl/wget در تصویر).

### 5.2 بیلد و اجرا

```bash
# نسخهٔ Next.js (پیش‌فرض)
docker build -t smart-chat .
docker run --rm -p 3000:3000 \
  -e OPENAI_API_KEY=sk-... \
  -e ANTHROPIC_API_KEY=sk-ant-api03-... \
  -e EXPOSE_KEYS=false \
  smart-chat

# نسخهٔ تک‌فایل
docker build -f Dockerfile.single -t smart-chat-single .
docker run --rm -p 3000:3000 -e OPENAI_API_KEY=sk-... smart-chat-single

# یا با اسکریپت‌های npm
npm run docker:build && npm run docker:run
```

بررسی سلامت از بیرون کانتینر:

```bash
curl -s http://localhost:3000/healthz
# {"status":"ok","service":"smart-chat","runtime":"next-standalone","uptimeSec":12,...}

docker inspect --format '{{json .State.Health}}' smart-chat-container | head -c 300
npm run smoke        # تست کامل ۷ مسیر
```

### 5.3 docker compose (محلی یا VPS)

```bash
cp .env.example .env                       # و کلیدها را پر کنید
npm run keys:generate -- --write           # یا کلیدها را مستقیم در .env بگذارید

docker compose up -d --build web           # نسخهٔ Next.js → http://localhost:3000
docker compose --profile single up -d --build single   # نسخهٔ تک‌فایل → http://localhost:3001
docker compose logs -f web
docker compose down
```

compose یک volume به نام `keys-data` روی `/data` می‌بندد و `API_KEYS_FILE=/data/api-keys.json` را ست می‌کند تا کلیدها بین ری‌استارت‌ها پایدار بمانند (روی Railway نیازی به این نیست — از Variables استفاده کنید).

### 5.4 چه چیزی داخل تصویر نمی‌رود | `.dockerignore`

`node_modules`، `.next`، `.git`، **`api-keys.json` و `.env` (رازها!)**، `db/`، `download/` (~۱.۴MB مستندات PDF)، `upload/`، `tool-results/`، `.zscripts/`، `tests/` و همهٔ فایل‌های Markdown. نتیجه: context کوچک، بیلد سریع، و **هیچ کلیدی داخل لایه‌های تصویر bake نمی‌شود**.

---

## 6. Railway | استقرار روی Railway

پروژه از قبل برای Railway آماده است: `railway.json` بیلدر را روی `DOCKERFILE` قفل می‌کند، مسیر health check را `/healthz` می‌گذارد و سیاست ری‌استارت را تنظیم می‌کند. اپ `PORT` تزریق‌شدهٔ Railway را می‌خواند و روی `0.0.0.0` گوش می‌دهد (هر دو پیش‌نیاز اصلی Railway).

### 6.1 روش A — داشبورد (GitHub)

1. این ریپو را روی GitHub push کنید (شاخهٔ `main` یا هر شاخهٔ دلخواه).
2. در [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub Repo** → ریپو را انتخاب کنید.
3. Railway خودش `Dockerfile` ریشه را پیدا می‌کند (در لاگ بیلد باید `Using detected Dockerfile!` یا بیلد Docker را ببینید). اگر ندید: **Service ▸ Settings ▸ Build ▸ Builder = Dockerfile** و **Dockerfile Path = `Dockerfile`**.
4. **Service ▸ Variables** این‌ها را اضافه کنید:

   | Variable | Value | لازم؟ |
   |---|---|---|
   | `OPENAI_API_KEY` | خروجی `npm run keys:generate` | ✅ توصیه‌شده (پایداری کلید) |
   | `ANTHROPIC_API_KEY` | خروجی `npm run keys:generate` | ✅ توصیه‌شده |
   | `EXPOSE_KEYS` | `false` | ✅ برای سرویس عمومی |
   | `PORT` | — | ❌ خود Railway تزریق می‌کند |

5. **Service ▸ Settings ▸ Networking ▸ Generate Domain** → دامنهٔ `https://<your-app>.up.railway.app` ساخته می‌شود.
6. **Service ▸ Settings ▸ Deploy** → `Healthcheck Path = /healthz` (از `railway.json` هم خوانده می‌شود).
7. منتظر بیلد بمانید (بار اول ~۲–۴ دقیقه) و سپس **View Logs**.

### 6.2 روش B — CLI

```bash
npm i -g @railway/cli        # نصب CLI
railway login                # ورود (مرورگر باز می‌شود)

cd <repo>
railway init --name smart-chat          # ساخت پروژهٔ جدید (یا: railway link)
railway variables --set "OPENAI_API_KEY=sk-..." \
                  --set "ANTHROPIC_API_KEY=sk-ant-api03-..." \
                  --set "EXPOSE_KEYS=false"
railway up                              # بیلد + دیپلوی (از Dockerfile ریشه)
railway domain                          # ساخت/نمایش دامنهٔ عمومی
railway logs                            # لاگ زنده
railway status                          # وضعیت سرویس
```

دیپلوی مجدد بعد از هر تغییر کد: `railway up` (یا push به GitHub اگر ریپو متصل است — Railway خودش rebuild می‌کند).

### 6.3 راستی‌آزمایی بعد از دیپلوی

```bash
URL=https://<your-app>.up.railway.app

curl -s $URL/healthz                                   # باید status:ok بدهد
npm run smoke -- --url $URL                            # ۷ تست کامل
curl -s $URL/v1/models                                 # لیست ۷ مدل
curl -N $URL/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"claude-fable-5.1","messages":[{"role":"user","content":"سلام"}],"stream":true}'
```

### 6.4 نکات مهم Railway

- **`PORT` را هاردکد نکنید.** `railway.json` هیچ `startCommand` ندارد تا `CMD ["node","server.js"]` در Dockerfile حاکم باشد و `server.js` خودش `process.env.PORT` را بخواند (تنظیم `startCommand` با CMD تداخل می‌کند و یکی از رایج‌ترین علت‌های شکست دیپلوی است).
- **باید روی `0.0.0.0` گوش دهید**، نه `127.0.0.1` — وگرنه پروکسی Railway به اپ نمی‌رسد و دیپلوی با خطای «Application failed to respond» رد می‌شود.
- **health check را روی `/api/ping` نگذارید.** آن اندپوینت واقعاً به آپستریم درخواست می‌دهد؛ اگر freemodels موقتاً 429 بدهد، Railway کانتینر سالم را ری‌استارت می‌کند. `/healthz` هیچ تماس شبکه‌ای ندارد و همیشه <۵ms پاسخ می‌دهد.
- **استریم SSE از پروکسی Railway عبور می‌کند.** پاسخ‌ها هدرهای `Cache-Control: no-cache, no-transform` و `X-Accel-Buffering: no` دارند؛ اگر پشت CDN/proxy دیگری هم می‌روید، buffering را خاموش کنید.
- **بدون domain، سرویس عمومی نیست** — حتماً Generate Domain (یا `railway domain`) را بزنید.
- **منابع پیشنهادی:** ۱ vCPU / ۱GB RAM برای اجرا کافی است؛ مرحلهٔ بیلد Next ~۵۱۲MB مصرف می‌کند.

### 6.5 اگر خواستید نسخهٔ تک‌فایل را دیپلوی کنید

**Service ▸ Settings ▸ Build ▸ Dockerfile Path = `Dockerfile.single`** (در `railway.json` هم می‌توانید `build.dockerfilePath` را عوض کنید). همان متغیرهای محیطی کار می‌کند؛ تنها تفاوت، `HOST` به‌جای `HOSTNAME` است (که پیش‌فرض هر دو `0.0.0.0` است).

---

## 7. Environment Variables | متغیرهای محیطی

الگو: `.env.example` (کپی کنید به `.env` برای اجرای محلی؛ در Railway همان‌ها را در Variables بگذارید).

| Variable | Default | Where | Description |
|---|---|---|---|
| `PORT` | `3000` | هر دو نسخه | پورت گوش‌دادن. Railway خودش تزریق می‌کند — دستی ست نکنید |
| `HOSTNAME` | `0.0.0.0` | Next.js | آدرس bind سرور standalone |
| `HOST` | `0.0.0.0` | `app.js` | آدرس bind (برای فقط-محلی: `127.0.0.1`) |
| `OPENAI_API_KEY` | — | هر دو نسخه | کلید سبک OpenAI (`sk-…`)؛ روی فایل کلیدها اولویت دارد |
| `ANTHROPIC_API_KEY` | — | هر دو نسخه | کلید سبک Anthropic (`sk-ant-api03-…`) |
| `EXPOSE_KEYS` | `true` | هر دو نسخه | `false` → کلیدها در UI و `GET /api/keys` ماسک می‌شوند (برای سرویس عمومی) |
| `API_KEYS_FILE` | `api-keys.json` کنار پروژه | هر دو نسخه | مسیر فایل کلیدها؛ در Docker روی volume: `/data/api-keys.json` |
| `NODE_ENV` | `production` | Next.js | در تصویر Docker ست شده است |
| `NEXT_TELEMETRY_DISABLED` | `1` | Next.js | تله‌متری نکست خاموش (در Dockerfile ست شده) |
| `DATABASE_URL` | `file:./db/custom.db` | Prisma (اختیاری) | فقط اگر از اسکافلد دیتابیس استفاده کنید |

**کلیدهای نامعتبر/placeholder نادیده گرفته می‌شوند:** اگر مقدار env یا فایل شامل `REPLACE`/`CHANGEME`/`xxxx` باشد یا کوتاه‌تر از ۱۶ نویسه، اپ آن را قبول نمی‌کند و کلید تصادفی امن می‌سازد (تا کپی‌کردن اشتباهی `api-keys.example.json` باعث کلید قابل حدس نشود).

---

## 8. Architecture | معماری

### 8.1 Request Flow | جریان درخواست

```
┌───────────────────────────── Browser ─────────────────────────────┐
│  page.tsx / HTML داخلی app.js   (RTL فارسی، تم تاریک #0b1220)      │
│  پیکر مدل · تفکر · جست‌وجوی عمیق · استریم · Raw SSE · سایدبار       │
└───────┬───────────────────────────────────────────────────┬───────┘
        │ POST /api/chat {messages, modelId, thinking,      │ GET /api/ping
        │  deepSearch, stream}                              │ GET /healthz
┌───────▼─────────────────────── Server ───────────┬────────▼───────┐
│  Next.js standalone (Docker/Railway) | app.js    │                │
│  • سقف بدنه 5MB (413)                            │                │
│  • جعل هدرهای مرورگر (Origin/Referer/UA/…)        │                │
│  • node:https + timeout 180s                     │                │
│  • pipe مستقیم استریم (بدون بافر)                 │                │
│  • خطای اتصال→502، تایم‌اوت→504                   │                │
└───────┬──────────────────────────────────────────┴────────────────┘
        │ POST https://freemodels-chat.freemodels.workers.dev/
        │ (هدر Origin: https://freemodels.pro — دور زدن CORS آپستریم)
┌───────▼─────────────────── Upstream (freemodels) ─────────────────┐
│  ۷ مدل · پاسخ SSE سبک OpenAI (delta.content + reasoning_content)  │
└───────────────────────────────────────────────────────────────────┘
```

علاوه بر این، هر دو سرور سه اندپوینت `/v1/*` دارند که **پاسخ آپستریم را با پارسر SSE جهانی (`src/lib/sse.ts`) گرفته و به فرمت استاندارد OpenAI یا Anthropic بازتولید می‌کنند** — یعنی نرمال‌سازی کامل فرمت، نه صرفاً عبور خام.

### 8.2 Upstream Connection | اتصال آپستریم

- **URL آپستریم:** `https://freemodels-chat.freemodels.workers.dev/` (ثابت در `src/lib/upstream.ts` و معادلش در app.js).
- **جعل هدرهای مرورگر:** `Origin: https://freemodels.pro`، `Referer: https://freemodels.pro/`، UA کروم ویندوزی، `sec-ch-*` و `sec-fetch-*` کامل، و `Accept-Encoding: identity` تا پاسخ فشرده نباشد و pipe مستقیم بدون decompress ممکن شود.
- **چرا `node:https`؟** مرورگرهای مدرن و `fetch` ارسال `Origin`/`Referer` دستی را ممنوع می‌کنند؛ برای عبور از CORS آپستریم باید این هدرها واقعاً روی سیم برود.
- **پایداری استریم:** پاسخ با `pipe` تکه‌به‌تکه (بدون تجمیع بافر) به کلاینت رد می‌شود؛ `Cache-Control: no-cache, no-transform` و `X-Accel-Buffering: no` روی پاسخ ست می‌شود تا پروکسی‌های میانی (از جمله Railway) بافر نکنند. قطع کلاینت → `destroy` فوری آپستریم.

### 8.3 Deployment Layout | چیدمان استقرار

```
repo
├── Dockerfile              ← Next.js: deps → build → runner (node:22-slim، غیر-root، HEALTHCHECK)
├── Dockerfile.single       ← app.js:  یک لایه (node:22-alpine)
├── .dockerignore           ← رازها و فایل‌های سنگین وارد context نمی‌شوند
├── railway.json            ← builder=DOCKERFILE · healthcheck=/healthz · restart=ON_FAILURE
├── docker-compose.yml      ← اجرای محلی/VPS با volume پایدار کلیدها
└── .next/standalone/       ← خروجی بیلد (server.js + node_modules trace‌شده + public + static)
```

### 8.4 File Map | نقشهٔ فایل‌ها

| File | Role |
|---|---|
| `src/app/page.tsx` | کل UI چت (client component ~۱۵۰۰ خط): سایدبار، هدر، پیکر مدل گروهی، کامپوزر، پیام‌ها، مودال تنظیمات، Raw SSE |
| `src/app/layout.tsx` | `lang=fa` · `dir=rtl` · فونت Vazirmatn (لینک مستقیم Google Fonts) · متادیتا |
| `src/app/globals.css` | استایل‌های اختصاصی: اسکرول‌بار، کرسر چشمک‌زن استریم، توکن‌های هایلایت کد، باکس تفکر |
| `src/app/error.tsx` | مرز خطای فارسی (جلوگیری از کرش کل صفحه) |
| `src/app/healthz/route.ts` | **سلامت سبک برای Docker/Railway (بدون تماس با آپستریم)** |
| `src/lib/upstream.ts` | ثابت‌های آپستریم + هدرهای جعلی + `openUpstream` (node:https, timeout 180s) + لاگ رنگی + CORS باز |
| `src/lib/sse.ts` | پارسر جهانی SSE آپستریم (سبک OpenAI delta، reasoning_content، `[DONE]`، خطای داخل استریم، JSON چندخطی ناقص) |
| `src/lib/markdown.ts` | رندر مارک‌داون امن بدون کتابخانه (escape کامل → درج کنترل‌شدهٔ تگ‌ها) |
| `src/lib/models.ts` | `FM_MODELS` (۷ مدل + گروه) + `DEFAULT_MODEL_ID` + `resolveModelId` — منبع واحد UI و `/v1` |
| `src/lib/apikeys.ts` | لود/ساخت کلیدها، `API_KEYS_FILE`، `keysExposed()`، `maskKey()`، `isUsableKey()`، `bearerFrom` |
| `src/lib/v1.ts` | `V1_CORS` · `SSE_HEADERS` · `flattenContent` · `readAll` (سقف ۸MB) · `estTokens` |
| `src/app/api/chat/route.ts` | پروکسی استریم چت (بدون احراز هویت — اپ داخلی) |
| `src/app/api/ping/route.ts` | تست اتصال **واقعی** به آپستریم → `{status, ms, sample}` |
| `src/app/api/keys/route.ts` | کلیدها برای مودال ⚙️ (با ماسک وقتی `EXPOSE_KEYS=false`) |
| `src/app/v1/models/route.ts` | `GET /v1/models` فرمت OpenAI (عمومی — بدون کلید) |
| `src/app/v1/chat/completions/route.ts` | `POST /v1/chat/completions` سازگار OpenAI (استریم/غیراستریم) |
| `src/app/v1/messages/route.ts` | `POST /v1/messages` سازگار Anthropic (model/max_tokens اجباری) |
| `app.js` | نسخهٔ تک‌فایل (~۳۱۰۰ خط): `PAGE_CSS` + `PAGE_JS` + `PAGE_HTML` + هندلرهای همان مسیرها + بنر رنگی |
| `scripts/finalize-standalone.mjs` | کپی `public`/`.next/static` داخل `.next/standalone` (کراس‌پلتفرم) |
| `scripts/generate-keys.mjs` | ساخت کلیدهای پایدار، خروجی آمادهٔ Railway Variables |
| `scripts/smoke.mjs` | تست دود ۷ مسیر (محلی یا `--url` راه دور) |
| `scripts/embed_logos.py` | ابزار بازتولید بلوک `EMBEDDED_LOGOS` در app.js |
| `api-keys.json` | کلیدهای محلی — **در `.gitignore` و `.dockerignore` است** (الگو: `api-keys.example.json`) |
| `public/*.webp,*.png` | ۴ لوگوی واقعی ارائه‌دهنده (در app.js به‌صورت base64 هم embed شده‌اند) |
| `prisma/schema.prisma` · `src/lib/db.ts` | اسکافلد اختیاری Prisma/SQLite — اپ چت استفاده نمی‌کند |
| `Caddyfile` · `.zscripts/` · `tests/*.sh` | باقی‌ماندهٔ پلتفرم قبلی (z.ai) — برای Railway/Docker لازم نیستند |

---

## 9. Features | قابلیت‌ها

### 9.1 Chat UI | رابط چت
- **چیدمان:** سایدبار راست 260px (چت جدید، لیست گفتگوها با حذف، خروجی Markdown/JSON، پاک‌کردن همه با confirm) + drawer موبایل؛ هدر با کنترل‌ها؛ ناحیهٔ چت؛ کامپوزر چسبان.
- **پیکر مدل گروهی** (مطابق HTML واقعی سایت freemodels): سه گروه «Claude Pro / ChatGPT Pro / Other Pro Models» با آیکن‌های lucide، لوگوی 20px هر مدل، ردیف انتخاب‌شدهٔ تیره، hover، اسکرول داخلی، تارگت لمسی 44px در موبایل، بستن با کلیک بیرون و Esc.
- **کنترل‌های هدر:** تفکر (thinking) · جست‌وجوی عمیق (deepSearch) · استریم · دکمهٔ «اتصال؟» با ping خودکار · پنل Raw SSE (80KB، ltr، mono) · مودال ⚙️ شامل System Prompt و بخش «🔑 اندپوینت‌های API و کلیدها» (نمایش/کپی کلیدها + نمونه curl) · نشانگر وضعیت سبز/زرد/قرمز.
- **اکشن‌های پیام:** کپی، بازتولید ↻، ویرایش اینلاین، توقف استریم (Esc)، نمایش باکس «💭 تفکر» جمع‌شونده، آمار زمان/توکن.
- **حافظه:** گفتگوها و تنظیمات در `localStorage` (`fm_chats`/`fm_settings`) — فقط بعد از mount خوانده می‌شود تا hydration نشکند.
- **موبایل:** همبرگر، اکشن‌های همیشه‌مرئی، safe-area کامپوزر، تست‌شده در 390px.

### 9.2 Markdown & Code | رندر مارک‌داون و کد
رندرر مارک‌داون **دست‌ساز و امن** است (بدون کتابخانه): ابتدا escape کامل HTML، سپس درج کنترل‌شدهٔ تگ‌ها. بلوک‌های کد با placeholder جداسازی می‌شوند و هدر زبان + دکمهٔ «کپی» + هایلایت سینتکس ساده + `dir=ltr` دارند؛ کد اینلاین، بولد/ایتالیک/خط‌خورده/لینک (`target=_blank`)، هدینگ‌ها، لیست‌ها، نقل‌قول و خط افقی هم پشتیبانی می‌شوند. این منطق در `src/lib/markdown.ts` و معادلش در `PAGE_JS` یکسان پیاده‌سازی شده است.

### 9.3 API Server | سرور API
هر دو نسخه سه اندپوینت استاندارد + مسیرهای داخلی را سرو می‌کنند (جزئیات کامل در بخش ۱۱): لیست مدل‌ها، چت‌کامپلیشن OpenAI و پیام‌های Anthropic — همه با CORS باز شامل هدرهای احراز هویت، و خطاها دقیقاً در فرمت JSON همان API مقصد.

### 9.4 Operations | قابلیت‌های عملیاتی (جدید)
- `GET /healthz` بدون تماس با آپستریم → health check پایدار برای Railway/Docker/K8s.
- `HEALTHCHECK` داخل هر دو Dockerfile (با خودِ Node، بدون curl).
- اجرای غیر-root، `PORT`/`HOSTNAME`/`HOST` از env، `/data` آماده برای volume کلیدها.
- `npm run smoke` برای راستی‌آزمایی سریع هر استقرار (محلی یا راه دور).
- لاگ راه‌اندازی کلیدها: اگر کلیدها خودکار ساخته شده باشند، مقادیر آمادهٔ کپی در Railway در لاگ چاپ می‌شوند.

---

## 10. Models | مدل‌ها

منبع واحد لیست مدل‌ها `src/lib/models.ts` (Next) و ثابت `FM_MODELS` (app.js) است؛ هم پیکر UI و هم اندپوینت‌های `/v1` از همین می‌خوانند، پس همیشه همگام‌اند. مدل پیش‌فرض: **`claude-fable-5.1`**.

| Model ID | Display Name | Vendor | Group |
|---|---|---|---|
| `claude-sonnet-5` | Claude Sonnet 5 | Anthropic | Claude Pro |
| `claude-fable-5` | Claude Fable 5 | Anthropic | Claude Pro |
| `claude-fable-5.1` | Claude Fable 5.1 ⭐ پیش‌فرض | Anthropic | Claude Pro |
| `sol`   | GPT 5.6 Sol | OpenAI | ChatGPT Pro |
| `terra` | GPT 5.6 Terra | OpenAI | ChatGPT Pro |
| `glm-5.2` | GLM 5.2 | Z.AI | Other Pro Models |
| `kimi-k3` | Kimi K3 | Moonshot AI | Other Pro Models |

**تطبیق نرم نام مدل** (`resolveModelId`): ورودی trim و lowercase شده، فاصله/آندرلاین به خط تیره تبدیل می‌شود و نام نمایشی هم پذیرفته است — «Claude Fable 5.1»، «claude_fable 5.1» و «claude-fable-5.1» هر سه به یک id نرمال می‌شوند. IDهای قدیمی (`gpt-5.6-sol`/`gpt-5.6-terra`) هم به `sol`/`terra` نگاشت می‌شوند. ورودی ناشناخته دست‌نخورده عبور می‌کند و ورودی خالی → مدل پیش‌فرض.

---

## 11. API Reference | مرجع API

### 11.1 Authentication | احراز هویت

| Endpoint | Auth |
|---|---|
| `GET /healthz` | بدون احراز هویت (سلامت سبک) |
| `GET /v1/models` | **بدون کلید (عمومی)** — برای Model Discovery کلاینت‌هایی که کلید نمی‌فرستند |
| `POST /v1/chat/completions` | `Authorization: Bearer <key>` |
| `POST /v1/messages` | `x-api-key: <key>` (یا همان Bearer) + `anthropic-version` اختیاری |
| `GET /api/chat` · `POST /api/chat` · `GET /api/ping` · `GET /api/keys` | بدون احراز هویت (مسیرهای داخلی اپ) |

**هر دو کلید روی هر دو اندپوینت پذیرفته می‌شوند.** کلیدها را هرگز در ریپو commit نکنید؛ آن‌ها را از Railway Variables یا `api-keys.json` محلی (که ignore شده) بخوانید:

```bash
# کلیدهای خودتان را بسازید
npm run keys:generate
# → OPENAI_API_KEY=sk-...
# → ANTHROPIC_API_KEY=sk-ant-api03-...
```

### 11.2 `GET /healthz` — Health Check (سبک)

بدون هیچ تماس شبکه‌ای؛ برای health check ارکستراتورها طراحی شده است:

```bash
curl -s http://localhost:3000/healthz
```

```json
{
  "status": "ok",
  "service": "smart-chat",
  "runtime": "next-standalone",
  "uptimeSec": 42,
  "node": "v22.22.3",
  "models": 7,
  "defaultModel": "claude-fable-5.1",
  "upstream": "https://freemodels-chat.freemodels.workers.dev/",
  "keysExposed": false,
  "timestamp": "2026-09-13T20:21:52.657Z"
}
```

> `runtime` در نسخهٔ تک‌فایل `single-file-node` است. مسیر جایگزین `/health` هم در `app.js` پاسخ می‌دهد.

### 11.3 `GET /api/ping` — Upstream Check (سنگین)

درخواست سبک `stream:false` با پیام `ping` **به آپستریم واقعی** می‌فرستد (تایم‌اوت ۲۰ ثانیه):

```json
{ "status": "ok", "ms": 2635, "sample": "…۲۰۰ کاراکتر اول پاسخ یا پیام خطای آپستریم…" }
```

خطای سهمیهٔ آپستریم هم `status:"error"` برمی‌گرداند ولی خودِ سرور سالم است — به همین دلیل برای health check استفاده **نشود**.

### 11.4 `POST /api/chat` — Internal Proxy

بدنه: `{"messages":[{role,content}...], "modelId":"claude-fable-5.1", "thinking":false, "deepSearch":false, "stream":true}` — پاسخ: عبور مستقیم استریم SSE آپستریم (سبک OpenAI با `delta.reasoning_content`/`delta.content`). خطاها: `413` حجم > 5MB · `502` خطای اتصال · `504` تایم‌اوت ۱۸۰ ثانیه.

### 11.5 `GET /v1/models` — List Models (OpenAI format)

**عمومی است و کلید نمی‌خواهد** (کلاینت‌ها هنگام کشف خودکار مدل معمولاً کلید نمی‌فرستند). اندپوینت‌های چت همچنان کلید می‌خواهند و بدون کلید `401 invalid_api_key` می‌دهند.

```bash
curl -s http://localhost:3000/v1/models
```

```json
{ "object": "list", "data": [
  { "id": "claude-sonnet-5", "object": "model", "created": 1789321278, "owned_by": "freemodels-anthropic" },
  { "id": "claude-fable-5.1","object": "model", "created": 1789321278, "owned_by": "freemodels-anthropic" },
  { "id": "sol",             "object": "model", "created": 1789321278, "owned_by": "freemodels-openai" },
  { "id": "glm-5.2",         "object": "model", "created": 1789321278, "owned_by": "freemodels-z.ai" },
  { "id": "kimi-k3",         "object": "model", "created": 1789321278, "owned_by": "freemodels-moonshot-ai" }
] }
```

> فیلدهای `group`/لوگو عمداً در پاسخ نیستند تا فرمت استاندارد OpenAI حفظ شود؛ آن‌ها فقط برای UI هستند. (پاسخ واقعی هر ۷ مدل را دارد.)

### 11.6 `POST /v1/chat/completions` — OpenAI Compatible

- فیلدها: `model` (نرمال نرم می‌شود؛ خالی → پیش‌فرض)، `messages` (اجباری، نقش‌های ناشناخته → user)، `stream` (boolean)، `stream_options.include_usage`، و دو **اکستنشن غیراستاندارد**: `thinking` و `deep_search` (boolean).
- **غیراستریم:** آبجکت کامل `chat.completion` با `choices[].message.content` و `usage` تخمینی (~۴ نویسه = ۱ توکن).
- **استریم:** چانک اول نقش → چانک‌های delta (`content` و در صورت وجود `reasoning_content`) → چانک `finish_reason:"stop"` → (در صورت `include_usage`، چانک usage) → `data: [DONE]`.
- خطای داخل استریم آپستریم به‌صورت چانک متنی «⚠️ …» منتشر می‌شود؛ خطای HTTP آپستریم ≥400 با همان کد و فرمت OpenAI برمی‌گردد.

```bash
curl -N https://<your-app>.up.railway.app/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-fable-5.1","messages":[{"role":"user","content":"سلام"}],"stream":true}'
```

با SDK رسمی:

```python
from openai import OpenAI
client = OpenAI(base_url="https://<your-app>.up.railway.app/v1", api_key="<OPENAI_API_KEY>")
print(client.chat.completions.create(model="claude-fable-5.1",
      messages=[{"role": "user", "content": "سلام"}]).choices[0].message.content)
```

### 11.7 `POST /v1/messages` — Anthropic Compatible

- طبق قوانین Anthropic، `model` و `max_tokens` **اجباری‌اند** (نبود → `400 invalid_request_error` با پیام `model: Field required` / `max_tokens: Field required`).
- `system` به‌صورت رشته یا آرایهٔ بلوک پذیرفته می‌شود.
- **غیراستریم:** آبجکت `message` با بلوک‌های `{type:"thinking", thinking}` (در صورت وجود) و `{type:"text", text}` + `stop_reason:"end_turn"` و `usage`.
- **استریم:** چرخهٔ کامل رویدادها: `message_start` → `ping` → (`content_block_start` + `content_block_delta` با `thinking_delta`/`text_delta` + `content_block_stop`)* → `message_delta` → `message_stop`.

```bash
curl -N https://<your-app>.up.railway.app/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" -H "Content-Type: application/json" \
  -d '{"model":"claude-fable-5.1","max_tokens":1024,"messages":[{"role":"user","content":"سلام"}],"stream":true}'
```

### 11.8 `GET /api/keys` — کلیدها برای UI

وقتی `EXPOSE_KEYS=false` باشد، کلیدها ماسک برمی‌گردند:

```json
{ "openai": "sk-TESTE••••••••••cdef", "anthropic": "sk-ant-a••••••••••7890",
  "exposed": false, "hint": "کلیدها در این استقرار مخفی‌اند (EXPOSE_KEYS=false)…" }
```

### 11.9 Error Formats | فرمت خطاها

| Source | Shape |
|---|---|
| OpenAI-style | `{"error":{"message":"…","type":"invalid_request_error\|api_error","param":null,"code":"invalid_api_key"}}` |
| Anthropic-style | `{"type":"error","error":{"type":"authentication_error\|invalid_request_error\|rate_limit_error\|api_error","message":"…"}}` |
| mapping | اتصال ناموفق → `502` · تایم‌اوت → `504` · 429 آپستریم → همان 429 |

---

## 12. Security & Production Checklist | امنیت و چک‌لیست پروداکشن

قبل از عمومی‌کردن سرویس این‌ها را انجام دهید:

- [ ] **کلیدها در env:** `OPENAI_API_KEY` و `ANTHROPIC_API_KEY` را با `npm run keys:generate` بسازید و در Railway Variables بگذارید (نه در ریپو).
- [ ] **`EXPOSE_KEYS=false`:** وگرنه هر بازدیدکننده‌ای می‌تواند با `GET /api/keys` کلیدهای شما را بردارد.
- [ ] **`api-keys.json` در ریپو نباشد:** در `.gitignore` و `.dockerignore` است. اگر قبلاً commit شده، کلیدها را **rotate** کنید (`npm run keys:generate -- --write --force` و به‌روزرسانی Variables).
- [ ] **`.env` را commit نکنید** (الگو: `.env.example`).
- [ ] **آگاه باشید `/api/chat` بدون احراز هویت است** — این پروکسی داخلیِ خودِ UI است؛ یعنی هر کسی که به سایت شما برسد می‌تواند از سهمیهٔ آپستریم رایگان استفاده کند. برای سرویس خیلی عمومی، محدودسازی نرخ (Rate limiting) در لبه (مثلاً Cloudflare یا Railway) توصیه می‌شود.
- [ ] **HTTPS:** Railway خودش TLS می‌دهد؛ پشت پروکسی شخصی حتماً `proxy_buffering off` و `X-Accel-Buffering: no` را رعایت کنید.
- [ ] **health check روی `/healthz`** باشد، نه `/api/ping`.
- [ ] بعد از هر دیپلوی: `npm run smoke -- --url https://<your-app>.up.railway.app`.

---

## 13. Verification | راستی‌آزمایی

### ۱) خودکار

```bash
npm run lint          # ۰ خطا
npm run typecheck     # ۰ خطا
npm run build         # بیلد موفق + خروجی .next/standalone (~۳۶MB)
npm run smoke         # ۷/۷ ✓ روی سرور در حال اجرا
node --check app.js   # سینتکس نسخهٔ تک‌فایل سالم
```

### ۲) چک‌لیست دستی سرور (curl)

- [ ] `GET /` → 200 HTML
- [ ] `GET /healthz` → 200 + `status:"ok"`
- [ ] `OPTIONS /api/chat` → 204 با `Access-Control-Allow-Origin: *`
- [ ] `GET /v1/models` بدون کلید → 200 با ۷ مدل؛ `POST /v1/chat/completions` بدون کلید → 401
- [ ] `POST /v1/chat/completions` استریم → چانک‌ها + `[DONE]`؛ غیراستریم → `usage`
- [ ] `POST /v1/messages` بدون `max_tokens` → 400؛ با آن → چرخهٔ کامل رویدادها
- [ ] `GET /api/ping` → `{status, ms, sample}` (تاخیر ۲–۳ ثانیه طبیعی است)
- [ ] مسیر ناشناس → 404؛ بدنهٔ >5MB → 413
- [ ] داخل Docker: `docker inspect --format '{{json .State.Health}}' <container>` → `healthy`

### ۳) مرورگر (هر دو نسخه)

- [ ] پیکر مدل: ۳ گروه / ۷ مدل / ۴ لوگو، انتخاب مدل ماندگار پس از reload، بستن با Esc و کلیک بیرون
- [ ] ارسال پیام → استریم زنده + باکس «💭 تفکر» + آمار؛ Esc وسط استریم → «⏹ متوقف شد»
- [ ] ویرایش اینلاین پیام کاربر / بازتولید ↻ / خروجی MD و JSON
- [ ] رفرش → تاریخچه و تنظیمات سر جایشان (`fm_chats`/`fm_settings`)
- [ ] مودال ⚙️ → بخش 🔑: با `EXPOSE_KEYS=false` کلیدها ماسک و دکمهٔ کپی غیرفعال
- [ ] موبایل 390px: هدر جمع‌شونده، همبرگر، تارگت 44px، کامپوزر چسبان

---

## 14. Troubleshooting | رفع اشکال

| علامت | علت احتمالی | راه‌حل |
|---|---|---|
| Railway: «Application failed to respond» / health check failed | اپ روی `127.0.0.1` گوش می‌دهد یا `PORT` نادیده گرفته شده | `HOSTNAME=0.0.0.0` (Next) / `HOST=0.0.0.0` (app.js) و خواندن `process.env.PORT` — در Dockerfile هر دو ست شده‌اند |
| بیلد Railway شکست: «server.js not found» | `output: "standalone"` از `next.config.ts` حذف شده | `output: "standalone"` را برگردانید؛ `scripts/finalize-standalone.mjs` در صورت نبودِ `server.js` با پیام واضح شکست می‌خورد |
| CSS/لوگوها در پروداکشن 404 | `public/` یا `.next/static/` داخل standalone کپی نشده | `npm run build` را کامل اجرا کنید (اسکریپت finalize این کار را می‌کند) |
| `/v1/*` همیشه 401 بعد از هر دیپلوی | کلیدها تصادفی ساخته می‌شوند (env ست نشده) | `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` را در Railway Variables بگذارید |
| UI کلیدها را نشان نمی‌دهد | `EXPOSE_KEYS=false` ست شده (رفتار درست برای سرویس عمومی) | کلیدها را از Variables بخوانید؛ برای دیدنشان موقتاً `EXPOSE_KEYS=true` |
| `GET /api/ping` خطا می‌دهد ولی سایت کار می‌کند | آپستریم رایگان 429 («providers exhausted») یا قطعی موقت | چند ثانیه بعد retry؛ health check را روی `/healthz` بگذارید |
| استریم تکه‌تکه نمی‌آید (یک‌جا می‌رسد) | buffering در پروکسی میانی | `proxy_buffering off` (nginx) / هدر `X-Accel-Buffering: no` را حفظ کنید |
| `docker build` خیلی کند است | context سنگین | `.dockerignore` را دست نزنید (download/، upload/، node_modules/، .git/) |
| فونت فارسی در کانتینر عوض شده | دسترسی خروجی به `fonts.googleapis.com` بسته است | فونت‌ها با `<link>` لود می‌شوند؛ در شبکهٔ بسته، فونت سیستم جایگزین می‌شود (باگ نیست) |
| خطای `EACCES` هنگام نوشتن `api-keys.json` | کانتینر read-only | `API_KEYS_FILE=/data/api-keys.json` + volume، یا کلیدها را در env بگذارید |

---

## 15. Development History | تاریخچهٔ توسعه

| # | Task | خروجی کلیدی |
|---|---|---|
| 1 | بک‌اند پروکسی `/api/chat` + `/api/ping` + کتابخانه‌های مشترک | تصمیم `node:https` به‌جای fetch برای ارسال واقعی Origin/Referer |
| 2 | فرانت‌اند کامل RTL فارسی | UI تم تاریک با استریم زنده و حافظهٔ localStorage |
| 3 | تأیید end-to-end با مرورگر headless | استریم ۲۸۶ تکه/۱۹ ثانیه، همهٔ اکشن‌ها ✓ |
| 4 | نسخهٔ تک‌فایل `app.js` (پورت کامل منطق، بدون پکیج) | رعایت قیود PAGE_JS (بدون backtick/`${`) |
| 5 | تأیید مستقل app.js | تست ۶ مسیر + 413 برای بدنهٔ بزرگ |
| 6 | ۷ مدل + کلیدهای API + اندپوینت‌های سازگار OpenAI/Anthropic | `/v1/*`، `api-keys.json`، مودال 🔑 |
| 7 | بازیابی ورک‌اسپیس + پیکر مدل گروهی مطابق سایت freemodels | ۴ لوگوی واقعی، ۳ گروه، رفع باگ z-index |
| 8 | **استقرار Docker/Railway + سخت‌سازی** | `Dockerfile` سه‌مرحله‌ای، `Dockerfile.single`، `.dockerignore`، `railway.json`، `docker-compose.yml`، `/healthz` در هر دو نسخه، `HOST`/`HOSTNAME`/`API_KEYS_FILE`/`EXPOSE_KEYS`، `scripts/finalize-standalone.mjs` + `generate-keys.mjs` + `smoke.mjs`، رفع خطاهای تایپ (`node:http`) و ۰ شدن lint، حذف `api-keys.json` از ریپو، و به‌روزرسانی کامل مستندات |

---

## 16. Known Issues & Roadmap | مشکلات شناخته‌شده و نقشهٔ راه

### 16.1 Known Issues

1. **خطای موقت 429 آپستریم** («providers exhausted» / «Service temporarily overloaded»): رفتار سرویس رایگان است، نه باگ پروژه. هر دو نسخه آن را شفاف به حباب قرمز (UI) یا کد/فرمت استاندارد (API) تبدیل می‌کنند و retry پس از چند ثانیه معمولاً موفق است.
2. **فرمت پاسخ آپستریم قفل به سبک OpenAI فعلی است.** پارسر `sse.ts` جهانی طراحی شده اما اگر آپستریم ساختارش را تغییر دهد، اولین نقطهٔ بررسی همین فایل است.
3. **وابستگی فونت به شبکه در نسخهٔ Next:** فونت Vazirmatn با لینک مستقیم Google Fonts لود می‌شود (تصمیم عمدی)؛ در محیط بدون اینترنت، فونت جایگزین رندر می‌شود. نسخهٔ app.js لوگوها را embed دارد.
4. **`usage` تخمینی است** (~۴ نویسه = ۱ توکن) چون آپستریم usage واقعی نمی‌دهد.
5. **`/api/chat` و `/api/keys` بدون احراز هویت‌اند** (طراحی اپ محلی). برای سرویس عمومی `EXPOSE_KEYS=false` بگذارید و در صورت نیاز rate limiting اضافه کنید.
6. **دیتابیس Prisma اسکافلد استفاده‌نشده است** (`prisma/schema.prisma`، `src/lib/db.ts`، `db/custom.db`)؛ اگر هیچ‌وقت لازم نشد می‌توان حذفش کرد تا `npm ci` سبک‌تر شود.
7. **ID واقعی مدل‌های GPT در سایت فقط `sol` و `terra` است** (کشف‌شده از باندل رسمی freemodels.pro)؛ alias سازگاری برای IDهای قدیمی و نام نمایشی حفظ شده است.

### 16.2 Roadmap

- **Retry خودکار با backoff** برای 429 آپستریم در لایهٔ پروکسی.
- **Rate limiting** برای `/api/chat` در استقرار عمومی.
- **`group`/`vendor` در `/v1/models`** به‌صورت extension اختیاری.
- **پایداری کلیدها روی Railway Volume** به‌جای env (اگر ترجیح می‌دهید کلید در فایل بماند: `API_KEYS_FILE=/data/api-keys.json` + افزودن Volume در داشبورد).
- **CI:** اجرای `lint` + `typecheck` + `build` + `smoke` در GitHub Actions (اسکریپت‌ها آماده‌اند).
- **حذف اسکافلد Prisma** در صورت عدم نیاز.
