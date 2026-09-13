# چت هوشمند — Smart Chat · Project Documentation

> **مستندات کامل پروژه | Full Project Documentation** — نسخه ۱.۰ · ۱۴ سپتامبر ۲۰۲۶ (۲۳ شهریور ۱۴۰۵)
> ساختار انگلیسی + توضیحات فارسی · English structure + Persian body

| Item | Value |
|---|---|
| **Project Name** | چت هوشمند (Smart Chat) |
| **Stack** | Next.js 16 · React 19 · Tailwind CSS 4 · TypeScript + نسخهٔ تک‌فایل Node خالص (`app.js`) |
| **Purpose** | Chat UI فارسی RTL متصل به سرویس رایگان freemodels + سرور API سازگار با OpenAI و Anthropic |
| **Entry Points** | `src/app/page.tsx` (Next.js) · `app.js` (standalone) |
| **Config Files** | `api-keys.json` · `package.json` · `next.config.ts` |
| **Docs** | `README.md` (همین فایل) · `HANDOFF.md` (سند تحویل) · `worklog.md` (گزارش روزانه تسک‌ها) |

---

## 1. Overview | معرفی پروژه

این پروژه یک اپلیکیشن چت هوشمند کامل است که با هدف کار با سرویس رایگان **freemodels** ساخته شده است. رابط کاربری دقیقاً به سبک ابزارهای مدرن چت AI طراحی شده — تم تاریک، چیدمان راست‌به‌چپ فارسی، فونت Vazirmatn، پیکر مدل گروهی با لوگوی واقعی ارائه‌دهنده‌ها — و پاسخ‌ها به‌صورت زنده (streaming) با نمایش فرایند تفکر مدل (reasoning) رندر می‌شوند. پروژه در قالب **دو نسخهٔ موازی** تحویل داده شده است که هر دو از یک آپستریم مشترک استفاده می‌کنند و رفتار یکسانی دارند:

1. **نسخهٔ Next.js** — اپ کامل React با Tailwind 4 و کامپوننت‌های client-side؛ مناسب توسعهٔ آینده، پیش‌نمایش زنده و استقرار استاندارد.
2. **نسخهٔ تک‌فایل `app.js`** — یک فایل CommonJS خالص Node (بدون هیچ وابستگی خارجی) که سرور HTTP، پروکسی، API سازگار OpenAI/Anthropic و کل UI را در قالب HTML رشته‌ای داخل همان فایل سرو می‌کند؛ مناسب اجرای سریع روی هر ماشین با `node app.js` بدون `npm install`.

هر دو نسخه علاوه بر رابط چت، یک **API کامل سازگار با OpenAI و Anthropic** نیز ارائه می‌دهند (`/v1/models`، `/v1/chat/completions`، `/v1/messages`) تا بتوان از هر کلاینت استانداردی (SDK رسمی، curl، ابزارهای شخص ثالث) به مدل‌های سرویس دسترسی داشت. احراز هویت با کلیدهای سبک OpenAI و Anthropic انجام می‌شود که به‌صورت خودکار ساخته و در `api-keys.json` ذخیره می‌گردند.

## 2. System Requirements | پیش‌نیازهای سیستم

| Requirement | Next.js Version | Single-File (`app.js`) |
|---|---|---|
| **Runtime** | Node.js ≥ 20 (توصیه: ۲۴) یا Bun ≥ 1.3 | Node.js ≥ 18 (ماژول‌های داخلی `http`/`https`/`fs`/`crypto`) |
| **Package Manager** | `bun` (توسعه‌شده و تست‌شده با bun 1.3.14) یا npm | **هیچ** — بدون نصب پکیج اجرا می‌شود |
| **Disk** | ~600MB (node_modules) | ~120KB (فقط app.js + api-keys.json) |
| **Network** | دسترسی به `freemodels-chat.freemodels.workers.dev` و `fonts.googleapis.com` | فقط آپستریم (فونت‌ها base64/embed هستند) |
| **OS** | هر سیستم‌عامل دارای Node (Linux/macOS/Windows) | همان |
| **Ports** | 3000 (قابل تغییر با `-p`) | 3000 پیش‌فرض · `PORT=xxxx` env |

