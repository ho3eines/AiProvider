# AI Development Guide — راهنمای توسعه هوش مصنوعی

**پروژه:** چت هوشمند (Smart Chat) · **نسخهٔ سند:** 1.0 · **تاریخ:** ۱۴ سپتامبر ۲۰۲۶ / ۲۳ شهریور ۱۴۰۵
**مخاطب:** توسعه‌دهنده‌ها و ایجنت‌هایی که لایهٔ هوش مصنوعی پروژه را توسعه می‌دهند یا از API آن استفاده می‌کنند.
**سندهای همراه:** `README.md` (داکیومنت کامل پروژه) · `HANDOFF.md` (سند تحویل) · `worklog.md` (تاریخچهٔ خام تسک‌ها)

---

## 1. Overview & Scope | معرفی و دامنه

این سند مرجع عملیاتی «لایهٔ هوش مصنوعی» پروژه است: هر آن‌چه بین کاربر و مدل‌های زبانی اتفاق می‌افتد. دامنهٔ آن شامل چهار زیرسیستم است: (۱) کاتالوگ مدل‌ها و نرمال‌سازی نام مدل، (۲) انتقال به آپستریم freemodels با جعل هدرهای مرورگر، (۳) استریم SSE و پارسر جهانی پاسخ، و (۴) لایهٔ سازگاری API با دو استاندارد OpenAI و Anthropic. چیزهایی که در دامنهٔ این سند نیست — نصب و اجرا، UI چت، پیکر مدل گروهی و تاریخچهٔ تسک‌ها — در `README.md` و `HANDOFF.md` پوشش داده شده‌اند.

این راهنما از دو منظر نوشته شده است. منظر نخست «مصرف‌کنندهٔ API» است: کسی که با curl یا SDK رسمی OpenAI/Anthropic به اندپوینت‌های `/v1` وصل می‌شود و فقط نیاز به قرارداد درست درخواست/پاسخ دارد (بخش‌های ۵ تا ۹). منظر دوم «توسعه‌دهندهٔ پروژه» است: کسی که می‌خواهد مدل اضافه کند، فیلد اکستنشن بسازد، رفتار استریم را عوض کند یا آپستریم را تعویض کند (بخش‌های ۲ تا ۴ و ۱۰). هر دو منظر روی یک واقعیت مشترک تکیه دارند: این پروژه به سرویس رایگان freemodels متصل است و همهٔ تصمیم‌های طراحی — از جعل هدر گرفته تا پارسر جهانی — نتیجهٔ همین محدودیت‌اند.

**قانون طلایی این سند:** هر قابلیت در دو نسخهٔ پروژه (Next.js در `src/` و تک‌فایل `app.js`) باید همگام بماند؛ هر جا در این سند فایلی از `src/lib` معرفی می‌شود، معادل خطی آن در `app.js` هم ذکر شده است.

---

## 2. AI Layer Architecture | معماری لایهٔ هوش مصنوعی

جریان یک درخواست چت از لحظهٔ خروج از کلاینت تا بازگشت اولین توکن، از چهار لایهٔ مجزا عبور می‌کند. این جداسازی عمدی است: هر لایه می‌تواند مستقل تست و تعویض شود و باگ هر لایه در مرزی مشخص منتسب می‌شود.

```
┌──────────┐   ①POST /api/chat یا /v1/*     ┌───────────────────────────┐
│  Client   │ ─────────────────────────────▶ │  لایهٔ پروتکل (route.ts)   │
│ UI / SDK  │ ◀───────────────────────────── │  auth + اعتبارسنجی ورودی   │
└──────────┘   ②SSE یا JSON در فرمت مقصد    └────────────┬──────────────┘
                                                          │ payload نرمال:
                                                          │ {messages, modelId,
                                                          │  thinking, deepSearch, stream}
                                              ┌───────────▼──────────────┐
                                              │ لایهٔ انتقال upstream.ts   │
                                              │ node:https + هدرهای جعلی  │
                                              └───────────┬──────────────┘
                                                          │ ③HTTPS POST + هدرهای مرورگر
                                              ┌───────────▼──────────────┐
                                              │ freemodels workers (آپستریم)│
                                              │ SSE سبک OpenAI برمی‌گرداند  │
                                              └───────────┬──────────────┘
                                                          │ ④استریم تکه‌به‌تکه
                                              ┌───────────▼──────────────┐
                                              │ پارسر جهانی sse.ts        │
                                              │ استخراج text / reasoning  │
                                              └──────────────────────────┘
```

**لایهٔ رجیستری** (`src/lib/catalog.ts` + `src/lib/providers.ts` · معادل‌های `getProviders`/`resolveModel`/`buildUpstreamPayload` در `app.js`) تصمیم می‌گیرد درخواست به **کدام** آپستریم، با **کدام** هدرها و در **چه** شکلی برود. منبعش `providers.json` است و در زمان اجرا با hot reload (هر ۱ ثانیه، بر اساس mtime) خوانده می‌شود.

