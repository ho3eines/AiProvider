# چت هوشمند — Smart Chat · Project Documentation

> **مستندات کامل پروژه | Full Project Documentation** — نسخهٔ ۲.۰ · ۱۳ سپتامبر ۲۰۲۶ (۲۲ شهریور ۱۴۰۵)
> ساختار انگلیسی + توضیحات فارسی · English structure + Persian body
>
> **تغییر اصلی نسخهٔ ۲.۰:** همهٔ مدل‌ها/پروایدرها/آپستریم‌ها به یک رجیستری
> واحد (`providers.json`) منتقل شدند و «مهارت‌ها» (`skills/`) اضافه شدند؛ پس
> افزودن مدل یا وصل‌کردن سایت جدید **بدون نوشتن کد** ممکن است.

| Item | Value |
|---|---|
| **Project Name** | چت هوشمند (Smart Chat) · ریپو: `AiProvider` |
| **Stack** | Next.js 16 · React 19 · Tailwind CSS 4 · TypeScript + نسخهٔ تک‌فایل Node خالص (`app.js`) |
| **Purpose** | Chat UI فارسی RTL + پروکسی سرویس‌های چت رایگان + سرور API سازگار با OpenAI و Anthropic |
| **Source of Truth** | `providers.json` — رجیستری پروایدرها/مدل‌ها (با اسکیمای `docs/providers.schema.json`) |
| **Entry Points** | `src/app/page.tsx` (Next.js) · `app.js` (standalone, بدون وابستگی) |
| **Config Files** | `providers.json` · `api-keys.json` · `package.json` · `next.config.ts` · `.env` |
| **Quality Gates** | `npm run verify` (ساختار/همگامی) · `npm run smoke` (۳۰ آزمون رفتاری) · `npm run typecheck` · `npm run lint` |
| **Docs** | `README.md` (همین فایل) · `HANDOFF.md` (سند تحویل) · `AI-GUIDE.md` (راهنمای عمیق) · `skills/` (دفترچهٔ عملیات تغییرات) · `worklog.md` (تاریخچه) |

---

## 1. Overview | معرفی پروژه

این پروژه یک اپلیکیشن چت هوشمند کامل است که به سرویس‌های چت رایگان
(در حال حاضر **freemodels**) وصل می‌شود. رابط کاربری به سبک ابزارهای مدرنِ چت
AI طراحی شده — تم تاریک، چیدمان راست‌به‌چپ فارسی، فونت Vazirmatn، پیکر مدلِ
گروهی با لوگوی واقعی ارائه‌دهنده‌ها — و پاسخ‌ها به‌صورت زنده (streaming) همراه
با نمایش جداگانهٔ «فرایند تفکر» مدل رندر می‌شوند.

پروژه **دو نسخهٔ موازی و هم‌رفتار** دارد:

1. **نسخهٔ Next.js** (`src/`) — اپ کامل React با Tailwind 4؛ مناسب توسعه،
   پیش‌نمایش زنده و استقرار استاندارد.
2. **نسخهٔ تک‌فایل `app.js`** — یک فایل CommonJS خالصِ Node بدون هیچ وابستگی
   خارجی که سرور HTTP، پروکسی، API و کل UI را سرو می‌کند؛ با `node app.js`
   روی هر ماشینی اجرا می‌شود (بدون `npm install`).

هر دو نسخه علاوه بر رابط چت، **API سازگار با OpenAI و Anthropic** ارائه
می‌دهند (`/v1/models`، `/v1/chat/completions`، `/v1/messages`) تا هر کلاینت
استانداردی (SDK رسمی، curl، LangChain، ابزارهای شخص ثالث) بتواند از مدل‌ها
استفاده کند. احراز هویت با کلیدهای سبک OpenAI/Anthropic انجام می‌شود که در
اولین اجرا خودکار ساخته و در `api-keys.json` ذخیره می‌گردند.

**ویژگی نسخهٔ ۲.۰ — معماری رجیستری‌محور:** تعریف پروایدرها (آدرس آپستریم،
هدرها، احراز هویت، شکل بدنهٔ درخواست، فیلدهای پاسخ، گروه‌ها و مدل‌ها) از کد
بیرون کشیده شده و در `providers.json` نشسته است. هر دو نسخه این فایل را در
زمان اجرا می‌خوانند (با **hot reload**)، بنابراین:

- افزودن **مدل** جدید ← ویرایش JSON (بدون کد) → `skills/add-model`
- افزودن **پروایدر/سایت** جدید ← ویرایش JSON (بدون کد) → `skills/add-provider`
- افزودن **قابلیت** جدید ← کد در هر دو نسخه → `skills/add-feature`

<!-- GENERATED:counts -->
**پروایدرهای فعال:** 1 · **مدل‌ها:** 7 · **گروه‌های پیکر:** 3 · **روت‌های Next:** 7 · **روت‌های app.js:** 9 · **مدل پیش‌فرض:** `claude-fable-5.1`
<!-- /GENERATED:counts -->

---

## 2. What's New in 2.0 | چه چیز تازه است

| مورد | قبل | اکنون |
|---|---|---|
| منبع مدل‌ها | لیست سخت‌کد در `src/lib/models.ts` + `FM_MODELS` در `app.js` (دو جای جدا) | `providers.json` یکتا + کپی خودکار داخل `app.js` (`npm run sync:builtin`) |
| پروایدر/آپستریم | ثابت در کد | رجیستری با `upstream`/`request`/`response` برای هر پروایدر |
| افزودن سایت جدید | بازنویسی کد در دو نسخه | ویرایش JSON (شکل بدنه، هدرها، auth از env) |
| کاتالوگ UI | ثابت در باندل | `GET /api/models` (زنده) با fallback به رجیستری بسته‌بندی‌شده |
| تست | چک‌لیست دستی | `npm run smoke` (۳۰ آزمون) + آپستریم ساختگی + `npm run dev:mock` |
| صحت‌سنجی | — | `npm run verify` (ساختار، همگامی دو نسخه، سلامت سند، ارجاعات) |
| مستندات | دستی (اعداد کهنه) | بلوک‌های `<!-- GENERATED:* -->` با `npm run docs:sync` |
| دانش تغییرات | پراکنده در HANDOFF | شش مهارت در `skills/` با گام‌ها، فرمان‌ها و دام‌ها |
| اشکال رفع‌شده | چانک `finish_reason` در استریم OpenAI هرگز ارسال نمی‌شد | رفع شد + آزمون دائمی در smoke |

---

## 3. System Requirements | پیش‌نیازهای سیستم