نکته: نسخهٔ تک‌فایل عمداً به‌جای `fetch` از `node:https` استفاده می‌کند تا بتواند هدرهای `Origin` و `Referer` (که در fetch استاندارد ممنوع‌اند) را واقعاً ارسال کند؛ بنابراین روی هر Node ≥ 18 بدون هیچ پیش‌نیاز دیگری کار می‌کند.

## 3. Installation & Run | نصب و اجرا

### 3.1 Next.js Version

```bash
# نصب وابستگی‌ها (bun) — یا معادل npm/pnpm
bun install

# اجرای محیط توسعه روی پورت 3000 (لاگ در dev.log)
bun run dev            # → http://localhost:3000

# بیلد پروداکشن (standalone) و اجرا
bun run build
bun run start          # bun .next/standalone/server.js روی پورت 3000
```

### 3.2 Single-File Version (app.js)

```bash
node app.js            # پورت 3000
PORT=8080 node app.js  # پورت دلخواه
node --check app.js    # بررسی صحت سینتکس (قبل از هر استقرار اجرا شود)
```

### 3.3 Environment Variables | متغیرهای محیطی

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | پورت سرور (فقط نسخهٔ app.js) |
| `OPENAI_API_KEY` | مقدار `api-keys.json` | override کلید سبک OpenAI |
| `ANTHROPIC_API_KEY` | مقدار `api-keys.json` | override کلید سبک Anthropic |

### 3.4 First-Run Behavior | رفتار اولین اجرا

در اولین اجرا (هر دو نسخه) اگر `api-keys.json` وجود نداشته باشد، دو کلید جدید ساخته و کنار پروژه ذخیره می‌شود (permission `600`). اگر فایل موجود باشد همان کلیدها لود می‌شوند و **هر دو نسخه دقیقاً همان کلیدها را می‌پذیرند**. نسخهٔ Next.js همان فایل را از طریق `src/lib/apikeys.ts` (با کش در حافظه) می‌خواند.

## 4. Architecture | معماری

### 4.1 Request Flow | جریان درخواست

```
┌───────────────────────────── Browser ─────────────────────────────┐
│  page.tsx / HTML داخلی app.js   (RTL فارسی، تم تاریک #0b1220)      │
│  پیکر مدل · تفکر · جست‌وجوی عمیق · استریم · Raw SSE · سایدبار       │
└───────┬───────────────────────────────────────────────────┬───────┘
        │ POST /api/chat {messages, modelId, thinking,      │ GET /api/ping
        │  deepSearch, stream}                              │
┌───────▼─────────────────────── Server ───────────┬────────▼───────┐
│  Next.js route handlers  |  app.js handlers      │                │
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

### 4.2 Upstream Connection | اتصال آپستریم

- **URL آپستریم:** `https://freemodels-chat.freemodels.workers.dev/` (ثابت در `src/lib/upstream.ts` و معادلش در app.js).
- **جعل هدرهای مرورگر:** `Origin: https://freemodels.pro`، `Referer: https://freemodels.pro/`، UA کروم ویندوزی، `sec-ch-*` و `sec-fetch-*` کامل، و `Accept-Encoding: identity` تا پاسخ فشرده نباشد و pipe مستقیم بدون decompress ممکن شود.
- **چرا `node:https`؟** مرورگرهای مدرن و `fetch` ارسال `Origin`/`Referer` دستی را ممنوع می‌کنند؛ برای عبور از CORS آپستریم باید این هدرها واقعاً روی سیم برود. نتیجهٔ این تصمیم در Task 1 گرفته شد و در هر دو نسخه رعایت شده است.
- **پایداری استریم:** پاسخ با `pipe` تکه‌به‌تکه (بدون تجمیع بافر) به کلاینت رد می‌شود؛ `Cache-Control: no-cache, no-transform` و `X-Accel-Buffering: no` روی پاسخ ست می‌شود تا پروکسی‌های میانی بافر نکنند. قطع کلاینت → `destroy` فوری آپستریم.

