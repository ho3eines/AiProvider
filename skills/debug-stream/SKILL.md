---
name: debug-stream
description: راهنمای تشخیص و رفع اشکالِ پاسخ/استریم (SSE)، پروکسی آپستریم، خطاهای 4xx/5xx و مشکلات پیکر مدل — با دستورهای آمادهٔ curl، جدول «علامت ← علت ← راه‌حل» و ابزار آپستریم ساختگی.
---

# Debug Stream — تشخیص اشکال پاسخ و استریم

## When to use — چه زمانی

- پاسخ خالی/ناقص/بریده می‌آید، یا یک‌جا و دیر می‌آید (تکه‌تکه نیست).
- `502`/`504`/`429`/`403` می‌بینید.
- «فرایند تفکر» با متن قاطی می‌شود یا اصلاً نمی‌آید.
- `finish_reason`/`[DONE]`/`usage` در استریم نیست.
- مدل در UI هست ولی API آن را نمی‌شناسد (یا برعکس).
- مرورگر خطای CORS می‌دهد.

---

## First 60 seconds — تریاژ سریع

```bash
# 0) سرور بالا است؟ لاگ‌ها چه می‌گویند؟ (رنگ‌ها: سبز=موفق، قرمز=خطا، زرد=هشدار)
# 1) رجیستری درست خوانده شده؟
curl -s localhost:3000/api/models | node -p "JSON.parse(require('fs').readFileSync(0)).models.map(m=>m.id).join(', ')"

# 2) اتصال به آپستریمِ همان مدل (status/ms/sample/provider/model)
curl -s "localhost:3000/api/ping?model=claude-fable-5.1" | node -p "JSON.stringify(JSON.parse(require('fs').readFileSync(0)),null,1)"

# 3) استریم خام از API سازگار OpenAI
curl -sN localhost:3000/v1/chat/completions \
  -H "authorization: Bearer $(node -p "require('./api-keys.json').openai")" \
  -H 'content-type: application/json' \
  -d '{"model":"claude-fable-5.1","stream":true,"stream_options":{"include_usage":true},"messages":[{"role":"user","content":"سلام"}]}'

# 4) استریم خام از API سازگار Anthropic
curl -sN localhost:3000/v1/messages \
  -H "x-api-key: $(node -p "require('./api-keys.json').anthropic")" \
  -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \
  -d '{"model":"claude-fable-5.1","max_tokens":512,"stream":true,"messages":[{"role":"user","content":"سلام"}]}'

# 5) مسیر UI (پروکسی مستقیم SSE آپستریم)
curl -sN localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"modelId":"claude-fable-5.1","stream":true,"messages":[{"role":"user","content":"سلام"}]}'

# 6) آزمون‌های خودکار (بدون اینترنت) — بسیاری از اشکال‌ها را خودشان لو می‌دهند
npm run smoke
```

`GET /api/ping` بهترین نقطهٔ شروع است: یک درخواست واقعی کوچک به **همان
پروایدرِ** مدل می‌زند و اینها را برمی‌گرداند:

| فیلد | معنا |
|---|---|
| `status` | `ok` یا `error` |
| `ms` | زمان رفت‌وبرگشت (برای تنظیم `timeoutMs`) |
| `sample` | تا ۲۰۰ کاراکتر از پاسخ/خطا — اغلب علت را همین‌جا می‌بینید |
| `provider` | کدام پروایدر انتخاب شد (اگر اشتباه است → رجیستری/`resolveModel`) |
| `model` | id عمومیِ تطبیق‌خورده |

---

## Symptom → Cause → Fix

### اتصال

| علامت | علت محتمل | راه‌حل |
|---|---|---|
| `502 اتصال به سرویس چت برقرار نشد` + `ECONNREFUSED`/`ENOTFOUND` | آپستریم خاموش/آدرس اشتباه/بدون اینترنت | `upstream.url` را با `curl -i` مستقیم تست کنید |
| `502` + `socket disconnected before secure TLS` | TLS/SNI/پروکسی سازمانی | در سندباکس/شبکهٔ بسته طبیعی است → با `npm run dev:mock` تست کنید |
| `504` بعد از دقیقاً N ثانیه | `timeoutMs` کم برای مدل استدلالی | `upstream.timeoutMs` را بالا ببرید (۱۲۰۰۰۰–۱۸۰۰۰۰) |
| `403` + بدنهٔ HTML | سایت هدرهای مرورگر می‌خواهد | `Origin`/`Referer`/`User-Agent`/`sec-*` را در `upstream.headers` بگذارید |
| `401/403` از آپستریم | `upstream.auth` یا متغیر محیطی ست نشده | `echo $MY_KEY`؛ `${VAR}` در رجیستری |
| همه‌چیز کار می‌کند جز یک مدل | `upstreamId` لازم است | `"upstreamId": "نام-واقعی-در-آپستریم"` |