| Requirement | Next.js Version | Single-File (`app.js`) |
|---|---|---|
| **Runtime** | Node.js ≥ 20.9 (توصیه: ۲۲+) یا Bun ≥ 1.3 | Node.js ≥ 18 (فقط ماژول‌های داخلی) |
| **Package Manager** | `bun` (قفلِ ریپو: `bun.lock`) یا npm/pnpm | **هیچ** — بدون نصب پکیج |
| **Disk** | ~600MB (node_modules) | ~170KB (فقط `app.js` + `api-keys.json`) |
| **Network** | دسترسی به آپستریمِ فعال + `fonts.googleapis.com` | فقط آپستریم (لوگوها base64 داخل فایل‌اند) |
| **OS** | Linux/macOS/Windows | همان |
| **Ports** | 3000 (`-p`) | `PORT` (پیش‌فرض 3000) · `HOST` (پیش‌فرض `127.0.0.1`) |
| **بدون اینترنت** | `npm run dev:mock` | `npm run dev:mock:appjs` |

> نسخهٔ تک‌فایل عمداً به‌جای `fetch` از `node:https` استفاده می‌کند تا بتواند
> هدرهای `Origin`/`Referer` (که در fetch استاندارد ممنوع‌اند) را واقعاً ارسال
> کند — بعضی سرویس‌های رایگان بدون این هدرها درخواست را رد می‌کنند.

---

## 4. Installation & Run | نصب و اجرا

### 4.1 Next.js Version

```bash
bun install            # یا: npm install
bun run dev            # → http://localhost:3000  (لاگ در dev.log)

bun run build          # بیلد پروداکشن standalone
bun run start          # bun .next/standalone/server.js
```

### 4.2 Single-File Version (app.js)

```bash
node app.js                        # پورت 3000، فقط روی لوپ‌بک
PORT=8080 HOST=0.0.0.0 node app.js # پورت/آدرس دلخواه (دسترسی از بیرون)
node --check app.js                # بررسی سینتکس (قبل از هر استقرار)
```

### 4.3 Offline Development | توسعهٔ بدون اینترنت

یک آپستریم ساختگی + رجیستری آزمایشی (۶ پروایدر که هر قابلیت رجیستری را
پوشش می‌دهند) به‌صورت آماده وجود دارد:

```bash
npm run dev:mock          # Next.js + آپستریم ساختگی روی 4100
npm run dev:mock:appjs    # همان با نسخهٔ تک‌فایل
npm run smoke             # ۳۰ آزمون رفتاری (خودش سرور را بالا می‌آورد)
npm run smoke -- --base http://127.0.0.1:3000   # آزمون روی سرورِ در حال اجرا
```

### 4.4 Environment Variables | متغیرهای محیطی

<!-- GENERATED:env -->
| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | override کلید سبک Anthropic (به‌جای مقدار `api-keys.json`) |
| `DATABASE_URL` | — | فقط برای قالب Prisma (استفاده‌نشده در منطق چت) |
| `FM_DISABLE_PROVIDERS` | — | فهرست پروایدرهایی که اجباراً خاموش شوند (جدا با کاما) |
| `FM_ENABLE_PROVIDERS` | — | فهرست پروایدرهایی که اجباراً فعال شوند (جدا با کاما) — برای تست آفلاین؛ در UI هم اثر می‌کند |
| `FM_PROVIDERS_FILE` | `./providers.json` | مسیر جایگزین برای `providers.json` (پیش‌فرض: ریشهٔ پروژه) |
| `HOST` | `127.0.0.1` | آدرس bind نسخهٔ تک‌فایل — پیش‌فرض `127.0.0.1` (فقط محلی)؛ برای دسترسی بیرونی `0.0.0.0` |
| `MOCK_HOST` | `0.0.0.0` | آدرس bind آپستریم ساختگی (پیش‌فرض `0.0.0.0`) |
| `MOCK_PORT` | `4100` | پورت آپستریم ساختگی — `scripts/mock-upstream.mjs` (پیش‌فرض `4100`) |
| `NODE_ENV` | — | حالت اجرای Next.js (`production` برای `bun run start`) |
| `OPENAI_API_KEY` | — | override کلید سبک OpenAI (به‌جای مقدار `api-keys.json`) |
| `PORT` | `3000` | پورت سرور نسخهٔ تک‌فایل (`app.js`) — پیش‌فرض `3000` |
<!-- /GENERATED:env -->

### 4.5 First-Run Behavior | رفتار اولین اجرا

در اولین اجرا (هر دو نسخه) اگر `api-keys.json` نباشد، دو کلید تازه ساخته و با
دسترسی `600` کنار پروژه ذخیره می‌شود؛ در اجراهای بعدی همان‌ها لود می‌شوند.
`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` در محیط بر فایل اولویت دارند. رجیستری هم
در اولین اجرا خوانده می‌شود و اگر `providers.json` در دسترس نباشد، نسخهٔ
تک‌فایل با کپی داخلیِ `BUILTIN_PROVIDERS` بالا می‌آید (با یک خطِ هشدار در لاگ).

---

## 5. Extensibility | توسعه‌پذیری — پروایدر و مدل جدید

### 5.1 Registry Anatomy | ساختار رجیستری

`providers.json` تنها جایی است که برای «چه مدل‌هایی، از کدام سایت، با چه
قراردادی» باید دست بزنید:

```jsonc
{
  "version": 1,
  "defaults": { "providerId": "freemodels", "modelId": "claude-fable-5.1",
                "timeoutMs": 180000, "maxBodyBytes": 5242880 },
  "providers": [
    {
      "id": "freemodels",
      "enabled": true,
      "ownedByPrefix": "freemodels",          // ← owned_by در /v1/models
      "upstream": {                            // کجا و چطور وصل شویم
        "url": "https://…/", "method": "POST", "timeoutMs": 180000,
        "headers": { "Origin": "https://freemodels.pro", "Accept-Encoding": "identity" },
        "auth": null                           // یا { "header": "Authorization", "value": "Bearer ${KEY}" }
      },
      "request":  { "shape": "freemodels", "passthrough": true,
                    "fields": { "model": "modelId", "thinking": "thinking" },
                    "constants": {} },          // بدنهٔ ارسالی چگونه ساخته شود
      "response": { "profile": "universal", "textFields": [], "reasoningFields": [] },
      "groups":   [ { "title": "Claude Pro", "icon": "sparkles" } ],
      "models":   [ { "id": "claude-fable-5.1", "name": "Claude Fable 5.1",
                      "vendor": "Anthropic", "group": "Claude Pro",
                      "logo": "/Claude-ai-logo.webp", "default": true } ]
    }
  ]
}
```

اسکیمای کامل با توضیح هر فیلد: `docs/providers.schema.json` (فایل با
`"$schema"` به آن وصل است، پس ویرایشگرها راهنما/اعتبارسنجی می‌دهند).

### 5.2 Add a Model | افزودن مدل (بدون کد)