### 4.3 File Map | نقشهٔ فایل‌ها

| File | Role |
|---|---|
| `src/app/page.tsx` | کل UI چت (client component ~۹۰۰ خط): سایدبار، هدر، پیکر مدل گروهی، کامپوزر، پیام‌ها، مودال تنظیمات، Raw SSE |
| `src/app/layout.tsx` | `lang=fa` · `dir=rtl` · فونت Vazirmatn (لینک مستقیم Google Fonts) · متادیتا |
| `src/app/globals.css` | استایل‌های اختصاصی: اسکرول‌بار، کرسر چشمک‌زن استریم، توکن‌های هایلایت کد، باکس تفکر، استایل‌های md-* |
| `src/app/error.tsx` | مرز خطای فارسی (جلوگیری از کرش کل صفحه) |
| `src/lib/upstream.ts` | ثابت‌های آپستریم + هدرهای جعلی + `openUpstream` (node:https, timeout 180s) + لاگ رنگی + CORS باز |
| `src/lib/sse.ts` | پارسر جهانی SSE آپستریم: سبک OpenAI delta، فیلدهای مستقیم content/text، reasoning_content/reasoning/thinking، آبجکت بدون `data:`، `[DONE]`، خطای داخل استریم، تجمیع JSON چندخطی ناقص |
| `src/lib/markdown.ts` | رندر مارک‌داون امن بدون کتابخانه: escape کامل قبل از درج، بلوک کد با placeholder + هایلایت ساده + دکمه کپی، بولد/ایتالیک/لینک/هدینگ/لیست/نقل‌قول، کرسر چشمک‌زن |
| `src/lib/models.ts` | `FM_MODELS` (۷ مدل + گروه) + `DEFAULT_MODEL_ID` + `resolveModelId` (تطبیق نرم نام مدل) — منبع واحد UI و اندپوینت‌های /v1 |
| `src/lib/apikeys.ts` | ساخت/لود `api-keys.json` (سقف ۵MB ناپذیر…)، اعتبارسنجی، `bearerFrom` |
| `src/lib/v1.ts` | `V1_CORS` · `SSE_HEADERS` · `flattenContent` (بلوک→متن) · `readAll` (سقف ۸MB) · `estTokens` |
| `src/app/api/chat/route.ts` | پروکسی استریم چت (بدون احراز هویت — اپ داخلی) |
| `src/app/api/ping/route.ts` | تست اتصال سبک آپستریم → `{status, ms, sample}` |
| `src/app/api/keys/route.ts` | کلیدها برای مودال ⚙️ تنظیمات |
| `src/app/v1/models/route.ts` | `GET /v1/models` فرمت OpenAI (نیاز به کلید) |
| `src/app/v1/chat/completions/route.ts` | `POST /v1/chat/completions` سازگار OpenAI (استریم/غیراستریم) |
| `src/app/v1/messages/route.ts` | `POST /v1/messages` سازگار Anthropic (model/max_tokens اجباری) |
| `app.js` | نسخهٔ تک‌فایل (3082 خط / ~120KB): `PAGE_CSS` + `PAGE_JS` + `PAGE_HTML` (UI) + هندلرهای همان ۶ مسیر + بنر رنگی — بدون هیچ پکیج |
| `api-keys.json` | کلیدهای مشترک هر دو نسخه (permission 600) |
| `public/*.webp,*.png` | ۴ لوگوی واقعی ارائه‌دهنده (Claude، ChatGPT، Z.AI، Kimi) — در app.js به‌صورت base64 داخل `EMBEDDED_LOGOS` هم embed شده‌اند |
| `scripts/embed_logos.py` | ابزار بازتولید بلوک `EMBEDDED_LOGOS` (بهینه‌سازی ۹۶px + base64) |
| `worklog.md` | گزارش کارِ تسک‌به‌تسک (منبع تاریخ بخش ۹) |
| `eslint.config.mjs` | `app.js` در ignores است (فایل مستقل CommonJS جزو بیلد Next نیست) |

## 5. Features | قابلیت‌ها