### استریم

| علامت | علت | راه‌حل |
|---|---|---|
| پاسخ یک‌جا و در پایان می‌آید | `Accept-Encoding: gzip` یا پروکسی بافرکننده | هدر `"Accept-Encoding": "identity"`؛ هدرهای پاسخ ما باید `Cache-Control: no-store, no-transform` و `X-Accel-Buffering: no` باشند |
| `200` ولی متن خالی | فیلد متنی آپستریم ناشناخته | `response.textFields: ["output","answer"]` |
| متن و تفکر قاطی | فیلد تفکر ناشناخته | `response.reasoningFields: ["thought","reasoning"]` |
| `finish_reason` نیست | پرچم پایان **قبل از** ارسال چانک پایانی ست شده | در `handleOpenAI`/`endStream`: اول `chunk({}, 'stop')` بعد `finished = true` (اشکال واقعیِ رفع‌شده) |
| `[DONE]` زودتر از متن | `doneToken` اشتباه یا آپستریم نشانهٔ دیگری دارد | `response.doneToken` |
| `usage` در استریم نیست | کلاینت `stream_options.include_usage` نفرستاده | در `curl`/کلاینت اضافه کنید؛ اپ UI خودش می‌فرستد |
| استریم نصفه قطع می‌شود | timeout سوکت یا `safeDestroy` زودهنگام | لاگ `POST /api/chat ✓ تمام شد (Nms)` را با زمان واقعی مقایسه کنید |
| هیچ رویداد Anthropic نمی‌آید | پارسرِ مسیر `/v1/messages` ورودی نگرفت | ابتدا `/api/chat` را تست کنید تا معلوم شود مشکل از آپستریم است یا لایهٔ سازگاری |

### API و کلیدها

| علامت | علت | راه‌حل |
|---|---|---|
| `401 invalid_api_key` | کلید اشتباه/هدر اشتباه | `Authorization: Bearer <openai>` یا `x-api-key: <anthropic>`؛ هر دو کلید روی هر دو endpoint پذیرفته می‌شوند |
| کلیدها عوض شدند | `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` در env بر `api-keys.json` اولویت دارند | env را خالی کنید یا به‌روز کنید |
| `400 max_tokens: Field required` | الزام Anthropic | در `/v1/messages` همیشه `max_tokens` بفرستید |
| `413` | بدنه بزرگ‌تر از `maxBodyBytes` | `defaults.maxBodyBytes` یا `upstream.maxBodyBytes` |
| `404 — مسیر یافت نشد` | endpoint اشتباه | فهرست مسیرها: `curl -s localhost:3000/api/models` و بلوک `endpoints` در README |
| `429` از ما | آپستریم سقف نرخ داده | همان کد/فرمت به کلاینت برمی‌گردد (نگاشت درست است)؛ پروایدر دوم اضافه کنید |

### UI

| علامت | علت | راه‌حل |
|---|---|---|
| مدل جدید در پیکر نیست | کاتالوگ فقط یک‌بار بعد از mount گرفته می‌شود | صفحه را refresh کنید؛ `GET /api/models` را مستقیم چک کنید |
| مدل در UI هست، API نمی‌شناسد | پروایدر `enabled: false` است یا رجیستری دو نسخه همگام نیست | `npm run verify` و `npm run sync:builtin` |
| لوگو ۴۰۴ در نسخهٔ تک‌فایل | در `EMBEDDED_LOGOS` نیست | `npm run embed:logos` |
| کنسول مرورگر خطای JS | `PAGE_JS` خراب (backtick/`${`) | `npm run verify` (بلوک را استخراج و چک می‌کند) |
| خطای CORS در مرورگر | `OPTIONS` پاسخ نگرفت | هر `OPTIONS` باید `204` با `Access-Control-Allow-Origin: *` بدهد |
| پیام‌ها بعد از refresh رفتند | `localStorage` پاک/مرورگر دیگری | چت‌ها در `localStorage` همان مرورگرند |

---

## Tools — ابزارها

### آپستریم ساختگی (بدون اینترنت، بدون ریسک)

```bash
npm run mock                 # فقط آپستریم روی ۴۱۰۰
npm run dev:mock             # Next + mock + ۶ پروایدر آزمایشی
npm run dev:mock:appjs       # نسخهٔ تک‌فایل + mock
```