```jsonc
{ "id": "claude-opus-5", "name": "Claude Opus 5", "vendor": "Anthropic",
  "group": "Claude Pro", "logo": "/Claude-ai-logo.webp" }
```

```bash
npm run sync:builtin && npm run verify && npm run smoke && npm run docs:sync
```

hot reload فعال است: بدون restart، هم در API و هم (بعد از refresh صفحه) در UI
دیده می‌شود. جزئیات، فیلدهای اختیاری (`upstreamId`/`aliases`/`default`) و دام‌ها:
**`skills/add-model/SKILL.md`**.

### 5.3 Add a Provider | وصل‌کردن سایت جدید (بدون کد)

یک آبجکت به `providers` اضافه کنید: آدرس، هدرها، احراز هویت (از env)، شکل
بدنه (`openai` / `anthropic` / `freemodels` / `passthrough` یا نگاشت دلخواه
فیلدها)، فیلدهای پاسخ، گروه‌ها و مدل‌ها. چند پروایدر هم‌زمان فعال‌اند و
**پروایدر از روی مدل انتخاب می‌شود**.

```bash
npm run dev:mock        # اول آفلاین با آپستریم ساختگی تست کنید
npm run sync:builtin && npm run verify && npm run smoke && npm run docs:sync
```

الگوهای آماده (OpenAI-like، Anthropic-like، فیلدهای سفارشی، auth با `${VAR}`)،
روش شناسایی شکل API با curl، و جدول دام‌ها: **`skills/add-provider/SKILL.md`**.

### 5.4 Runtime Switches | کلیدهای زمان اجرا

```bash
FM_PROVIDERS_FILE=/path/my-providers.json node app.js   # رجیستریِ جدا (پروایدر شخصی/محرمانه)
FM_ENABLE_PROVIDERS=mock,example npm run dev            # فعال‌کردن اجباری (تست)
FM_DISABLE_PROVIDERS=freemodels npm run dev             # خاموش‌کردن اجباری
```

در نسخهٔ Next، کلاینت کاتالوگ را بعد از mount از `GET /api/models` می‌گیرد، پس
این کلیدها در UI هم اثر می‌کنند. در نسخهٔ تک‌فایل، کاتالوگ داخل خودِ HTML
تزریق می‌شود (`window.__FM__`).

### 5.5 When Config Is Not Enough | کی کد لازم است؟

فقط وقتی که آپستریم **اصلاً** SSE/JSON رایج نیست (WebSocket، امضای HMAC،
ساختار تودرتوی عجیب). آن‌وقت دو فایل در هر نسخه عوض می‌شود:

| لایه | Next.js | `app.js` |
|---|---|---|
| پارسر پاسخ/استریم | `src/lib/sse.ts` | `makeUpstreamParser` |
| اتصال/هدرها | `src/lib/upstream.ts` | `openUpstream` |

قانون طلایی: تغییر در یکی ⇒ معادلش در دیگری + آزمون تازه در
`scripts/smoke.mjs` → **`skills/add-feature/SKILL.md`**.

---

## 6. Skills & Tooling | مهارت‌ها و ابزارها

پوشهٔ `skills/` دفترچهٔ عملیاتِ تغییرات است (برای توسعه‌دهنده و دستیار هوش
مصنوعی). قبل از هر تغییر، مهارت مربوط را بخوانید:

<!-- GENERATED:skills -->
| مهارت | چه کاری را آسان می‌کند |
|---|---|
| `skills/add-feature/` | افزودن قابلیت تازه یا رفع اشکال به‌شکلی که هر دو نسخهٔ اپ (Next.js در src/ و تک‌فایل app.js) هم‌زمان و هم‌رفتار بمانند — شامل نقشهٔ «کجا چه چیزی است»، ترتیب کار، و چگونگی افزودن آزمون و بررسی خودکار. |
| `skills/add-model/` | افزودن/ویرایش/حذف مدل در رجیستری پروایدرها — بدون نوشتن حتی یک خط کد. وقتی استفاده کنید که بخواهید مدل تازه‌ای به یک پروایدرِ موجود اضافه کنید، نام/لوگو/گروه مدل را عوض کنید، یا مدل پیش‌فرض اپ را تغییر دهید. |
| `skills/add-provider/` | وصل‌کردن یک سایت/آپستریم جدید (پروایدر) به پروژه — تعریف endpoint، هدرها، احراز هویت، شکل بدنهٔ درخواست و نحوهٔ خواندن پاسخ، فقط با ویرایش providers.json. وقتی استفاده کنید که بخواهید مدل‌های یک سرویس دیگر (OpenAI-like، Anthropic-like یا سفارشی) را به اپ و API اضافه کنید. |
| `skills/debug-stream/` | راهنمای تشخیص و رفع اشکالِ پاسخ/استریم (SSE)، پروکسی آپستریم، خطاهای 4xx/5xx و مشکلات پیکر مدل — با دستورهای آمادهٔ curl، جدول «علامت ← علت ← راه‌حل» و ابزار آپستریم ساختگی. |
| `skills/edit-appjs/` | قواعد ویرایش امنِ فایل تک‌خطی app.js — ساختار فایل، سه بلوک قالبِ PAGE_CSS/PAGE_JS/PAGE_HTML، محدودیت‌های سخت‌گیرانهٔ String.raw، جریان دادهٔ کلاینت، کپی داخلی رجیستری و لوگوها، و بررسی‌های اجباری بعد از هر تغییر. |
| `skills/update-docs/` | به‌روزرسانی مستندات پروژه — بلوک‌های تولیدی `<!-- GENERATED:* -->`، همگام‌سازی `download/`، قرارداد دوزبانه (سرآیند انگلیسی + متن فارسی) و قواعد سالم‌نگه‌داشتن سند. وقتی استفاده کنید که مدل/پروایدر/endpoint/اسکریپت تازه‌ای اضافه شده یا سند کهنه/خراب شده است. |
<!-- /GENERATED:skills -->

فهرست کامل فرمان‌ها:

<!-- GENERATED:scripts -->
| دستور | چه کار می‌کند |
|---|---|
| `npm run dev` | اجرای محیط توسعهٔ Next.js روی پورت 3000 (لاگ در `dev.log`) |
| `npm run build` | بیلد پروداکشن standalone |
| `npm run start` | اجرای نسخهٔ پروداکشن با bun |
| `npm run standalone` | اجرای نسخهٔ تک‌فایل بدون وابستگی (`node app.js`) |
| `npm run dev:mock` | محیط توسعهٔ آفلاین: آپستریم ساختگی + Next با پروایدرهای آزمایشی |
| `npm run dev:mock:appjs` | همان `dev:mock` ولی با نسخهٔ تک‌فایل `app.js` |
| `npm run lint` | eslint روی کل پروژه |
| `npm run typecheck` | بررسی انواع TypeScript بدون خروجی |
| `npm run check:appjs` | بررسی سینتکس `app.js` |
| `npm run verify` | صحت‌سنجی همگامی کد/پیکربندی/سندها (`scripts/verify.mjs`) |
| `npm run verify:full` | همهٔ بررسی‌های `verify` + `tsc` + `eslint` + smoke |
| `npm run smoke` | تست دود end-to-end با آپستریم ساختگی (`scripts/smoke.mjs`) |
| `npm run mock` | اجرای آپستریم ساختگی روی پورت 4100 (`scripts/mock-upstream.mjs`) |
| `npm run docs:sync` | به‌روزرسانی بلوک‌های تولیدی سندها (`scripts/docs-sync.mjs`) |
| `npm run docs:check` | بررسی عقب‌بودن سندها (بدون نوشتن) |
| `npm run embed:logos` | بازتولید لوگوهای base64 داخل `app.js` (`scripts/embed-logos.mjs`) |
| `npm run sync:builtin` | بازسازی کپی `providers.json` داخل `app.js` (`BUILTIN_PROVIDERS`) |
| `npm run db:push` | Prisma — قالب باقی‌مانده (منطق چت استفاده نمی‌کند) |
| `npm run db:generate` | Prisma — تولید کلاینت |
| `npm run db:migrate` | Prisma — مایگریشن |
| `npm run db:reset` | Prisma — ریست دیتابیس |
<!-- /GENERATED:scripts -->

---

## 7. Architecture | معماری

### 7.1 Request Flow | جریان درخواست

```
┌──────────────────────────── Browser ────────────────────────────┐
│ page.tsx (Next)  /  PAGE_HTML+PAGE_JS (app.js) — RTL، تم تاریک   │
│ پیکر مدل گروهی · تفکر · جست‌وجوی عمیق · استریم · Raw SSE · سایدبار │
└──────┬──────────────────────────────────────────────┬───────────┘
       │ POST /api/chat {messages, modelId, …}        │ GET /api/models
┌──────▼────────────────────── Server ────────────────▼───────────┐
│ providers.json ─► getProviders()  (hot reload هر ۱ ثانیه)        │
│   resolveModel(modelId)         ← پروایدر از روی مدل             │
│   buildUpstreamPayload(...)     ← بدنه در «شکل» همان آپستریم     │
│   openUpstreamFor(provider)     ← url/headers/auth/timeout       │
│   پارسر جهان‌شمول SSE           ← text / reasoning / done        │
│ سقف بدنه ۵MB (413) · خطای اتصال→502 · تایم‌اوت→504 · CORS باز    │
└──────┬──────────────────────────────────────────────────────────┘
       │ POST https://freemodels-chat.freemodels.workers.dev/
       │ هدرهای مرورگر‌نما (Origin/Referer/UA/sec-*) + identity
┌──────▼──────────────── Upstream (پروایدر فعال) ─────────────────┐
│ پاسخ SSE (delta.content + reasoning_content) یا JSON معمولی      │
└─────────────────────────────────────────────────────────────────┘
```

مسیرهای `/v1/*` پاسخ آپستریم را با پارسر جهان‌شمول می‌خوانند و آن را **به
فرمت استاندارد OpenAI یا Anthropic بازتولید می‌کنند** (نرمال‌سازی کامل، نه
عبور خام). مسیر `/api/chat` برای UI است و SSE آپستریم را مستقیم pipe می‌کند.

### 7.2 Upstream Connection | اتصال آپستریم

- **آدرس و هدرها از رجیستری می‌آیند** (نه از کد) — پروایدر `freemodels` فعلاً
  از هدرهای مرورگر‌نما (`Origin: https://freemodels.pro`، UA کروم ویندوزی،
  `sec-ch-*`، `sec-fetch-*`) و `Accept-Encoding: identity` استفاده می‌کند.
- **چرا `node:https`؟** مرورگرها و `fetch` ارسال دستی `Origin`/`Referer` را
  ممنوع می‌کنند؛ برای عبور از بررسیِ آپستریم این هدرها باید واقعاً روی سیم
  بروند (در هر دو نسخه رعایت شده).
- **پایداری استریم:** پاسخ تکه‌به‌تکه و بدون بافر رد می‌شود؛
  `Cache-Control: no-cache, no-store, no-transform` و `X-Accel-Buffering: no`
  ست می‌شود تا پروکسی‌های میانی بافر نکنند. قطع کلاینت ⇒ `destroy` فوری
  آپستریم.
- **ضرب‌العجل:** از رجیستری (`upstream.timeoutMs`، پیش‌فرض ۱۸۰ ثانیه).

### 7.3 Providers | پروایدرهای ثبت‌شده

<!-- GENERATED:providers -->
| Provider | نام | سایت | آپستریم | شکل درخواست | مدل‌ها | وضعیت |
|---|---|---|---|---|---|---|
| `freemodels` | freemodels | https://freemodels.pro | `https://freemodels-chat.freemodels.workers.dev/` | `freemodels` | 7 | ✅ فعال |
| `mock` | Mock (local test) | http://127.0.0.1:4100 | `http://127.0.0.1:${MOCK_PORT:-4100}/chat` | `openai` | 1 | ⛔ غیرفعال |
<!-- /GENERATED:providers -->

گروه‌های پیکر مدل (به‌ترتیب رجیستری):

<!-- GENERATED:groups -->
| عنوان گروه | آیکن (`groups[].icon`) | تعداد مدل |
|---|---|---|
| Claude Pro | `sparkles` | 3 |
| ChatGPT Pro | `zap` | 2 |
| Other Pro Models | `globe` | 2 |
<!-- /GENERATED:groups -->

نام‌های آیکن مجاز: `sparkles` · `zap` · `globe` · `flask` · `bot` · `brain`
(در هر دو نسخه یکسان؛ نام ناشناخته ← `globe`).

### 7.4 File Map | نقشهٔ فایل‌ها

<!-- GENERATED:stats -->
| فایل | نقش | خط | حجم |
|---|---|---|---|
| `app.js` | نسخهٔ تک‌فایل Node (سرور + UI) | 3715 | 171 KB |
| `src/app/page.tsx` | UI چت نسخهٔ Next.js | 1545 | 62 KB |
| `src/lib/catalog.ts` | کاتالوگ ایزومورفیک پروایدرها/مدل‌ها | 463 | 20 KB |
| `src/lib/providers.ts` | رجیستری سمت سرور (hot reload) | 109 | 4 KB |
| `src/lib/upstream.ts` | لایهٔ انتقال به آپستریم | 155 | 6 KB |
| `src/lib/sse.ts` | پارسر جهانی SSE | 217 | 8 KB |
| `src/lib/markdown.ts` | رندر مارک‌داون امن | 265 | 9 KB |
| `src/app/v1/chat/completions/route.ts` | اندپوینت سازگار OpenAI | 239 | 8 KB |
| `src/app/v1/messages/route.ts` | اندپوینت سازگار Anthropic | 271 | 10 KB |
| `providers.json` | رجیستری پروایدرها/مدل‌ها (منبع حقیقت) | 157 | 4 KB |
<!-- /GENERATED:stats -->