### 5.1 Chat UI | رابط چت
- **چیدمان:** سایدبار راست 260px (چت جدید، لیست گفتگوها با حذف، خروجی Markdown/JSON، پاک‌کردن همه با confirm) + drawer موبایل؛ هدر با کنترل‌ها؛ ناحیهٔ چت؛ کامپوزر چسبان.
- **پیکر مدل گروهی** (مطابق HTML واقعی سایت freemodels): سه گروه «Claude Pro / ChatGPT Pro / Other Pro Models» با آیکن‌های lucide، لوگوی 20px گردگوشهٔ هر مدل، ردیف انتخاب‌شدهٔ تیره `#0A0A0B` با تیک، hover `#FFFBF5`، اسکرول داخلی `max-h: min(55dvh,320px)`، تارگت لمسی 44px در موبایل، بستن با کلیک بیرون و Esc، لنگر `right-0` فیزیکی (باز شدن روی چت نه زیر سایدبار).
- **کنترل‌های هدر:** تفکر (thinking) · جست‌وجوی عمیق (deepSearch) · استریم · دکمهٔ «اتصال؟» با ping خودکار · پنل Raw SSE (80KB، ltr، mono) · مودال ⚙️ شامل System Prompt و بخش «🔑 اندپوینت‌های API و کلیدها» (نمایش کلیدها + کپی + نمونه curl) · نشانگر وضعیت سبز/زرد/قرمز.
- **پیام‌ها:** اکشن‌های hover (کپی / ویرایش اینلاین پیام کاربر با حذف پیام‌های بعدی / حذف / بازتولید ↻)، باکس جمع‌شوندهٔ «💭 فرایند تفکر مدل»، آمار ⏱ زمان / 🧩 تکه‌ها / ✍️ نویسه‌ها، نشان «⏹ متوقف شد»، حباب قرمز خطا (مثلاً «❌ HTTP 429 — …»).
- **استریم زنده:** flush با `requestAnimationFrame` (حداکثر یک رندر در فریم)، کرسر چشمک‌زن، دکمهٔ ارسال ↔ توقف (⏹ + Esc با AbortController) و destroy واقعی آپستریم.
- **کامپوزر:** textarea خودبزرگ‌شونده، Enter ارسال، Shift+Enter خط جدید.
- **حافظه:** `localStorage` با کلیدهای `fm_chats` و `fm_settings` (عنوان چت = ۴۰ کاراکتر اول پیام)؛ بارگذاری بعد از mount برای جلوگیری از hydration mismatch؛ صفحهٔ خوش‌آمد با ۴ پیشنهاد وقتی چت خالی است.
- **موبایل:** همبرگر، اکشن‌های همیشه‌مریی، safe-area کامپوزر، تست‌شده در 390px.

### 5.2 Markdown & Code | رندر مارک‌داون و کد
رندرر مارک‌داون **دست‌ساز و امن** است (بدون کتابخانه): ابتدا escape کامل HTML، سپس درج کنترل‌شدهٔ تگ‌ها. بلوک‌های کد با placeholder جداسازی می‌شوند و هدر زبان + دکمهٔ «کپی» (بازخورد «کپی شد ✓») + هایلایت سینتکس ساده (کلیدواژه/رشته/عدد/کامنت) + `dir=ltr` دارند؛ کد اینلاین، بولد/ایتالیک/خط‌خورده/لینک (`target=_blank`)، هدینگ‌ها، لیست‌ها، نقل‌قول و خط افقی هم پشتیبانی می‌شوند. این منطق در `src/lib/markdown.ts` و معادلش در `PAGE_JS` یکسان پیاده‌سازی شده است.

### 5.3 API Server | سرور API
هر دو نسخه سه اندپوینت استاندارد + دو مسیر داخلی را سرو می‌کنند (جزئیات کامل در بخش ۷): لیست مدل‌ها، چت‌کامپلیشن OpenAI و پیام‌های Anthropic — همه با CORS باز شامل هدرهای احراز هویت، و خطاها دقیقاً در فرمت JSON همان API مقصد (`error.message/type/code` برای OpenAI، `error.type/message` برای Anthropic).