**لایهٔ انتقال** (`src/lib/upstream.ts` · معادل `openUpstream` در `app.js`) تنها نقطهٔ تماس با دنیای بیرون است. url/هدرها/احراز هویت/ضرب‌العجل/سقف بدنه همه از رجیستری می‌آیند؛ برای پروایدر فعلی: `https://freemodels-chat.freemodels.workers.dev/`، `maxBodyBytes = 5MB` (بیشتر ← 413) و `timeoutMs = 180000` (پوشش تفکر طولانی مدل‌ها). ثابت‌های `UPSTREAM_URL`/`MAX_BODY_BYTES`/`UPSTREAM_TIMEOUT_MS`/`SPOOFED_HEADERS` در هر دو نسخه فقط برای سازگاری با کد قدیم نگه داشته شده‌اند و مقدارشان در لحظهٔ بالا آمدن از **پروایدر پیش‌فرضِ رجیستری** گرفته می‌شود؛ هندلرها از توابع زنده استفاده می‌کنند.

**چرا `node:https` و نه `fetch`؟** آپستریم فقط به درخواست‌هایی که از دامنهٔ `freemodels.pro` آمده باشند پاسخ می‌دهد و این را از هدرهای `Origin` و `Referer` تشخیص می‌دهد. مشخصات fetch مرورگر/Node ارسال این دو هدر را ممنوع کرده است، در حالی که `node:https` آزادانه اجازه می‌دهد. مجموعهٔ کامل هدرهای جعل‌شده در `SPOOFED_HEADERS` است: `Origin` و `Referer = https://freemodels.pro`، User-Agent کروم ۱۵۲ روی ویندوز، هدرهای `sec-ch-ua*` و `sec-fetch-*` و نکتهٔ مهم `Accept-Encoding: identity` — این آخری پاسخ فشرده را غیرفعال می‌کند تا استریم بتواند بدون decompress مستقیم pipe شود.

**سه خط قرمز این لایه** (نقض هرکدام باگ تولید می‌کند): اول، پاسخ آپستریم هرگز نباید در سرور بافر شود — باید تکه‌به‌تکه با `Cache-Control: no-cache, no-transform` و `X-Accel-Buffering: no` عبور کند وگرنه استریم زنده می‌میرد. دوم، قطع کلاینت باید بلافاصله آپستریم را `destroy()` کند (در Next از طریق `req.signal`، در app.js از رویداد `close` روی socket) — نشتی اتصال ممنوع. سوم، هدرهای `access-control-*`، `transfer-encoding` و `content-encoding` آپستریم قبل از عبور حذف می‌شوند تا پاسخ ما تمیز و بدون تداخل باشد.

---

## 3. Model Catalog & Selection | کاتالوگ مدل‌ها و انتخاب مدل

### 3.1 جدول مدل‌ها

مدل‌ها در یک منبع واحد تعریف می‌شوند — رجیستری `providers.json` (با اسکیمای
`docs/providers.schema.json`). نسخهٔ Next آن را از طریق `src/lib/catalog.ts`
(ایزومورفیک: سرور + کلاینت) و `src/lib/providers.ts` (خواندن زنده با hot
reload) می‌خواند؛ نسخهٔ تک‌فایل همان توابع را در `app.js` دارد و علاوه بر آن
یک کپی داخلی (`BUILTIN_PROVIDERS`) برای وقتی که فایل JSON در دسترس نباشد.
`src/lib/models.ts` اکنون فقط یک لایهٔ سازگاری نازک روی `catalog.ts` است.
UI پیکر مدل و هر چهار اندپوینت (`/api/models`، `/v1/models`،
`/v1/chat/completions`، `/v1/messages`) همه از همین منبع می‌خوانند — هیچ لیست
موازی وجود ندارد و `npm run verify` اجازهٔ ساختنش را نمی‌دهد.

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

گروه‌ها و آیکن‌هایشان هم در رجیستری‌اند (`providers[].groups`)؛ نام‌های آیکن
مجاز در هر دو نسخه یکسان‌اند: `sparkles`, `zap`, `globe`, `flask`, `bot`,
`brain`.

### 3.2 نرمال‌سازی نام مدل و انتخاب پروایدر (resolveModel)

`resolveModel()` در `src/lib/catalog.ts` (معادل `app.js`) ورودی را نرم تطبیق
می‌دهد: trim و lowercase، تبدیل فاصله/زیرخط به خط‌تیره (`/[\s_]+/ → "-"`)،
سپس جست‌وجو در `id`ها، نام‌های نمایشی و `aliases`. خروجی یک آبجکت است:
`{ id, publicId, model, provider, known }` — یعنی **پروایدر هم از روی مدل
انتخاب می‌شود**، نه از روی یک ثابت سراسری.