| File | Role |
|---|---|
| `providers.json` | **منبع حقیقت**: پروایدرها، آپستریم‌ها، گروه‌ها، مدل‌ها |
| `docs/providers.schema.json` | اسکیمای JSON رجیستری (اعتبارسنجی/راهنما در ویرایشگر) |
| `src/lib/catalog.ts` | لایهٔ ایزومورفیک: خواندن/نرمال‌سازی رجیستری، `resolveModel`، `buildUpstreamPayload`، `publicCatalog` |
| `src/lib/providers.ts` | خواندن زندهٔ رجیستری سمت سرور (hot reload + env toggles) |
| `src/lib/upstream.ts` | اتصال به آپستریم، هدرها، `OPEN_CORS`، لاگ رنگی |
| `src/lib/sse.ts` | پارسر جهان‌شمول: SSE سبک OpenAI/Claude، JSON، متن خام، reasoning |
| `src/lib/v1.ts` | لایهٔ سازگاری: `V1_CORS`، `SSE_HEADERS`، `flattenContent`، خطاها |
| `src/lib/markdown.ts` | رندر مارک‌داون امن بدون کتابخانه |
| `src/lib/apikeys.ts` | ساخت/لود `api-keys.json` + اعتبارسنجی کلید |
| `src/app/page.tsx` | کل UI چت نسخهٔ Next (سایدبار، پیکر مدل، کامپوزر، Raw SSE، تنظیمات) |
| `src/app/layout.tsx` | `lang=fa` · `dir=rtl` · فونت Vazirmatn · متادیتا |
| `src/app/globals.css` | استایل‌های اختصاصی (اسکرول‌بار، کرسر استریم، باکس تفکر، `md-*`) |
| `src/app/error.tsx` | مرز خطای فارسی |
| `app.js` | نسخهٔ تک‌فایل: رجیستری + سرور + `PAGE_CSS`/`PAGE_JS`/`PAGE_HTML` + لوگوهای base64 |
| `api-keys.json` | کلیدهای مشترک هر دو نسخه (`600`) |
| `public/*` | لوگوها و `robots.txt` (در `app.js` به‌صورت base64 جاسازی شده‌اند) |
| `scripts/*.mjs` | ابزارهای کیفیت: `verify` · `smoke` · `mock-upstream` · `dev-mock` · `docs-sync` · `sync-builtin` · `embed-logos` |
| `skills/*/SKILL.md` | دفترچهٔ عملیات هر نوع تغییر |
| `download/` | کپی اسناد + خروجی HTML/PDF + فونت‌ها (برای انتشار آفلاین) |

---

## 8. Features | قابلیت‌ها

### 8.1 Chat UI | رابط چت

- **چیدمان:** سایدبار راست 260px (چت جدید، لیست گفتگوها با حذف، خروجی
  Markdown/JSON، پاک‌کردن همه با confirm) + drawer موبایل؛ هدر با کنترل‌ها؛
  ناحیهٔ چت؛ کامپوزر چسبان.
- **پیکر مدل گروهی:** گروه‌ها از رجیستری می‌آیند (نه کد) — با آیکن، لوگوی
  20px گردگوشهٔ هر مدل، ردیف انتخاب‌شدهٔ تیره، اسکرول داخلی، تارگت لمسی 44px،
  بستن با کلیک بیرون و Esc.
- **کنترل‌های هدر:** تفکر (thinking) · جست‌وجوی عمیق (deepSearch) · استریم ·
  دکمهٔ «اتصال؟» با ping خودکار · پنل 📡 Raw SSE (با شمارندهٔ بایت) · مودال ⚙️
  شامل System Prompt و بخش «🔑 اندپوینت‌های API و کلیدها» · نشانگر وضعیت.
- **پیام‌ها:** اکشن‌های hover (کپی / ویرایش اینلاین پیام کاربر / حذف /
  بازتولید ↻)، باکس جمع‌شوندهٔ «💭 فرایند تفکر مدل»، آمار ⏱/🧩/✍️، نشان
  «⏹ متوقف شد»، حباب قرمز خطا.
- **استریم زنده:** flush با `requestAnimationFrame`، کرسر چشمک‌زن، ارسال ↔
  توقف (⏹ + Esc با AbortController) و destroy واقعی آپستریم.
- **حافظه:** `localStorage` با کلیدهای `fm_chats` و `fm_settings`؛ بارگذاری
  بعد از mount (بدون hydration mismatch)؛ صفحهٔ خوش‌آمد با ۴ پیشنهاد.
- **موبایل:** همبرگر، اکشن‌های همیشه‌مرئی، safe-area کامپوزر.

### 8.2 Markdown & Code | رندر مارک‌داون و کد

رندرر مارک‌داون **دست‌ساز و امن** است (بدون کتابخانه): اول escape کامل HTML،
بعد درج کنترل‌شدهٔ تگ‌ها. بلوک‌های کد با placeholder جدا می‌شوند و هدر زبان +
دکمهٔ کپی + هایلایت سینتکس ساده + `dir=ltr` دارند؛ کد اینلاین،
بولد/ایتالیک/خط‌خورده/لینک، هدینگ، لیست، نقل‌قول و خط افقی پشتیبانی می‌شوند.
منطق در `src/lib/markdown.ts` و `PAGE_JS` یکسان پیاده‌سازی شده است.

### 8.3 API Server | سرور API

<!-- GENERATED:endpoints -->
| مسیر | متدها (Next.js) | متدها (`app.js`) | احراز هویت | فایل (Next) |
|---|---|---|---|---|
| `/` | — | GET | بدون احراز هویت | — |
| `/<logo files>` | — | GET | — | — |
| `/api/chat` | OPTIONS, POST | POST | بدون احراز هویت | `src/app/api/chat/route.ts` |
| `/api/keys` | OPTIONS, GET | GET | بدون احراز هویت | `src/app/api/keys/route.ts` |
| `/api/models` | OPTIONS, GET | GET | بدون احراز هویت | `src/app/api/models/route.ts` |
| `/api/ping` | OPTIONS, GET | GET | بدون احراز هویت | `src/app/api/ping/route.ts` |
| `/v1/chat/completions` | OPTIONS, POST | POST | 🔑 کلید API | `src/app/v1/chat/completions/route.ts` |
| `/v1/messages` | OPTIONS, POST | POST | 🔑 کلید API | `src/app/v1/messages/route.ts` |
| `/v1/models` | OPTIONS, GET | GET | 🔑 کلید API | `src/app/v1/models/route.ts` |
<!-- /GENERATED:endpoints -->