## 6. Models | مدل‌ها

منبع واحد لیست مدل‌ها `src/lib/models.ts` (Next) و ثابت `FM_MODELS` (app.js) است؛ هم پیکر UI و هم اندپوینت‌های `/v1` از همین می‌خوانند، پس همیشه همگام‌اند. مدل پیش‌فرض: **`claude-fable-5.1`**.

| Model ID | Display Name | Vendor | Group |
|---|---|---|---|
| `claude-sonnet-5` | Claude Sonnet 5 | Anthropic | Claude Pro |
| `claude-fable-5` | Claude Fable 5 | Anthropic | Claude Pro |
| `claude-fable-5.1` | Claude Fable 5.1 ⭐ پیش‌فرض | Anthropic | Claude Pro |
| `gpt-5.6-sol` | GPT 5.6 Sol | OpenAI | ChatGPT Pro |
| `gpt-5.6-terra` | GPT 5.6 Terra | OpenAI | ChatGPT Pro |
| `glm-5.2` | GLM 5.2 | Z.AI | Other Pro Models |
| `kimi-k3` | Kimi K3 | Moonshot AI | Other Pro Models |

**تطبیق نرم نام مدل** (`resolveModelId`): ورودی trim و lowercase شده، فاصله/آندرلاین به خط تیره تبدیل می‌شود و نام نمایشی هم پذیرفته است — «Claude Fable 5.1»، «claude_fable 5.1» و «claude-fable-5.1» هر سه به یک id نرمال می‌شوند. ورودی ناشناخته دست‌نخورده عبور می‌کند (رفتار آپستریم تعیین‌کننده است) و ورودی خالی → مدل پیش‌فرض.

## 7. API Reference | مرجع API

### 7.1 Authentication | احراز هویت

| Endpoint | Header |
|---|---|
| `/v1/models` · `/v1/chat/completions` | `Authorization: Bearer <key>` |
| `/v1/messages` | `x-api-key: <key>` (یا همان Bearer) + `anthropic-version` اختیاری |
| `/api/chat` · `/api/ping` | بدون احراز هویت (اپ داخلی) |

**هر دو کلید روی هر دو اندپوینت پذیرفته می‌شوند.** کلیدهای فعلی (از `api-keys.json`):

```json
{
  "openai":    "sk-ItqvFVBt8slw2vqxPuW9oLiSyGGgC29lNYeET64dIzJ04e50",
  "anthropic": "sk-ant-api03-9lamB2K7KoYT8fw8tAp2CKL5kKsOHKhN4mE9eawuzRuW0aU3umJirsEFbS3B6RCjLRw8lrJ0YRmsnxECIu3nHaKM"
}
```

### 7.2 `GET /api/ping` — Health Check
درخواست سبک `stream:false` با پیام `ping` به آپستریم می‌فرستد (تایم‌اوت ۲۰ ثانیه) و برمی‌گرداند:

```json
{ "status": "ok", "ms": 2635, "sample": "…200 کاراکتر اول پاسخ یا پیام خطای آپستریم…" }
```

### 7.3 `POST /api/chat` — Internal Proxy
بدنه: `{"messages":[{role,content}...], "modelId":"claude-fable-5.1", "thinking":false, "deepSearch":false, "stream":true}` — پاسخ: عبور مستقیم استریم SSE آپستریم (سبک OpenAI با `delta.reasoning_content`/`delta.content`). خطاها: `413` حجم > 5MB · `502` خطای اتصال · `504` تایم‌اوت ۱۸۰ ثانیه.

### 7.4 `GET /v1/models` — List Models (OpenAI format)

```bash
curl -s http://localhost:3000/v1/models \
  -H "Authorization: Bearer sk-ItqvFVBt8slw2vqxPuW9oLiSyGGgC29lNYeET64dIzJ04e50"
```

