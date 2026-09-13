---
name: add-provider
description: وصل‌کردن یک سایت/آپستریم جدید (پروایدر) به پروژه — تعریف endpoint، هدرها، احراز هویت، شکل بدنهٔ درخواست و نحوهٔ خواندن پاسخ، فقط با ویرایش providers.json. وقتی استفاده کنید که بخواهید مدل‌های یک سرویس دیگر (OpenAI-like، Anthropic-like یا سفارشی) را به اپ و API اضافه کنید.
---

# Add a Provider — اتصال به سایت/آپستریم جدید

## When to use — چه زمانی

- یک سرویس چت دیگر (سایت رایگان، سرویس شرکتی، gateway شخصی، نمونهٔ محلی مثل
  Ollama/LM Studio/vLLM) دارید و می‌خواهید مدل‌هایش در UI و `/v1/*` دیده شوند.
- می‌خواهید آپستریم فعلی را با یکی دیگر جایگزین یا **موازی** کنید
  (چند پروایدر هم‌زمان فعال‌اند؛ پروایدر از روی مدل انتخاب می‌شود).
- می‌خواهید یک پروایدر را موقتاً خاموش کنید (`"enabled": false`).

**معماری:** هیچ route handler یا کد UI نیازی به تغییر ندارد. رجیستری
`providers.json` همه‌چیز را توصیف می‌کند و هر دو نسخهٔ اپ در زمان اجرا
می‌خوانندش (hot reload هر ۱ ثانیه).

```
کلاینت → /v1/chat/completions (یا /api/chat)
       → resolveModel(model)        ← پروایدر از روی مدل پیدا می‌شود
       → buildUpstreamPayload(...)  ← بدنه به «شکل» مورد انتظار آن آپستریم
       → openUpstreamFor(provider)  ← url/headers/auth/timeout از رجیستری
       → پارسر جهان‌شمول SSE        ← text/reasoning از هر فرمت رایج
       → پاسخ OpenAI/Anthropic به کلاینت
```

---

## Step 0 — شناسایی آپستریم (Reconnaissance)

قبل از نوشتن پیکربندی، سه چیز را بفهمید: **URL**، **شکل بدنه**، **شکل پاسخ**.

```bash
# ۱) ساده‌ترین درخواست ممکن را بزنید و ببینید چه می‌خواهد
curl -i https://api.example.com/v1/chat/completions \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $MY_KEY" \
  -d '{"model":"some-model","messages":[{"role":"user","content":"hi"}],"stream":false}'

# ۲) همان را با stream:true بزنید و فرمت SSE را ببینید
curl -N …  -d '{…,"stream":true}'

# ۳) اگر سایت محافظت‌شده (Cloudflare/403) است، هدرهای مرورگر را از
#    DevTools → Network → Copy as cURL کپی کنید و ببینید کدام هدر حیاتی است
```

نشانه‌های تشخیص شکل پاسخ:

| در پاسخ/استریم دیدید | یعنی |
|---|---|
| `choices[0].delta.content` + `data: [DONE]` | سبک OpenAI → `shape: "openai"` |
| `choices[0].delta.reasoning_content` | تفکر جدا → خودکار خوانده می‌شود |
| `content_block_delta` + `delta.text` | سبک Claude → `shape: "anthropic"` (یا openai؛ پارسر جهان‌شمول هر دو را می‌فهمد) |
| `{"text": "…"}` / `{"output": "…"}` / `{"answer": "…"}` | فیلد سفارشی → `response.textFields` |
| HTML یا 403 | احتمالاً هدرهای مرورگر (Origin/Referer/UA) لازم است |

> پارسر (`src/lib/sse.ts` و `makeUpstreamParser` در `app.js`) «جهان‌شمول» است:
> SSE سبک OpenAI، سبک Claude، JSON معمولی و حتی متن خام را می‌خواند. پس در
> اکثر موارد **فقط** `shape` و در موارد خاص `textFields/reasoningFields` کافی است.

---

## Step 1 — بلوک پروایدر را بنویسید

یک آبجکت به آرایهٔ `providers` در `providers.json` اضافه کنید.
**الگوی کامل** (همهٔ فیلدها با توضیح؛ هرچه لازم ندارید حذف کنید):