> در نسخهٔ Next، مسیر `/` توسط `src/app/page.tsx` سرو می‌شود (نه `route.ts`)؛
> در `app.js` همان صفحه از `PAGE_HTML` ساخته می‌شود و لوگوهای جاسازی‌شده هم
> از همان فایل سرو می‌شوند. هر درخواست `OPTIONS` در هر دو نسخه `204` با CORS
> باز می‌گیرد.

---

## 9. Models | مدل‌ها

منبع فهرست مدل‌ها `providers.json` است؛ UI، `/v1/models` و هندلرهای چت همه از
همان می‌خوانند (در نسخهٔ تک‌فایل یک کپی اضطراریِ داخلی هم هست که با
`npm run sync:builtin` تازه می‌شود).

<!-- GENERATED:models -->
| Model ID | نام نمایشی | سازنده | گروه | پروایدر | `owned_by` | لوگو |
|---|---|---|---|---|---|---|
| `claude-sonnet-5` | Claude Sonnet 5 | Anthropic | Claude Pro | `freemodels` | `freemodels-anthropic` | `/Claude-ai-logo.webp` |
| `claude-fable-5` | Claude Fable 5 | Anthropic | Claude Pro | `freemodels` | `freemodels-anthropic` | `/Claude-ai-logo.webp` |
| `claude-fable-5.1` ⭐ **پیش‌فرض** | Claude Fable 5.1 | Anthropic | Claude Pro | `freemodels` | `freemodels-anthropic` | `/Claude-ai-logo.webp` |
| `gpt-5.6-sol` | GPT 5.6 Sol | OpenAI | ChatGPT Pro | `freemodels` | `freemodels-openai` | `/ChatGPT-Logo.svg.webp` |
| `gpt-5.6-terra` | GPT 5.6 Terra | OpenAI | ChatGPT Pro | `freemodels` | `freemodels-openai` | `/ChatGPT-Logo.svg.webp` |
| `glm-5.2` | GLM 5.2 | Z.AI | Other Pro Models | `freemodels` | `freemodels-z.ai` | `/zai.png` |
| `kimi-k3` | Kimi K3 | Moonshot AI | Other Pro Models | `freemodels` | `freemodels-moonshot-ai` | `/kimi-logo-png_seeklogo-611650.png` |
<!-- /GENERATED:models -->

**تطبیق نرمِ نام مدل** (`resolveModel`): ورودی trim و lowercase می‌شود،
فاصله/آندرلاین به خط‌تیره تبدیل می‌شود، `id`/`name`/`aliases` هر سه پذیرفته
می‌شوند — «Claude Fable 5.1»، «claude_fable 5.1» و «claude-fable-5.1» یکی‌اند.
ورودی خالی ← مدل پیش‌فرض؛ ورودی ناشناخته ← با **پروایدر پیش‌فرض** و همان id
نرمال‌شده عبور می‌کند. اگر آپستریم مدل را با نام دیگری می‌شناسد،
`upstreamId` را در رجیستری بگذارید.

---

## 10. API Reference | مرجع API

### 10.1 Authentication | احراز هویت و کلیدها

| Endpoint | Header |
|---|---|
| `/v1/models` · `/v1/chat/completions` | `Authorization: Bearer <key>` |
| `/v1/messages` | `x-api-key: <key>` (یا همان Bearer) + `anthropic-version` اختیاری |
| `/api/chat` · `/api/ping` · `/api/models` · `/api/keys` | بدون احراز هویت (اپ داخلی/محلی) |

**هر دو کلید روی هر دو اندپوینتِ `/v1` پذیرفته می‌شوند.**

<!-- GENERATED:keys -->
```json
{
  "openai":    "sk-ItqvFVBt8slw2vqxPuW9oLiSyGGgC29lNYeET64dIzJ04e50",
  "anthropic": "sk-ant-api03-9lamB2K7KoYT8fw8tAp2CKL5kKsOHKhN4mE9eawuzRuW0aU3umJirsEFbS3B6RCjLRw8lrJ0YRmsnxECIu3nHaKM"
}
```

> منبع: `api-keys.json` (ایجاد خودکار در اولین اجرا با دسترسی `600`) — خلاصه: OpenAI `sk-ItqvF…4e50` · Anthropic `sk-ant-a…HaKM`
<!-- /GENERATED:keys -->

### 10.2 `GET /api/ping` — Health Check

یک درخواست سبک `stream:false` با پیام `ping` به **پروایدرِ همان مدل** می‌فرستد
(`?model=` اختیاری؛ پیش‌فرض: مدل پیش‌فرض) و برمی‌گرداند:

```json
{ "status": "ok", "ms": 2635, "sample": "…۲۰۰ کاراکتر اول پاسخ یا پیام خطا…",
  "provider": "freemodels", "model": "claude-fable-5.1" }
```

### 10.3 `POST /api/chat` — Internal Proxy (برای UI)

بدنه: `{"messages":[{role,content}…], "modelId":"claude-fable-5.1", "thinking":false, "deepSearch":false, "stream":true}`
پاسخ: عبور مستقیمِ استریم SSE آپستریم. خطاها: `413` بدنه بزرگ‌تر از
`maxBodyBytes` · `502` خطای اتصال · `504` تایم‌اوت.

### 10.4 `GET /api/models` — کاتالوگ زندهٔ عمومی

فهرست مدل‌ها/گروه‌ها برای UI، **بدون** نشت اطلاعات آپستریم (URL/هدر/auth
برنمی‌گردد):

```json
{ "models": [ { "id": "claude-fable-5.1", "name": "Claude Fable 5.1", "vendor": "Anthropic",
                "group": "Claude Pro", "logo": "/Claude-ai-logo.webp", "providerId": "freemodels" } ],
  "groups": [ { "title": "Claude Pro", "icon": "sparkles" } ],
  "defaultModel": "claude-fable-5.1" }
```

### 10.5 `GET /api/keys` — کلیدهای API

`{"openai":"sk-…","anthropic":"sk-ant-api03-…"}` — برای نمایش در مودال ⚙️
تنظیمات (اپ محلی/شخصی است). در `app.js` همین داده داخل `window.__FM__` هم
تزریق می‌شود.

### 10.6 `GET /v1/models` — List Models (OpenAI format)

```bash
curl -s http://localhost:3000/v1/models -H "Authorization: Bearer <openai-key>"
```

```json
{ "object": "list", "data": [
  { "id": "claude-fable-5.1", "object": "model", "created": 1789321278,
    "owned_by": "freemodels-anthropic" }
] }
```