```json
{ "object": "list", "data": [
  { "id": "claude-sonnet-5", "object": "model", "created": 1789321278, "owned_by": "freemodels-anthropic" },
  { "id": "claude-fable-5",  "object": "model", "created": 1789321278, "owned_by": "freemodels-anthropic" },
  { "id": "claude-fable-5.1","object": "model", "created": 1789321278, "owned_by": "freemodels-anthropic" },
  { "id": "gpt-5.6-sol",     "object": "model", "created": 1789321278, "owned_by": "freemodels-openai" },
  { "id": "gpt-5.6-terra",   "object": "model", "created": 1789321278, "owned_by": "freemodels-openai" },
  { "id": "glm-5.2",         "object": "model", "created": 1789321278, "owned_by": "freemodels-z.ai" },
  { "id": "kimi-k3",         "object": "model", "created": 1789321278, "owned_by": "freemodels-moonshot-ai" }
] }
```

> فیلدهای `group`/لوگو عمداً در پاسخ نیستند تا فرمت استاندارد OpenAI حفظ شود؛ آن‌ها فقط برای UI هستند. بدون کلید → `401 invalid_api_key`.

### 7.5 `POST /v1/chat/completions` — OpenAI Compatible

- فیلدها: `model` (نرمال نرم می‌شود؛ خالی → پیش‌فرض)، `messages` (اجباری، نقش‌های ناشناخته → user)، `stream` (boolean)، `stream_options.include_usage`، و دو **اکستنشن غیراستاندارد**: `thinking` و `deep_search` (boolean).
- **غیراستریم:** آبجکت کامل `chat.completion` با `choices[].message.content` و `usage` تخمینی (~۴ نویسه = ۱ توکن).
- **استریم:** چانک اول نقش (`{role:"assistant",content:""}`) → چانک‌های delta (`content` و در صورت وجود، `reasoning_content`) → چانک `finish_reason:"stop"` → (در صورت include_usage، چانک usage) → `data: [DONE]`.
- خطای داخل استریم آپستریم به‌صورت چانک متنی «⚠️ …» منتشر می‌شود؛ خطای HTTP آپستریم ≥400 با همان کد و فرمت OpenAI برمی‌گردد.

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-ItqvFVBt8slw2vqxPuW9oLiSyGGgC29lNYeET64dIzJ04e50" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-fable-5.1","messages":[{"role":"user","content":"سلام"}],"stream":true}'
```

### 7.6 `POST /v1/messages` — Anthropic Compatible

- طبق قوانین Anthropic، `model` و `max_tokens` **اجباری‌اند** (نبود → `400 invalid_request_error` با پیام `model: Field required` / `max_tokens: Field required`).
- `system` به‌صورت رشته یا آرایهٔ بلوک پذیرفته می‌شود و به یک پیام system تبدیل می‌گردد.
- **غیراستریم:** آبجکت `message` با بلوک‌های `{type:"thinking", thinking}` (در صورت وجود) و `{type:"text", text}` + `stop_reason:"end_turn"` و `usage`.
- **استریم:** چرخهٔ کامل رویدادها: `message_start` → `ping` → (`content_block_start` + `content_block_delta` با `thinking_delta`/`text_delta` + `content_block_stop`)* → `message_delta` (stop_reason + usage) → `message_stop`. تفکر مدل به‌صورت بلوک thinking جداگانه منتشر می‌شود.

```bash
curl -N http://localhost:3000/v1/messages \
  -H "x-api-key: sk-ant-api03-9lamB2K7KoYT8fw8tAp2CKL5kKsOHKhN4mE9eawuzRuW0aU3umJirsEFbS3B6RCjLRw8lrJ0YRmsnxECIu3nHaKM" \
  -H "anthropic-version: 2023-06-01" -H "Content-Type: application/json" \
  -d '{"model":"claude-fable-5.1","max_tokens":1024,"messages":[{"role":"user","content":"سلام"}],"stream":true}'