```jsonc
{
  "id": "example",                       // شناسهٔ یکتا، لاتین، بدون فاصله (در لاگ/خطا دیده می‌شود)
  "name": "Example AI",                  // نام نمایشی
  "site": "https://example.com",         // فقط برای مستندات/نمایش
  "enabled": true,                       // false ← مدل‌هایش در UI/API دیده نمی‌شوند
  "ownedByPrefix": "example",            // owned_by در /v1/models → example-openai

  "upstream": {
    "url": "https://api.example.com/v1/chat/completions",  // از ${VAR} پشتیبانی می‌کند
    "method": "POST",
    "timeoutMs": 120000,                 // برای مدل‌های استدلالی بزرگ‌تر بگیرید
    "maxBodyBytes": 5242880,
    "headers": {
      "Content-Type": "application/json",
      "Accept": "*/*",
      "Accept-Encoding": "identity"      // ← مهم: تا SSE فشرده/بافرنگهدار نشود
    },
    "auth": { "header": "Authorization", "value": "Bearer ${EXAMPLE_API_KEY}" }
  },

  "request": {
    "shape": "openai",                   // openai | anthropic | freemodels | passthrough
    "passthrough": false,                // true ← کلیدهای اضافیِ /api/chat هم پاس داده شوند
    "fields": { "model": "model", "messages": "messages", "stream": "stream" },
    "constants": {}                      // فیلدهای ثابت، مثلاً {"api_version":"v2"}
  },

  "response": {
    "profile": "universal",
    "textFields": [],                    // فیلدهای متنیِ مخصوص این آپستریم
    "reasoningFields": [],               // فیلدهای «تفکر» مخصوص این آپستریم
    "doneToken": "[DONE]"                // نشانهٔ پایان استریم
  },

  "groups": [
    { "title": "Example Models", "icon": "bot" }   // sparkles|zap|globe|flask|bot|brain
  ],

  "models": [
    {
      "id": "example-large",
      "name": "Example Large",
      "vendor": "Example Inc",
      "group": "Example Models",
      "logo": "/logo.svg",
      "upstreamId": "example-large-2026-01",   // اگر آپستریم نام دیگری می‌خواهد
      "aliases": ["Example Large", "ex-large"]
    }
  ]
}
```

### قالب‌های آمادهٔ `request`

**A. OpenAI-compatible (رایج‌ترین)**
```jsonc
"request": { "shape": "openai",
  "fields": { "model": "model", "messages": "messages", "stream": "stream" } }
```

**B. Anthropic-compatible**
```jsonc
"request": { "shape": "anthropic",
  "fields": { "model": "model", "messages": "messages", "stream": "stream",
              "system": "system", "maxTokens": "max_tokens" } }
```
(در این حالت `system` فیلد جدا می‌شود؛ `maxTokens` فقط وقتی کلاینت فرستاده باشد.)

**C. freemodels-like (نام فیلدهای اختصاصی + اکستنشن‌های تفکر/جست‌وجو)**
```jsonc
"request": { "shape": "freemodels", "passthrough": true,
  "fields": { "model": "modelId", "messages": "messages", "stream": "stream",
              "thinking": "thinking", "deepSearch": "deepSearch" } }
```

**D. نام فیلدهای کاملاً سفارشی**
```jsonc
"request": { "shape": "openai",
  "fields": { "model": "prompt_model", "messages": "dialog", "stream": "sse" },
  "constants": { "version": 3 } }
```
`fields` نگاشتِ «نام نرمالِ داخلی → نام فیلد آپستریم» است؛ کلیدهای مجاز:
`model` `messages` `stream` `thinking` `deepSearch` `maxTokens` `system`.

**E. بدنهٔ دست‌نخورده (پروکسی خالص)**
```jsonc
"request": { "shape": "passthrough" }
```
فقط در `/api/chat` معنا دارد: کل بدنهٔ کلاینت بدون نگاشت به آپستریم می‌رود.
(در `/v1/*` بدنه همیشه نرمال می‌شود تا سازگاری OpenAI/Anthropic حفظ شود.)

### احراز هویت (`upstream.auth`)

| حالت | پیکربندی |
|---|---|
| بدون احراز هویت | `"auth": null` |
| Bearer از env | `{ "header": "Authorization", "value": "Bearer ${EXAMPLE_API_KEY}" }` |
| هدر دلخواه | `{ "header": "x-api-key", "value": "${EXAMPLE_API_KEY}" }` |
| میان‌بر env | `{ "header": "Authorization", "env": "EXAMPLE_API_KEY" }` (پیشوند `Bearer ` خودکار) |
| پیشوند سفارشی | `{ "header": "Authorization", "env": "K", "prefix": "Token " }` |