- `owned_by` = `<ownedByPrefix>-<vendor-slug>` از رجیستری.
- `created` = زمان بالا آمدن سرور (ثابت در طول اجرا).
- فیلدهای غیراستاندارد عمداً در حالت عادی برنمی‌گردند تا سازگاری OpenAI حفظ
  شود؛ با **`?extra=1`** فیلدهای `group`/`vendor`/`logo`/`provider` هم اضافه
  می‌شوند.
- بدون کلید ← `401 invalid_api_key`.

### 10.7 `POST /v1/chat/completions` — OpenAI Compatible

- فیلدها: `model` (خالی ← پیش‌فرض)، `messages` (اجباری؛ نقش ناشناخته ← user)،
  `stream`، `stream_options.include_usage`، و دو **اکستنشن غیراستاندارد**:
  `thinking` و `deep_search`.
- **غیراستریم:** آبجکت `chat.completion` با `choices[].message.content` و
  `usage` تخمینی (~۴ نویسه = ۱ توکن) — مگر آپستریم usage واقعی بدهد.
- **استریم:** چانک نقش → چانک‌های delta (`content` و در صورت وجود
  `reasoning_content`) → چانک `finish_reason:"stop"` → چانک usage (در صورت
  `include_usage`) → `data: [DONE]`.
- خطای داخل استریم به‌صورت چانک متنی «⚠️ …» منتشر می‌شود؛ خطای HTTP آپستریم
  با همان کد و فرمت OpenAI برمی‌گردد.

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer <openai-key>" -H "Content-Type: application/json" \
  -d '{"model":"claude-fable-5.1","messages":[{"role":"user","content":"سلام"}],"stream":true}'
```

### 10.8 `POST /v1/messages` — Anthropic Compatible

- `model` و `max_tokens` **اجباری‌اند** (نبود ← `400 invalid_request_error` با
  پیام `model: Field required` / `max_tokens: Field required`).
- `system` به‌صورت رشته یا آرایهٔ بلوک پذیرفته می‌شود؛ برای آپستریمِ سبک
  freemodels به اولین پیام تبدیل می‌شود و برای آپستریمِ سبک Anthropic فیلد
  `system` می‌ماند (طبق `request.fields` همان پروایدر).
- **غیراستریم:** آبجکت `message` با بلوک‌های `{type:"thinking"}` (در صورت
  وجود) و `{type:"text"}` + `stop_reason:"end_turn"` + `usage`.
- **استریم:** `message_start` → `ping` → (`content_block_start` +
  `content_block_delta` با `thinking_delta`/`text_delta` + `content_block_stop`)*
  → `message_delta` → `message_stop`.

```bash
curl -N http://localhost:3000/v1/messages \
  -H "x-api-key: <anthropic-key>" -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-fable-5.1","max_tokens":1024,"stream":true,"messages":[{"role":"user","content":"سلام"}]}'