```

### 7.7 Error Formats | فرمت خطاها

| Source | Shape |
|---|---|
| OpenAI-style | `{"error":{"message":"…","type":"invalid_request_error|api_error","param":null,"code":"invalid_api_key"}}` |
| Anthropic-style | `{"type":"error","error":{"type":"authentication_error|invalid_request_error|rate_limit_error|api_error","message":"…"}}` |
| mapping | اتصال ناموفق → `502` · تایم‌اوت → `504` · 429 آپستریم → همان 429 (`rate_limit_error` در سبک Anthropic) |

## 8. Development History | تاریخچهٔ توسعه

| # | Task | خروجی کلیدی |
|---|---|---|
| 1 | بک‌اند پروکسی `/api/chat` + `/api/ping` + کتابخانه‌های مشترک (`upstream.ts`، `sse.ts`، `markdown.ts`) | تصمیم `node:https` به‌جای fetch برای ارسال واقعی Origin/Referer |
| 2 | فرانت‌اند کامل RTL فارسی در `page.tsx` + `layout.tsx` + `globals.css` + `error.tsx` | UI کامل تم تاریک با استریم زنده و حافظهٔ localStorage |
| 3 | تأیید end-to-end با مرورگر headless | استریم ۲۸۶ تکه/۱۹ ثانیه، توقف/بازتولید/ویرایش/خروجی/موبایل همه ✓ |
| 4 | نسخهٔ تک‌فایل `app.js` (پورت کامل منطق، بدون پکیج) | ۲۰۵۸ خط؛ رعایت قیود PAGE_JS (بدون backtick/`${`) |
| 5 | تأیید مستقل app.js + جمع‌بندی | تست ۶ مسیر + 413 برای بدنهٔ بزرگ + eslint ignore |
| 6 | ۷ مدل جدید + کلیدهای API + سه اندپوینت سازگار OpenAI/Anthropic در هر دو نسخه | `/v1/models`، `/v1/chat/completions`، `/v1/messages`، `api-keys.json`، مودال 🔑 |
| 7 | بازیابی ورک‌اسپیس از tar + پیکر مدل گروهی مطابق سایت freemodels در هر دو نسخه | ۴ لوگوی واقعی، ۳ گروه، رفع باگ z-index stacking، embed base64 |

## 9. Known Issues & Roadmap | مشکلات شناخته‌شده و نقشهٔ راه

### 9.1 Known Issues | مشکلات شناخته‌شده
1. **خطای موقت 429 آپستریم** («providers exhausted» / «Service temporarily overloaded»): رفتار سرویس رایگان است، نه باگ پروژه. هر دو نسخه آن را شفاف به حباب قرمز (UI) یا کد/فرمت استاندارد (API) تبدیل می‌کنند و retry پس از چند ثانیه معمولاً موفق است.
2. **فرمت پاسخ آپستریم قفل به سبک OpenAI فعلی است.** پارسر `sse.ts` جهانی طراحی شده اما اگر آپستریم ساختارش را تغییر دهد، اولین نقطهٔ بررسی همین فایل است.
3. **وابستگی فونت به شبکه در نسخهٔ Next:** فونت Vazirmatn با لینک مستقیم Google Fonts لود می‌شود (تصمیم عمدی برای مقاومت به قطعی نصب)؛ در محیط بدون اینترنت UI با فونت جایگزین رندر می‌شود. نسخهٔ app.js این مشکل را ندارد (لوگوها embed اند).
4. **`usage` تخمینی است** (~۴ نویسه = ۱ توکن) چون آپستریم usage واقعی نمی‌دهد.

### 9.2 Roadmap | مسیر پیشنهادی ادامه
- **Retry خودکار با backoff** برای 429 آپستریم در لایهٔ پروکسی (در صورت تمایل به تجربهٔ بدون خطا).
- **افزودن فیلدهای `group`/`vendor` به `/v1/models`** به‌صورت extension اختیاری (سازگاری OpenAI حفظ می‌شود).
- **استقرار پروداکشن:** `bun run build` + اجرای standalone (پشت reverse proxy با `X-Accel-Buffering: no`)، یا `node app.js` با systemd/pm2.
- **تست‌های خودکار:** اسکریپت smoke برای ۶ مسیر (فعلاً چک‌لیست دستی در `HANDOFF.md` § 5).
- **چند‌کاربره‌سازی (اختیاری):** محدودسازی نرخ و احراز هویت جدا برای `/api/chat` اگر اپ عمومی شود.
#   A i P r o v i d e r  
 