**کلید را هرگز داخل `providers.json` ننویسید** (ریپو عمومی است). از
`${VAR}` استفاده کنید و مقدار را در محیط بگذارید:

```bash
EXAMPLE_API_KEY=sk-… npm run standalone
# یا در .env (که در .gitignore است)
```

`npm run verify` اگر مقدار لفظیِ شبیه کلید (`sk-…` طولانی) در رجیستری ببیند
**خطا** می‌دهد. اگر مقدار پیش‌فرض می‌خواهید: `${EXAMPLE_API_KEY:-fallback}`.

### هدرهای «مرورگر‌نما» برای سایت‌های محافظت‌شده

بعضی سرویس‌های رایگان فقط درخواستِ شبیه مرورگر را قبول می‌کنند. نمونهٔ واقعیِ
همین پروژه در `providers.json` (پروایدر `freemodels`):

```jsonc
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
  "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "cross-site",
  "Accept-Encoding": "identity"
}
```

`Accept-Encoding: identity` را نگه دارید — فشرده‌سازی پاسخ، استریم SSE را
بافر می‌کند و «تکه‌تکه آمدن» پاسخ از بین می‌رود.

---

## Step 2 — اول آفلاین تست کنید (بدون ریسک)

پروژه یک آپستریم ساختگی دارد که هر شکل پاسخی را تقلید می‌کند:

```bash
npm run dev:mock          # Next + آپستریم ساختگی + ۶ پروایدر آزمایشی
npm run dev:mock:appjs    # همان با نسخهٔ تک‌فایل
npm run smoke -- --base http://127.0.0.1:3000
```

`scripts/lib/test-config.mjs` را ببینید: نمونهٔ زندهٔ هر قابلیت
(شکل openai / freemodels / فیلد سفارشی / پاسخ سبک Claude / خطای 429 / alias).
کپی‌کردن از روی آن سریع‌ترین راهِ ساختن پروایدر جدید است.

سپس با آپستریم واقعی:

```bash
export EXAMPLE_API_KEY=sk-…
npm run standalone
curl -s localhost:3000/api/ping?model=example-large | head -c 300     # اتصال + نمونهٔ پاسخ
curl -sN localhost:3000/v1/chat/completions \
  -H "authorization: Bearer $(node -p "require('./api-keys.json').openai")" \
  -H 'content-type: application/json' \
  -d '{"model":"example-large","stream":true,"messages":[{"role":"user","content":"سلام"}]}'
```

`GET /api/ping?model=…` همان پروایدرِ آن مدل را با یک درخواست واقعی می‌آزماید
و زمان پاسخ، کد وضعیت و بخشی از بدنه را برمی‌گرداند — بهترین ابزار تشخیص.

---

## Step 3 — همگام‌سازی و اعتبارسنجی

```bash
npm run sync:builtin    # کپی رجیستری داخل app.js بازسازی می‌شود
npm run verify          # ساختار، auth، یکتایی id، همگامی دو نسخه
npm run smoke           # آزمون رفتاری (۳۰ مورد)
npm run docs:sync       # بلوک‌های GENERATED در README/HANDOFF/AI-GUIDE
```

اگر لوگوی تازه‌ای برای مدل‌ها گذاشتید: `npm run embed:logos`
(→ [`add-model`](../add-model/SKILL.md) § ۳).

---

## Step 4 — اجرا با رجیستریِ جدا (اختیاری)

برای پروایدرهای شخصی/محرمانه که نمی‌خواهید در ریپو باشند، یک فایل JSON جدا
بسازید و با env نشانش دهید (هر دو نسخه پشتیبانی می‌کنند):

```bash
FM_PROVIDERS_FILE=/secrets/my-providers.json npm run standalone
FM_PROVIDERS_FILE=/secrets/my-providers.json npm run dev
```

یا فقط بعضی پروایدرهای موجود را روشن/خاموش کنید:

```bash
FM_ENABLE_PROVIDERS=mock,example npm run standalone     # این‌ها اجباراً فعال می‌شوند
FM_DISABLE_PROVIDERS=freemodels npm run standalone      # این‌ها خاموش می‌شوند
```

> در نسخهٔ Next، کلاینت کاتالوگ را بعد از mount از `GET /api/models` می‌گیرد،
> پس همین کلیدهای محیطی در UI هم اثر می‌کنند. در نسخهٔ تک‌فایل، کاتالوگ در
> خودِ HTML تزریق می‌شود.
> **هشدار:** اگر `FM_PROVIDERS_FILE` به فایل ناموجود اشاره کند، اپ با کپی
> داخلی (`BUILTIN_PROVIDERS`) بالا می‌آید و یک خطِ هشدار در لاگ می‌زند.