```

### 10.9 Error Formats | فرمت خطاها

| Source | Shape |
|---|---|
| OpenAI-style | `{"error":{"message":"…","type":"invalid_request_error\|api_error","param":null,"code":"invalid_api_key"}}` |
| Anthropic-style | `{"type":"error","error":{"type":"authentication_error\|invalid_request_error\|rate_limit_error\|api_error","message":"…"}}` |
| Mapping | اتصال ناموفق ← `502` · تایم‌اوت ← `504` · خطای آپستریم ← همان کد (۴۲۹ ← `rate_limit_error` در سبک Anthropic) · بدنهٔ بزرگ ← `413` |

---

## 11. Testing & Quality | آزمون و کیفیت

```bash
npm run verify     # ساختار رجیستری + اسکیمای JSON + همگامی دو نسخه + سلامت سند
npm run smoke      # ۳۰ آزمون رفتاری end-to-end (بدون اینترنت)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run verify:full # همهٔ بالا با هم
```

`npm run verify` اینها را می‌سنجد: اعتبار `providers.json` (با
`docs/providers.schema.json`)، یکتایی idها، مجازبودن `shape`، نبودِ کلیدِ
لفظی در رجیستری، سلامت سینتکس `app.js` **و** بلوک `PAGE_JS` (استخراج و
`node --check` جداگانه)، نبودِ توکن‌های ممنوعهٔ `String.raw`، برابری
`BUILTIN_PROVIDERS` با `providers.json`، هم‌خوانی `MODELS_FALLBACK`، وجود همهٔ
مسیرها در روتر، برابری نام آیکن‌ها در دو نسخه، نبودِ لیست موازیِ مدل‌ها در
`src/`، به‌روزبودن بلوک‌های GENERATED، همگامی `download/`، سلامت رمزگذاری
اسناد، و معتبربودن مسیرها/فرمان‌ها/پیوندهای داخل مستندات و مهارت‌ها.

`npm run smoke` با یک آپستریم ساختگی اینها را آزمودن می‌کند: صفحه و CORS و
۴۰۴، احراز هویت و خطاهای ۴۰۱/۴۰۰، `/v1/models` (+`?extra=1`)، `/api/models`
و عدم نشت اطلاعات آپستریم، شکلِ بدنهٔ ارسالی برای هر `shape`، استریم OpenAI
(نقش/delta/`finish_reason`/usage/`[DONE]`)، تفکر جدا (`reasoning_content` و
بلوک `thinking` در Anthropic)، پاسخ سبک Claude، فیلدهای سفارشی
`textFields/reasoningFields`، `upstreamId` و `aliases`، نگاشت خطای ۴۲۹ در هر
دو سبک، پروکسی `/api/chat`، hot reload رجیستری بدون restart، و `413`.

---

## 12. Troubleshooting | عیب‌یابی سریع

| علامت | اولین اقدام |
|---|---|
| پاسخ نمی‌آید / `502` | `curl -s "localhost:3000/api/ping?model=<id>"` → `sample` و `provider` را بخوانید |
| استریم یک‌جا می‌آید | هدر `Accept-Encoding: identity` در رجیستری + `X-Accel-Buffering: no` |
| متن خالی ولی `200` | `response.textFields` را برای آن آپستریم تنظیم کنید |
| تفکر با متن قاطی است | `response.reasoningFields` |
| `403`/HTML از آپستریم | هدرهای مرورگر‌نما (`Origin`/`Referer`/`User-Agent`/`sec-*`) |
| مدل جدید در UI نیست | صفحه را refresh کنید؛ `GET /api/models` را چک کنید؛ `npm run sync:builtin` |
| `401 invalid_api_key` | `GET /api/keys` یا `api-keys.json`؛ override با env را بررسی کنید |
| در سندباکس/بدون اینترنت همه‌چیز `502` | `npm run dev:mock` و `npm run smoke` |

راهنمای کامل (جدول علامت ← علت ← راه‌حل، دستورهای curl، ابزار mock):
**`skills/debug-stream/SKILL.md`**.

---

## 13. Development History | تاریخچهٔ توسعه

| # | Task | خروجی کلیدی |
|---|---|---|
| 1 | بک‌اند پروکسی `/api/chat` + `/api/ping` + کتابخانه‌های مشترک | تصمیم `node:https` به‌جای fetch برای ارسال واقعی Origin/Referer |
| 2 | فرانت‌اند کامل RTL فارسی (`page.tsx` + `layout.tsx` + `globals.css` + `error.tsx`) | UI تم تاریک با استریم زنده و حافظهٔ localStorage |
| 3 | تأیید end-to-end با مرورگر headless | استریم ۲۸۶ تکه/۱۹ ثانیه؛ توقف/بازتولید/ویرایش/خروجی/موبایل ✓ |
| 4 | نسخهٔ تک‌فایل `app.js` (پورت کامل منطق، بدون پکیج) | رعایت قیود `PAGE_JS` (بدون backtick/`${`) |
| 5 | تأیید مستقل `app.js` | تست مسیرها + `413` + eslint ignore |
| 6 | ۷ مدل + کلیدهای API + سه اندپوینت سازگار OpenAI/Anthropic در هر دو نسخه | `/v1/*`، `api-keys.json`، مودال 🔑 |
| 7 | بازیابی ورک‌اسپیس + پیکر مدل گروهی مطابق سایت freemodels | ۴ لوگوی واقعی، ۳ گروه، رفع z-index، embed base64 |
| 8 | **معماری رجیستری‌محور + مهارت‌ها + ابزار کیفیت** | `providers.json` + `docs/providers.schema.json`، `catalog.ts`/`providers.ts`، hot reload، `GET /api/models`، `scripts/{verify,smoke,mock-upstream,dev-mock,docs-sync,sync-builtin,embed-logos}.mjs`، پوشهٔ `skills/`، رفع باگ `finish_reason` در استریم OpenAI، پشتیبانی `HOST` در `app.js` |

جزئیات تسک‌به‌تسک در `worklog.md`.

---

## 14. Known Issues & Roadmap | مشکلات شناخته‌شده و نقشهٔ راه

### 14.1 Known Issues

1. **۴۲۹ موقت آپستریم رایگان** («providers exhausted»): رفتار سرویس است، نه
   باگ. هر دو نسخه آن را شفاف به حباب قرمز (UI) یا کد/فرمت استاندارد (API)
   تبدیل می‌کنند؛ retry بعد از چند ثانیه معمولاً موفق است. راه‌حل ساختاری:
   افزودن پروایدر دوم در رجیستری.
2. **`usage` تخمینی است** (~۴ نویسه = ۱ توکن) مگر آپستریم usage واقعی بدهد.
3. **فونت Vazirmatn در نسخهٔ Next از Google Fonts لود می‌شود**؛ در محیط بدون
   اینترنت با فونت جایگزین رندر می‌شود (نسخهٔ `app.js` لوگوها را embed دارد).
4. **قالب Prisma/`src/lib/db.ts` از تمپلیت باقی مانده** و منطق چت از آن
   استفاده نمی‌کند (`DATABASE_URL` در `.env` کهنه است).
5. **`package-lock.json` در `.gitignore` است** — قفلِ رسمی ریپو `bun.lock`
   است؛ اگر با npm نصب کردید، lockfile تولیدشده commit نمی‌شود.

### 14.2 Roadmap

- **انتخاب خودکار پروایدر جایگزین هنگام ۴۲۹/خطا** (fallback زنجیره‌ای در
  رجیستری: `fallbackProvider`).
- **Retry با backoff** در لایهٔ پروکسی.
- **پروفایل‌های پاسخ بیشتر** (`response.profile`) برای آپستریم‌های کاملاً
  غیراستاندارد (WebSocket/gRPC).
- **UI مدیریت رجیستری** (افزودن پروایدر/مدل از داخل صفحه به‌جای ویرایش JSON).
- **استقرار پروداکشن:** `bun run build` پشت reverse proxy با
  `X-Accel-Buffering: no`، یا `HOST=0.0.0.0 node app.js` با systemd/pm2.
- **چندکاربره‌سازی (اختیاری):** محدودسازی نرخ و احراز هویت برای `/api/chat`
  اگر اپ عمومی شود.

---

## Appendix A — English Quick Reference

**What it is:** a Persian RTL chat UI plus an OpenAI/Anthropic-compatible API
server that proxies one or more upstream chat providers. Two parallel builds
with identical behaviour: a Next.js 16 app (`src/`) and a dependency-free
single file (`app.js`, run with `node app.js`).

**Configuration:** every provider, upstream endpoint, header set, auth scheme,
request/response mapping, UI group and model lives in `providers.json`
(schema: `docs/providers.schema.json`). Both builds read it at runtime with hot
reload, so adding a model or a whole new upstream site needs no code changes.

**Available models:**

<!-- GENERATED:models-en -->
| Model ID | Display Name | Vendor | Group | Provider | `owned_by` |
|---|---|---|---|---|---|
| `claude-sonnet-5` | Claude Sonnet 5 | Anthropic | Claude Pro | `freemodels` | `freemodels-anthropic` |
| `claude-fable-5` | Claude Fable 5 | Anthropic | Claude Pro | `freemodels` | `freemodels-anthropic` |
| `claude-fable-5.1` ⭐ default | Claude Fable 5.1 | Anthropic | Claude Pro | `freemodels` | `freemodels-anthropic` |
| `gpt-5.6-sol` | GPT 5.6 Sol | OpenAI | ChatGPT Pro | `freemodels` | `freemodels-openai` |
| `gpt-5.6-terra` | GPT 5.6 Terra | OpenAI | ChatGPT Pro | `freemodels` | `freemodels-openai` |
| `glm-5.2` | GLM 5.2 | Z.AI | Other Pro Models | `freemodels` | `freemodels-z.ai` |
| `kimi-k3` | Kimi K3 | Moonshot AI | Other Pro Models | `freemodels` | `freemodels-moonshot-ai` |
<!-- /GENERATED:models-en -->

**Endpoints:** `GET /` (chat UI) · `POST /api/chat` (UI proxy) ·
`GET /api/models` (public catalog) · `GET /api/keys` · `GET /api/ping` ·
`GET /v1/models` (+`?extra=1`) · `POST /v1/chat/completions` (OpenAI) ·
`POST /v1/messages` (Anthropic). All `OPTIONS` requests return `204` with open
CORS. `/v1/*` requires an API key (either key works on either endpoint).

**Quality gates:** `npm run verify` (structure & cross-build parity) ·
`npm run smoke` (30 end-to-end tests against a mock upstream) ·
`npm run typecheck` · `npm run lint`. Offline development:
`npm run dev:mock`.

**Playbooks:** `skills/` — `add-model`, `add-provider`, `add-feature`,
`edit-appjs`, `debug-stream`, `update-docs`.