- ورودی خالی/نال ← مدل پیش‌فرض رجیستری.
- ورودی ناشناخته ← `known:false` با **پروایدر پیش‌فرض** و همان id نرمال‌شده
  (تصمیم عمدی: کلاینتی که نام سفارشی می‌فرستد نباید 400 بگیرد).
- اگر آپستریم مدل را با نام دیگری می‌شناسد، `upstreamId` در رجیستری تعیین
  می‌کند چه چیزی روی سیم برود؛ `publicId` همان چیزی است که در پاسخ API و UI
  دیده می‌شود.

`resolveModelId()` هم برای سازگاری با کد قدیم باقی است (فقط id عمومی).

### 3.3 افزودن مدل یا پروایدر جدید (Playbook)

هر دو کار **فقط با ویرایش `providers.json`** انجام می‌شوند — بدون کد:

1. **مدل جدید:** یک رکورد `{ id, name, vendor, group, logo }` به
   `providers[i].models` اضافه کنید (فیلدهای اختیاری: `upstreamId`, `aliases`,
   `default`). گروه تازه باید در `providers[i].groups` هم تعریف شود.
2. **پروایدر/سایت جدید:** یک رکورد کامل با `upstream` (url/headers/auth)،
   `request` (shape/fields/constants)، `response`، `groups` و `models` اضافه
   کنید. احراز هویت را با `${ENV_VAR}` بخوانید، نه مقدار لفظی.
3. **همگام‌سازی نسخهٔ تک‌فایل:** `npm run sync:builtin` (کپی
   `BUILTIN_PROVIDERS` را از روی JSON بازسازی می‌کند + `node --check`).
4. **لوگو (اختیاری):** فایل در `public/` و سپس `npm run embed:logos` برای
   نسخهٔ تک‌فایل.
5. **صحت‌سنجی:** `npm run verify` و `npm run smoke`؛ بعد `GET /api/models` و
   `GET /v1/models` را چک کنید (و در UI صفحه را refresh کنید).
6. **مستندسازی:** `npm run docs:sync` — جدول‌های مدل/پروایدر/گروه در
   `README.md` و همین سند خودکار تازه می‌شوند.

جزئیات گام‌به‌گام، الگوهای آماده و دام‌ها: `skills/add-model/SKILL.md` و
`skills/add-provider/SKILL.md`.

---

## 4. Streaming & the Universal SSE Parser | استریم و پارسر جهانی SSE

### 4.1 چرا پارسر «جهانی»؟

آپستریم رایگان است و هیچ SLA فرمت ندارد؛ در عمل سبک غالبش OpenAI است اما بسته به مدل، فیلدها متفاوت می‌آیند. به همین دلیل `createSseParser` در `src/lib/sse.ts` طراحی شده که «هر شکلی که آپستریم بگوید» را به یک قرارداد داخلی ساده تبدیل کند: رویداد `{ text, reasoning, error? }`. همهٔ مصرف‌کننده‌ها (UI چت، اندپوینت OpenAI، اندپوینت Anthropic) فقط این قرارداد را می‌بینند و از جزئیات آپستریم بی‌خبرند. اگر روزی آپستریم فرمتش را عوض کند، **اولین و معمولاً تنها جای تغییر همین فایل است** (معادل سرور در app.js: `makeUpstreamParser`).

### 4.2 فرمت‌های پشتیبانی‌شده

- **سبک OpenAI:** `data: {"choices":[{"delta":{"content":"..."}}]}` — فیلدهای `content` و `text` و فیلدهای تفکر `reasoning_content` / `reasoning` / `thinking` (هم‌چنین شکل غیراستریم `choices[0].message`).
- **سبک Claude:** `type: "content_block_delta"` با `delta.text` / `delta.thinking`.
- **فیلد مستقیم ریشه:** `{"content":"..."}` یا `{"text":"..."}` یا `{"reasoning_content":"..."}`.
- **آبجکت خام بدون پیشوند `data:`** و **رشتهٔ خام غیر JSON** (مستقیم به متن چسبانده می‌شود).
- **متادیتا:** `data: [DONE]` پایان استریم؛ خطوط `event:`/`id:`/`retry:` نادیده گرفته می‌شوند؛ خطوط شروع‌شده با `:` (کامنت SSE مثل `: ping`) رد می‌شوند.
- **خطای داخل استریم:** آبجکت‌های دارای `error` (رشته یا دارای `message`) به‌صورت رویداد خطا منتشر می‌شوند نه کرش.

### 4.3 جزئیات پیاده‌سازی که باید بدانید