بدنهٔ درخواست به mock کنترلش می‌کند چه برگرداند (این کلیدها را در
`request.constants` پروایدر آزمایشی بگذارید):

| کلید | اثر |
|---|---|
| `mock_shape: "openai"` | SSE سبک OpenAI (پیش‌فرض) |
| `mock_shape: "claude"` | SSE سبک Claude (`content_block_delta`) |
| `mock_shape: "custom"` | فیلدهای سفارشی (`output`/`thought`) |
| `mock_error: 429` | همان کد وضعیت با بدنهٔ خطا |
| `stream: true/false` | استریم یا JSON معمولی |
| `thinking: true` | چانک‌های «تفکر» هم می‌فرستد |
| `mock_chunks: 20` | تعداد تکه‌های پاسخ |
| `mock_delay_ms: 200` | تأخیر بین تکه‌ها — برای دیدن «آیا واقعاً تکه‌تکه می‌آید؟» |

> **آزمون بافرینگ:** با `mock_chunks: 10` و `mock_delay_ms: 500` یک درخواست
> استریم بزنید و ببینید آیا تکه‌ها با فاصله می‌رسند یا همه یک‌جا در پایان.
> اگر یک‌جا رسیدند ← مشکل از هدرهای فشرده‌سازی/بافرینگ است (جدول بالا).

پاسخ mock شامل **کلیدهای دریافتی** است — بهترین راه برای دیدن اینکه
`buildUpstreamPayload` دقیقاً چه بدنه‌ای ساخته:

```bash
curl -s localhost:3000/v1/chat/completions -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"model":"mock-fm","thinking":true,"messages":[{"role":"user","content":"hi"}]}' | head -c 400
```

### پنل «دیتای خام استریم» در UI

دکمهٔ 📡 در نوار بالا → تمام بایت‌های SSE که کلاینت گرفته، با شمارندهٔ بایت.
برای مقایسهٔ «چه چیزی از آپستریم آمد» و «چه چیزی نمایش داده شد» عالی است.

### مقایسهٔ دو نسخه

```bash
npm run smoke                                      # app.js
npm run dev:mock &  sleep 5
npm run smoke -- --base http://127.0.0.1:3000      # Next
```

اگر یک آزمون در یکی پاس و در دیگری شکست → نابرابریِ نسخه‌هاست، نه مشکل
آپستریم. (→ [`add-feature`](../add-feature/SKILL.md) § برابری)

---

## Reading the logs — خواندن لاگ‌ها

الگوی لاگ هر درخواست (هر دو نسخه):

```
[hh:mm:ss] POST /api/chat ← [freemodels/claude-fable-5.1] آپستریم پاسخ داد: 200
[hh:mm:ss] POST /api/chat ✓ تمام شد (1234ms)
```

- `← [provider/model]` : نتیجهٔ `resolveModel` — اگر پروایدر اشتباه است، رجیستری را ببینید.
- `آپستریم پاسخ داد: NNN` : کد وضعیت واقعی آپستریم (نه آنچه کلاینت می‌بیند).
- قرمز `error [provider]: …` : علت اتصال/پارس.
- `GET /api/keys → 200` و `GET /api/models → 200 (N مدل / M گروه)` : سلامت رجیستری.

---

## Where to patch — اگر اشکال در کد بود

| لایه | Next.js | app.js |
|---|---|---|
| ساخت بدنهٔ درخواست | `src/lib/catalog.ts` → `buildUpstreamPayload` | `buildUpstreamPayload` |
| اتصال/هدرها | `src/lib/upstream.ts` | `openUpstream`, `upstreamOptions` |
| پارسر پاسخ/استریم | `src/lib/sse.ts` | `makeUpstreamParser` |
| نگاشت خطا | `src/lib/v1.ts` | `openaiError`, `anthropicError` |
| لایهٔ OpenAI | `src/app/v1/chat/completions/route.ts` | `handleOpenAI` |
| لایهٔ Anthropic | `src/app/v1/messages/route.ts` | `handleAnthropic` |
| پروکسی UI | `src/app/api/chat/route.ts` | `handleChat` |

هر تغییر در یکی ⇒ معادل در دیگری + آزمون تازه در `scripts/smoke.mjs`.

---

## Related — مرتبط

- [`add-provider`](../add-provider/SKILL.md) — وقتی باید shape/هدر/فیلدها را عوض کنید
- [`edit-appjs`](../edit-appjs/SKILL.md) — درس‌های اشکال‌های واقعی (TDZ، ترتیب `finished`)
- [`add-feature`](../add-feature/SKILL.md) — افزودن آزمون/بررسی خودکار
- `scripts/smoke.mjs` — ۳۰ آزمون رفتاری آماده