---

## When config is NOT enough — چه زمانی کد لازم است

فقط در این حالت‌ها باید کد بنویسید (→ [`add-feature`](../add-feature/SKILL.md)):

1. آپستریم **اصلاً SSE نیست** (مثلاً WebSocket یا پروتکل اختصاصی).
2. متن پاسخ در ساختاری تودرتو/غیرمعمول است که با `textFields` بیرون نمی‌آید.
3. نیاز به **امضای درخواست** (HMAC)، توکن چندمرحله‌ای، یا refresh token دارید.
4. پاسخ باید **تبدیل** شود (مثلاً آپستریم آرایه‌ای از گزینه‌ها برمی‌گرداند).

جای تغییر در هر دو نسخه:

| نسخه | پارسر پاسخ | اتصال به آپستریم |
|---|---|---|
| Next.js | `src/lib/sse.ts` | `src/lib/upstream.ts` |
| app.js | `makeUpstreamParser` | `openUpstream` |

قانون طلایی: تغییر در یکی ⇒ معادلش در دیگری + آزمون تازه در `scripts/smoke.mjs`.

---

## Pitfalls — دام‌ها

| دام | علامت | راه‌حل |
|---|---|---|
| هدرهای مرورگر ناقص | 403/403 Cloudflare | `Origin`/`Referer`/`User-Agent`/`sec-*` را از DevTools کپی کنید |
| `Accept-Encoding` حذف شده | پاسخ یک‌جا و دیر می‌آید | `"Accept-Encoding": "identity"` |
| `timeoutMs` کم | 504 برای مدل‌های استدلالی | ۱۲۰۰۰۰–۱۸۰۰۰۰ |
| id آپستریم ≠ id عمومی | 404/400 «model not found» | `upstreamId` را بگذارید |
| کلید داخل JSON | نشت در ریپو عمومی | `${VAR}` + `verify` |
| `shape` اشتباه | آپستریم فیلدها را نمی‌شناسد | با `curl` شکل بدنه را مقایسه کنید؛ از mock کمک بگیرید |
| گروه بدون `groups` | مدل در «Other» | عنوان گروه را در `groups` همان پروایدر تعریف کنید |
| `sync:builtin` فراموش شد | نسخهٔ تک‌فایل پروایدر جدید را ندارد | همیشه بعد از ویرایش JSON |
| دو پروایدر با مدلِ هم‌نام | اولی برنده است | id یکتا؛ `verify` می‌گیردش |
| تست روی شبکهٔ بسته (سندباکس) | همه‌چیز 502 | اول `dev:mock`؛ بعد روی ماشین با اینترنت |
| انتظار restart لازم | — | hot reload فعال است (۱ ثانیه)؛ فقط صفحهٔ UI را refresh کنید |

---

## Verify — چک‌لیست پایانی

- [ ] `npm run verify` بدون خطا (auth با `${VAR}`، shape مجاز، id یکتا، همگامی `BUILTIN_PROVIDERS`)
- [ ] `npm run smoke` سبز
- [ ] `GET /api/ping?model=<مدل جدید>` → `status: "ok"` با `provider` درست
- [ ] `GET /v1/models` → مدل‌های پروایدر جدید با `owned_by` = `<prefix>-<vendor-slug>`
- [ ] `GET /api/models` → گروه/لوگو/نام درست برای UI
- [ ] استریم واقعی: تکه‌تکه می‌آید، `finish_reason:"stop"` و `[DONE]` دارد
- [ ] خطای آپستریم درست نگاشت می‌شود (کلید غلط ← 401/403، سقف نرخ ← 429)
- [ ] `npm run docs:sync` اجرا شد و `download/` همگام است

---

## Related — مرتبط

- [`add-model`](../add-model/SKILL.md) — افزودن مدل به همین پروایدر
- [`debug-stream`](../debug-stream/SKILL.md) — وقتی وصل شد ولی خروجی خراب است
- [`add-feature`](../add-feature/SKILL.md) — وقتی پارسر/اتصال باید کد بگیرد
- [`edit-appjs`](../edit-appjs/SKILL.md) — ساختار `app.js` و `BUILTIN_PROVIDERS`
- `docs/providers.schema.json` — اسکیمای کامل و توضیح هر فیلد
- `scripts/lib/test-config.mjs` — نمونهٔ زندهٔ همهٔ قابلیت‌های رجیستری