پارسر خط‌به‌خط کار می‌کند و دو بافر دارد: `buf` برای خطوط ناقص (تکه‌های شبکه با مرز دلخواه می‌آیند) و `pendingJson` برای JSON چندخطیِ ناقص — تا وقتی `JSON.parse` موفق نشود، payload جمع می‌شود. اگر در پایان استریم JSON ناتمامی بماند، به‌صورت خام منتشر می‌شود (هیچ داده‌ای دور ریخته نمی‌شود). این طراحی یعنی پارسر هرگز منتظر «چانک کامل» نمی‌ماند و تأخیر صفر دارد — شرط لازم برای کرسر زندهٔ UI.

دو ابزار سروری روی همین پارسر سوارند: `collectUpstreamText` (`app.js:2520`) کل استریم را به متن کامل جمع می‌کند (برای پاسخ‌های غیراستریم `/v1`) و در نسخهٔ Next همین کار با `parser.feed(full)` + `parser.end()` در مسیر غیراستریم انجام می‌شود. فیلد `reasoning` جدا از `text` منتشر می‌شود تا UI بتواند باکس «💭 فرایند تفکر مدل» را بسازد و اندپوینت Anthropic بتواند بلوک `thinking` مستقل تولید کند.

---

## 5. OpenAI-Compatible API | اندپوینت‌های سازگار OpenAI

### 5.1 احراز هویت

```
Authorization: Bearer <key>
```

هر دو کلید (`sk-…` و `sk-ant-…`) پذیرفته می‌شوند (بخش ۸). کلید نامعتبر ← `401` با `error.code = "invalid_api_key"`.

### 5.2 GET /v1/models

لیست استاندارد OpenAI از روی رجیستری؛ `owned_by` = `<ownedByPrefix>-<vendor-slug>` (مثلاً `freemodels-anthropic`). فیلدهای غیراستاندارد (`group`/`vendor`/`logo`/`provider`) عمداً در حالت عادی برنمی‌گردند تا سازگاری OpenAI حفظ شود؛ با `?extra=1` اضافه می‌شوند. بدون کلید ← 401. نمونه:

```bash
curl -s http://localhost:3000/v1/models \
  -H "Authorization: Bearer sk-ItqvFVBt8slw2vqxPuW9oLiSyGGgC29lNYeET64dIzJ04e50"
```

### 5.3 POST /v1/chat/completions

```bash
curl -sN http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-ItqvFVBt8slw2vqxPuW9oLiSyGGgC29lNYeET64dIzJ04e50" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-fable-5.1",
    "messages": [{"role": "user", "content": "سلام! یک شعر کوتاه بگو"}],
    "stream": true,
    "thinking": false,
    "deep_search": false
  }'
```

**قواعد ورودی:** `messages` اجباری و باید غیرخالی باشد (400). نقش‌های `assistant`/`system` عیناً عبور می‌کنند؛ هر نقش ناشناخته به `user` نگاشت می‌شود (رفتار نرم، بدون خطا). محتوای رشته‌ای یا آرایهٔ بلوکی هر دو پذیرفته است (`flattenContent` بلوک‌ها را به متن ساده می‌کاهد). دو اکستنشن غیراستاندارد اختیاری داریم: `"thinking": true` (فعال‌سازی تفکر مدل) و `"deep_search": true` (جست‌وجوی عمیق) — هر دو `boolean` پیش‌فرض false.

**مسیر غیراستریم** (`"stream": false` یا حذف آن): پاسخ استاندارد `chat.completion` با `finish_reason: "stop"` و `usage` تخمینی (هر ~۴ نویسه = ۱ توکن؛ آپستریم شمارندهٔ واقعی نمی‌دهد). اگر مدل تفکر کند، متن تفکر به‌عنوان بخشی از محتوا برمی‌گردد.

**مسیر استریم** (`"stream": true`): توالی `chat.completion.chunk` با این قواعد — چانک اول `delta: {role: "assistant", content: ""}`؛ تکه‌های متن در `delta.content`؛ تکه‌های تفکر در `delta.reasoning_content` (همان فیلدی که SDK ها به‌عنوان reasoning می‌شناسند)؛ خطای میانی استریم به‌صورت `delta: {content: "⚠️ …"}` منتشر می‌شود؛ چانک پایانی `finish_reason: "stop"`؛ اگر `stream_options.include_usage = true` باشد یک چانک `usage` دار قبل از `data: [DONE]` می‌آید. قطع کلاینت وسط استریم ← آپستریم بلافاصله destroy می‌شود (هزینهٔ سهمیه هدر نمی‌رود).

**نمونهٔ Python (SDK رسمی):**

```python
from openai import OpenAI
client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk-ItqvFVBt8slw2vqxPuW9oLiSyGGgC29lNYeET64dIzJ04e50",
)
stream = client.chat.completions.create(
    model="claude-fable-5.1",
    messages=[{"role": "user", "content": "سلام!"}],
    stream=True,
)
for chunk in stream:
    delta = chunk.choices[0].delta
    if delta.content:
        print(delta.content, end="", flush=True)
```

---

## 6. Anthropic-Compatible API | اندپوینت سازگار Anthropic

### 6.1 POST /v1/messages

```
x-api-key: <key>
anthropic-version: <اختیاری — اعتبارسنجی نمی‌شود>
```

این اندپوینت **سخت‌گیرانه** مطابق قوانین خود Anthropic است: `model` و `max_tokens` اجباری‌اند و نبودشان ← `400` با پیام عیناً `model: Field required` / `max_tokens: Field required` (SDK ها و ابزارهای رسمی به این خطاها تکیه دارند؛ این رفتار را شل نکنید). فیلد `system` هم رشتهٔ ساده می‌پذیرد هم آرایهٔ بلوک (به متن تبدیل و به‌عنوان پیام system به آپستریم می‌رود). نقش‌ها فقط `user`/`assistant` (بقیه ← user). کلید Bearer هم به‌عنوان جایگزین پذیرفته می‌شود.

```bash
curl -sN http://localhost:3000/v1/messages \
  -H "x-api-key: sk-ant-api03-9lamB2K7KoYT8fw8tAp2CKL5kKsOHKhN4mE9eawuzRuW0aU3umJirsEFbS3B6RCjLRw8lrJ0YRmsnxECIu3nHaKM" \
  -H "content-type: application/json" \
  -d '{"model": "claude-fable-5.1", "max_tokens": 1024, "stream": true,
       "messages": [{"role": "user", "content": "خلاصهٔ معماری پروژه را بده"}]}'
```

**چرخهٔ استریم استاندارد Anthropic:** `message_start` (آبجکت message با usage ورودی) ← `ping` ← توالی بلوک‌ها: هر بلوک با `content_block_start` باز و با `content_block_delta` پر و با `content_block_stop` بسته می‌شود. تفکر مدل بلوک مستقل `thinking` با `thinking_delta` است و پاسخ نهایی بلوک `text` با `text_delta` — اگر مدل بین تفکر و پاسخ جابه‌جا شود، بلوک قبلی بسته و بلوک جدید با index بعدی باز می‌شود. پایان: `message_delta` (با `stop_reason: "end_turn"` و `output_tokens`) ← `message_stop`. این ترتیب دقیقاً همان چیزی است که `anthropic` SDK برای بازسازی استریم انتظار دارد.

**غیراستریم:** آبجکت `message` با آرایهٔ `content` از بلوک‌ها — اگر تفکر موجود باشد `[{"type":"thinking","thinking":"…"},{"type":"text","text":"…"}]` و اگر نه فقط بلوک text. خطای 429 آپستریم این‌جا با `type: "rate_limit_error"` برگردانده می‌شود (نه api_error) تا SDK منطق retry خودش را اجرا کند.

**نمونهٔ Python (SDK رسمی):**

```python
import anthropic
client = anthropic.Anthropic(
    base_url="http://localhost:3000",
    api_key="sk-ant-api03-9lamB2K7KoYT8fw8tAp2CKL5kKsOHKhN4mE9eawuzRuW0aU3umJirsEFbS3B6RCjLRw8lrJ0YRmsnxECIu3nHaKM",
)
with client.messages.stream(
    model="claude-fable-5.1",
    max_tokens=1024,
    messages=[{"role": "user", "content": "سلام!"}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

---

## 7. Internal Chat Contract | قرارداد داخلی چت (اندپوینت‌های /api)

UI چت (هر دو نسخه) با لایهٔ AI از طریق این قرارداد ساده‌تر حرف می‌زند — این یک API عمومی نیست و نیازی به کلید ندارد (برخلاف `/v1`):

```
POST /api/chat  {messages:[{role,content}], modelId, thinking, deepSearch, stream}
  ← استریم SSE سبک OpenAI آپستریم (delta.content + delta.reasoning_content) یا JSON کامل
  ← خطا: {error:{message}} با 413/502/504 یا عبور کد آپستریم (مثلاً 429)

GET /api/models → {models:[{id,name,vendor,group,logo,providerId}], groups:[{title,icon}], defaultModel}
                  (کاتالوگ عمومی برای UI — بدون نشت url/هدر/auth آپستریم)
GET /api/ping?model=<id> → {status:"ok"|"error", ms, sample(≤200), provider, model}
GET /api/keys → {openai, anthropic}   (در app.js همین داده در window.__FM__ هم تزریق می‌شود)
```

تفاوت مهم `/api/chat` با `/v1/*` این است که اینجا **پروکسی خام** هستیم: پاسخ آپستریم بدون تبدیل فرمت pipe می‌شود و پارس/نمایش در کلاینت انجام می‌گیرد (پارسر SSE همان منطق، سمت مرورگر). نام مدل هم اینجا با همان `resolveModel` نرمال می‌شود (و پروایدر از رویش انتخاب می‌شود). `/api/ping` برای دکمهٔ «اتصال؟» است: یک درخواست سبک `stream:false` با پیام ping می‌فرستد و تأخیر واقعی آپستریم را گزارش می‌کند — ۲ تا ۳ ثانیه پاسخ طبیعی است.

---

## 8. API Keys & Authentication | کلیدها و احراز هویت

کلیدها در `api-keys.json` (ریشهٔ پروژه، permission `600`) نگه‌داری می‌شوند و بین هر دو نسخه مشترک‌اند:

```json
{
  "openai":    "sk-ItqvFVBt8slw2vqxPuW9oLiSyGGgC29lNYeET64dIzJ04e50",
  "anthropic": "sk-ant-api03-9lamB2K7KoYT8fw8tAp2CKL5kKsOHKhN4mE9eawuzRuW0aU3umJirsEFbS3B6RCjLRw8lrJ0YRmsnxECIu3nHaKM",
  "createdAt": "2026-09-14T…"
}
```

**قواعد تولید** (اولین اجرا اگر فایل نباشد، در `src/lib/apikeys.ts` و `loadOrCreateKeys()` در app.js): کلید سبک OpenAI = `sk-` + ۴۸ نویسهٔ الفباعددی تصادفی؛ کلید سبک Anthropic = `sk-ant-api03-` + ۸۸ نویسه — دقیقاً با الگوی رسمی تا اعتبارسنجی‌های سمت کلاینت SDK ها رد نشود. **اولویت:** متغیرهای محیطی `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` روی فایل override می‌کنند (برای استقرار بدون فایل). **سیاست پذیرش:** هر دو کلید روی هر دو اندپوینت کار می‌کنند — رفتار عمدی برای ساده نگه‌داشتن مصرف‌کننده. نتایج کش در حافظه است؛ اگر فایل را دستی عوض کردید باید سرور را ری‌استارت کنید. چرخش کلید: فایل را ویرایش یا حذف کنید (اجرای بعدی می‌سازد) یا env ست کنید.

---

## 9. Error Handling & Limits | مدیریت خطا و محدودیت‌ها

ماتریس کامل خطاها از دید مصرف‌کنندهٔ API — در همهٔ مسیرها خطا «در فرمت مقصد» برمی‌گردد (آبجکت OpenAI یا `{type:"error",error:{type,message}}` آنتروپیک):

| کد | معنا | ریشه | کاری که باید کرد |
|---|---|---|---|
| `400` | بدنه/فیلد نامعتبر (`invalid_request_error`) | JSON خراب، `messages` خالی، نبود `model`/`max_tokens` در `/v1/messages` | اصلاح درخواست |
| `401` | کلید نامعتبر (`invalid_api_key`) | هدر غایب یا اشتباه | کلید صحیح از بخش ۸ |
| `413` | بدنه > ۵ مگابایت | سقف `MAX_BODY_BYTES` | تاریخچه را کوتاه کنید |
| `429` | سهمیهٔ آپستریم تمام (`rate_limit_error` در آنتروپیک) | رفتار سرویس رایگان «providers exhausted» | چند ثانیه بعد retry — **باگ نیست، مخفی هم نکنید** |
| `502` | اتصال به آپستریم برقرار نشد | شبکه/قطعی آپستریم | ping بگیرید، بعداً تلاش کنید |
| `504` | تایم‌اوت ۱۸۰ ثانیه | پاسخ ندادن آپستریم | retry؛ اگر پایدار شد وضعیت آپستریم را ببینید |

نکات ظریف برای توسعه‌دهنده: (۱) خطای 429 که «وسط» یک استریم باز برسد قابل تبدیل به کد HTTP نیست — در مسیر OpenAI به‌صورت `delta: {content:"⚠️ …"}` و در مسیر Anthropic به‌صورت `text_delta` داخل بلوک text منتشر می‌شود تا کلاینت چیزی ببیند. (۲) پاسخ خالی آپستریم هرگز به‌صورت 200 خالی برنمی‌گردد؛ عبارت «⚠️ پاسخ خالی از سرور دریافت شد» جایگزین می‌شود تا SDK ها متن خالی را خطا نگیرند. (۳) CORS اندپوینت‌های `/v1` باز است و هدرهای `Authorization`، `x-api-key` و `anthropic-version` را صریحاً مجاز می‌کند — از مرورگر هم مستقیم قابل مصرف است.

---

## 10. Development Playbook | کتاب راهنمای توسعه

### 10.1 افزودن فیلد اکستنشن جدید (مثل thinking/deep_search)

اگر فیلد شما فقط **نگاشتِ نام** است (یعنی آپستریم همان مفهوم را با نام دیگری می‌خواهد)، هیچ کدی لازم نیست: در رجیستری `request.fields` همان پروایدر یک کلید مجاز (`model`/`messages`/`stream`/`thinking`/`deepSearch`/`maxTokens`/`system`) را به نام فیلد آپستریم نگاشت کنید، یا اگر مقدار ثابت است در `request.constants` بگذارید.

اگر واقعاً فیلد تازه‌ای به قرارداد داخلی اضافه می‌شود، مسیر استاندارد سه ایستگاه است: (۱) در route مربوطه بخوانید و به `buildUpstreamPayload` بدهید (`parsed.my_field === true`)؛ (۲) همان فیلد را در `NormalChatRequest` (`src/lib/catalog.ts`) و تابع `buildUpstreamPayload` هر دو نسخه اضافه کنید؛ (۳) اگر UI دارد، چک‌باکس را در هر دو فرانت اضافه کنید. نام فیلد در `/v1/chat/completions` از قاعدهٔ snake_case پیروی می‌کند (مثل `deep_search`) و در payload داخلی camelCase می‌شود (`deepSearch`) — این نگاشت عمدی است تا با استاندارد OpenAI سازگار بمانیم.

### 10.2 تغییر یا تعویض آپستریم

اگر freemodels از دسترس خارج شد یا آدرس عوض شد، **فقط `providers.json` را ویرایش کنید**: `providers[i].upstream.url` و `headers` (Origin/Referer/UA متناسب با دامنهٔ جدید) و در صورت نیاز `timeoutMs`. سپس `npm run sync:builtin` — hot reload باعث می‌شود حتی restart لازم نباشد. می‌توانید به‌جای تعویض، یک پروایدر دوم اضافه کنید تا هر دو موازی فعال بمانند (پروایدر از روی مدل انتخاب می‌شود). اگر فرمت پاسخ عوض شد، اول `response.textFields`/`reasoningFields`/`doneToken` همان پروایدر را تنظیم کنید؛ تنها وقتی که اینها کافی نبود طبق بخش ۴ به `src/lib/sse.ts` و معادل `makeUpstreamParser` دست بزنید — بقیهٔ سیستم نباید متوجه شود. جزئیات: `skills/add-provider/SKILL.md`.

### 10.3 آزمون سریع لایهٔ AI (شش curl)

```bash
K="sk-ItqvFVBt8slw2vqxPuW9oLiSyGGgC29lNYeET64dIzJ04e50"; A="sk-ant-api03-9lamB2K7KoYT8fw8tAp2CKL5kKsOHKhN4mE9eawuzRuW0aU3umJirsEFbS3B6RCjLRw8lrJ0YRmsnxECIu3nHaKM"; B=http://localhost:3000
curl -s $B/api/ping                                                # ۱ سلامت آپستریم
curl -s $B/v1/models -H "Authorization: Bearer $K" | head -c 400   # ۲ لیست ۷ مدل
curl -s $B/v1/models | head -c 200                                 # ۳ 401 بدون کلید
curl -sN $B/v1/chat/completions -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
  -d '{"model":"kimi-k3","messages":[{"role":"user","content":"سلام"}],"stream":true}'   # ۴ استریم + [DONE]
curl -s $B/v1/chat/completions -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
  -d '{"model":"glm-5.2","messages":[{"role":"user","content":"سلام"}]}'                 # ۵ غیراستریم + usage
curl -s $B/v1/messages -H "x-api-key: $A" -H "Content-Type: application/json" \
  -d '{"model":"claude-fable-5.1"}'                                # ۶ 400 با «max_tokens: Field required»
```

### 10.4 دیباگ و بهترین شیوه‌ها

**لاگ سرور:** هر درخواست با لاگ رنگی ANSI (زمان/مسیر/کد آپستریم/مدت) در کنسول هر دو نسخه چاپ می‌شود — اولین نقطهٔ شروع دیباگ. **پنل Raw SSE:** در UI چت (دکمهٔ «Raw SSE») دیتای خام آپستریم را تا ۸۰ کیلوبایت نشان می‌دهد؛ برای تشخیص «مشکل از فرمت آپستریم است یا از تبدیل ما» بی‌رقیب است. **نام مدل‌ها همیشه از منبع واحد** — هرگز id مدل را در فایل دیگری hardcode نکنید. **تفکر و deep_search هزینه‌دارند** (کندتر و پرخطاتر) — در مستندسازی و نمونه‌ها پیش‌فرض false را ترویج کنید. **پس از هر تغییر:** `bun run lint` (صفر خطا) + `node --check app.js` + شش curl بالا.

---

## 11. AI Layer Roadmap | نقشهٔ راه لایهٔ هوش مصنوعی

اولویت‌بندی پیشنهادی بر اساس ارزش/هزینه: (۱) **Retry خودکار با backoff برای 429** در `openUpstream` — یک retry با تأخیر ۲–۵ ثانیه بیشترین بهبود تجربه را با کمترین ریسک می‌دهد. (۲) ~~فیلدهای اختیاری `group`/`vendor` در پاسخ `/v1/models`~~ — **انجام شد**: با `?extra=1` فیلدهای `group`/`vendor`/`logo`/`provider` برمی‌گردند و حالت عادی استاندارد می‌ماند. جایگزین پیشنهادی: **fallback زنجیره‌ای پروایدرها** هنگام 429/5xx (رجیستری اکنون چندپروایدری است). (۳) **شمارش توکن واقعی‌تر** (تیکر تنهایی به‌جای نویسه/۴) برای usage. (۴) **Rate limit و audit log سمت خودمان** اگر پروژه عمومی شود. (۵) **پشتیبانی ورودی تصویر/فایل** در صورت باز شدن آن در آپستریم. هر آیتم باید طبق Playbook بخش ۱۰ در هر دو نسخه هم‌زمان پیاده و با شش curl تأیید شود و ردیفی در `worklog.md` بگیرد.

### 11.1 مرجع سریع فایل‌های لایهٔ AI

شمارهٔ خط نگذارید (جابه‌جا می‌شود)؛ با `grep -n "^function <name>" app.js`
پیدایش کنید.

| نقش | نسخهٔ Next.js | معادل در app.js |
|---|---|---|
| رجیستری + کاتالوگ + نرمال‌سازی + ساخت بدنه | `src/lib/catalog.ts` | `BUILTIN_PROVIDERS`, `getProviders`, `resolveModel`, `buildUpstreamPayload`, `publicCatalog` |
| خواندن زندهٔ رجیستری (hot reload + env toggles) | `src/lib/providers.ts` | `readProvidersConfig`, `withEnvToggles`, `PROVIDERS_RELOAD_MS` |
| سازگاری قدیم (`FM_MODELS`, `resolveModelId`) | `src/lib/models.ts` | `FM_MODELS`, `DEFAULT_MODEL_ID`, `resolveModelId` |
| انتقال آپستریم + هدرها + CORS | `src/lib/upstream.ts` | `openUpstream`, `upstreamOptions`, `OPEN_CORS`, `logReq` |
| پارسر جهانی SSE | `src/lib/sse.ts` | `makeUpstreamParser`, `readStreamText` |
| ابزار مشترک /v1 (CORS، SSE، flatten، usage) | `src/lib/v1.ts` | `getBearerToken`, `openaiError`, `anthropicError`, `flattenContent`, `estTokens` |
| کلیدها | `src/lib/apikeys.ts` | `loadOrCreateKeys`, `API_KEYS`, `keyIsValid` |
| اندپوینت OpenAI | `src/app/v1/chat/completions/route.ts` + `src/app/v1/models/route.ts` | `handleOpenAI`, `handleModels` |
| اندپوینت Anthropic | `src/app/v1/messages/route.ts` | `handleAnthropic` |
| پروکسی داخلی چت + کاتالوگ + کلیدها + ping | `src/app/api/{chat,models,keys,ping}/route.ts` | `handleChat`, `handleCatalog`, `handleKeys`, `handlePing` (+ تزریق `window.__FM__`) |

### 11.2 هم‌بستهٔ سندهای پروژه

| سند | نقش | فرمت |
|---|---|---|
| `README.md` | داکیومنت کامل پروژه: معماری، نصب و اجرا، مرجع API مقدماتی، تاریخچه و نقشهٔ راه کلی | MD + PDF |
| `HANDOFF.md` | سند تحویل: TL;DR سه‌دستوری، ۱۰ نکتهٔ بحرانی، قرارداد فرانت-بک، چک‌لیست صحت‌سنجی | MD + PDF |
| `AI-GUIDE.md` (همین سند) | مرجع لایهٔ AI: مدل‌ها، آپستریم، SSE، اندپوینت‌های /v1، کلیدها، خطاها، Playbook | MD + PDF |
| `skills/*/SKILL.md` | دفترچهٔ عملیات تغییرات: افزودن مدل/پروایدر/قابلیت، ویرایش `app.js`، دیباگ استریم، به‌روزرسانی اسناد | MD |
| `docs/providers.schema.json` | اسکیمای رجیستری (اعتبارسنجی و راهنما در ویرایشگر) | JSON Schema |
| `worklog.md` | گزارش خام تسک‌ها با جزئیات تست و تصمیم‌ها — منبع تاریخچه | MD |
