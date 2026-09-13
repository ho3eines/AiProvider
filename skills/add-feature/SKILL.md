---
name: add-feature
description: افزودن قابلیت تازه یا رفع اشکال به‌شکلی که هر دو نسخهٔ اپ (Next.js در src/ و تک‌فایل app.js) هم‌زمان و هم‌رفتار بمانند — شامل نقشهٔ «کجا چه چیزی است»، ترتیب کار، و چگونگی افزودن آزمون و بررسی خودکار.
---

# Add a Feature — قابلیت جدید در هر دو نسخه

## When to use — چه زمانی

- قابلیت تازه در UI (پنل، تنظیم، نمایش جدید) یا API (endpoint، فیلد، رفتار).
- رفع اشکالی که در یکی از نسخه‌ها دیده‌اید (احتمالاً در دیگری هم هست).
- هر تغییری که **فقط** با `providers.json` انجام نمی‌شود
  (وگرنه → [`add-model`](../add-model/SKILL.md) / [`add-provider`](../add-provider/SKILL.md)).

## The golden rule — قانون طلاییِ برابری

> هر قابلیت یا رفع اشکال در `src/` باید معادلش در `app.js` باشد، و برعکس.
> دو نسخه دو محصول نیستند؛ یک محصول با دو بسته‌بندی‌اند. هر تفاوت = باگِ
> گزارش‌نشده.

چرا سخت است: `app.js` همه‌چیز را در یک فایل دارد و UI‌اش داخل یک
`String.raw` است (→ [`edit-appjs`](../edit-appjs/SKILL.md)). پس «کپی‌کردن کد»
معمولاً ممکن نیست؛ باید **رفتار** را بازنویسی کنید.

---

## Map — کجا چه چیزی است

| حوزه | نسخهٔ Next.js | نسخهٔ app.js (الگوی جست‌وجو) |
|---|---|---|
| رجیستری/کاتالوگ | `src/lib/catalog.ts` (ایزومورفیک) | `BUILTIN_PROVIDERS`, `getProviders`, `resolveModel`, `buildUpstreamPayload`, `publicCatalog` |
| خواندن زندهٔ رجیستری | `src/lib/providers.ts` | `readProvidersConfig`, `PROVIDERS_RELOAD_MS`, `withEnvToggles` |
| اتصال به آپستریم | `src/lib/upstream.ts` | `openUpstream`, `upstreamOptions` |
| پارسر پاسخ/استریم | `src/lib/sse.ts` | `makeUpstreamParser(onDelta, opts)` |
| لایهٔ OpenAI/Anthropic | `src/lib/v1.ts` | `getBearerToken`, `openaiError`, `anthropicError`, `flattenContent`, `readStreamText` |
| Markdown | `src/lib/markdown.ts` | داخل `PAGE_JS` (`renderMarkdown`) |
| کلیدهای API | `src/lib/apikeys.ts` | `loadOrCreateKeys`, `API_KEYS`, `keyIsValid` |
| صفحهٔ چت | `src/app/page.tsx` | `PAGE_HTML` + `PAGE_CSS` + `PAGE_JS` |
| چت UI (پروکسی) | `src/app/api/chat/route.ts` | `handleChat` |
| کاتالوگ زندهٔ UI | `src/app/api/models/route.ts` | `handleCatalog` |
| کلیدها برای UI | `src/app/api/keys/route.ts` | `handleKeys` |
| تست اتصال | `src/app/api/ping/route.ts` | `handlePing` |
| `/v1/models` | `src/app/v1/models/route.ts` | `handleModels` |
| `/v1/chat/completions` | `src/app/v1/chat/completions/route.ts` | `handleOpenAI` |
| `/v1/messages` | `src/app/v1/messages/route.ts` | `handleAnthropic` |
| روتر/CORS | middleware داخل routeها (`OPEN_CORS`, `V1_CORS`) | `const server = http.createServer(...)` (هر `OPTIONS` → ۲۰۴) |
| پایگاه داده (اختیاری) | `src/lib/db.ts` + `prisma/` | — (در نسخهٔ تک‌فایل نیست) |

---

## Workflow — ترتیب کار

### 1) ابتدا در `src/` بنویسید (نسخهٔ نوع‌دار)

- منطق قابل اشتراک → `src/lib/*.ts`؛ endpoint → `src/app/**/route.ts`؛
  UI → `src/app/page.tsx`.
- هر فایل `route.ts` این دو خط را داشته باشد (وگرنه build به‌سمت edge می‌رود):
  ```ts
  export const runtime = 'nodejs';
  export const dynamic = 'force-dynamic';
  ```
- **مدل‌ها را سخت‌کد نکنید**؛ از `@/lib/catalog` بخوانید (`verify` می‌گیردش).
- هدرهای CORS را از `OPEN_CORS`/`V1_CORS` بگیرید، دستی ننویسید.
- خطاها را با helperها برگردانید (`jsonError`, `openaiError`, `anthropicError`)
  تا فرمت خطا سازگار بماند.

```bash
npm run typecheck && npm run lint
```

### 2) معادلش را در `app.js` بنویسید

- کد سرور: کنار handlerهای مشابه، با همان سبک (CommonJS مدرن، `sendJson`،
  `logReq`).
- کد کلاینت: داخل `PAGE_JS` با **گویش ES5** و قواعد `String.raw`
  (→ [`edit-appjs`](../edit-appjs/SKILL.md) § قواعد سخت).
- endpoint جدید ⇒ ورودی تازه در روتر + معادل `route.ts` در Next.
- اگر رجیستری عوض شد: `npm run sync:builtin`.

```bash
node --check app.js
```

### 3) نابرابری‌های پنهان را ببندید

قبل از ادامه، این فهرست را مرور کنید (هر مورد سابقهٔ دریفت داشته):

- [ ] فرمت خطا یکسان (کد وضعیت + `error.type`/`error.code`)
- [ ] هدرهای پاسخ یکسان (`Content-Type`, `Cache-Control`, `X-Accel-Buffering`, CORS)
- [ ] ترتیب چانک‌های استریم یکسان: نقش → deltaها → `finish_reason`/`stop_reason`
      → usage (در صورت `include_usage`) → `[DONE]`
- [ ] رفتار ورودیِ ناشناخته یکسان (مدل ناشناخته ← پروایدر پیش‌فرض)
- [ ] سقف بدنه و `413` یکسان
- [ ] نام آیکن‌ها/کلیدهای UI یکسان

### 4) آزمون اضافه کنید — `scripts/smoke.mjs`

هر رفتار جدید باید یک آزمون داشته باشد، وگرنه دفعهٔ بعد بی‌صدا می‌شکند.

```js
await test('عنوان آزمون — انتظار روشن', async () => {
  const r = await fetch(BASE + '/api/foo', { method: 'POST', headers: JSON_H, body: JSON.stringify({ … }) });
  assert(r.status === 200, `status=${r.status}`);
  const j = await r.json();
  assert(j.ok === true, JSON.stringify(j).slice(0, 120));
  return 'توضیح کوتاه اختیاری';   // در خروجی ✓ چاپ می‌شود
}, 'mock-echo');   // ← آرگومان سوم اختیاری: id مدلی که باید فعال باشد (وگرنه ⊘ رد می‌شود)
```

- از آپستریم ساختگی استفاده کنید (`mock-echo`, `mock-fm`, `mock-custom`,
  `mock-claude`, `mock-429`, `mock-alias`) تا آزمون به اینترنت نیاز نداشته
  باشد. قابلیتِ جدیدِ رجیستری لازم دارد؟ یک پروایدر آزمایشی به
  `scripts/lib/test-config.mjs` اضافه کنید — هم smoke و هم `dev:mock` از آن
  استفاده می‌کنند.
- برای استریم از `readSse(res)` استفاده کنید (ضرب‌العجل دارد؛ hang نمی‌شود).

```bash
npm run smoke                                     # نسخهٔ تک‌فایل
npm run smoke -- --base http://127.0.0.1:3000     # روی dev:mock (نسخهٔ Next)
```

**هر دو را اجرا کنید.** اگر یکی پاس و دیگری شکست → همان نابرابری است.

### 5) بررسی خودکار اضافه کنید — `scripts/verify.mjs`

اگر قواعدِ «باید همیشه درست باشد» اضافه کردید (مثلاً هر دو نسخه باید فلان
تابع/مسیر را داشته باشند)، در `verify.mjs` یک بررسی بگذارید:

```js
section('نام بخش');
if (/الگو/.test(appSrc)) ok('app.js: فلان دارد');
else fail('app.js: فلان را ندارد — معادل src/ نیست');
```

`verify` ساختار/همگامی را می‌سنجد، `smoke` رفتار را. از هر دو استفاده کنید.

### 6) مستندات

```bash
npm run docs:sync     # بلوک‌های GENERATED در README/HANDOFF/AI-GUIDE + کپی download/
npm run verify        # باید بدون خطا تمام شود
```

اگر endpoint یا متغیر محیطی تازه‌ای اضافه شد، بلوک‌های `endpoints`/`env` را
خودِ `docs:sync` از روی کد/رجیستری پر می‌کند؛ اما **توضیح فارسی** هر مورد در
`scripts/docs-sync.mjs` نوشته می‌شود → همان‌جا اضافه‌اش کنید
(→ [`update-docs`](../update-docs/SKILL.md)).

---

## Definition of done — تعریف «تمام شد»

```bash
npm run typecheck   # بدون خطا
npm run lint        # بدون خطا (هشدار قابل قبول)
npm run check:appjs # node --check app.js
npm run verify      # بدون خطا
npm run smoke       # همه پاس (app.js)
npm run dev:mock    # و دوباره smoke --base → همه پاس (Next)
npm run docs:sync   # اسناد به‌روز + download/ همگام
```

به‌علاوهٔ دستی: یک چت واقعی در UI (با `dev:mock` هم می‌شود) — پاسخ تکه‌تکه
می‌آید، «فرایند تفکر» جدا نمایش داده می‌شود، دکمهٔ توقف کار می‌کند، و در
کنسول مرورگر خطایی نیست.

---

## Pitfalls — دام‌ها

| دام | نتیجه | راه‌حل |
|---|---|---|
| فقط یکی از نسخه‌ها تغییر کرد | رفتار متفاوت در استقرارهای مختلف | قانون طلایی + smoke روی هر دو |
| `set-state` داخل `useEffect` در `page.tsx` | هشدار lint | الگوی پروژه: state را در `useEffect` با guard بنویسید (قاعدهٔ `react-hooks/set-state-in-effect` در `eslint.config.mjs` خاموش است، ولی بی‌دلیل حالت نسازید) |
| فراموشی `runtime = 'nodejs'` | build روی edge می‌رود و `fs` می‌شکند | دو خط export در هر route |
| منطق مشترک را در route کپی کردید | دریفت تدریجی | منطق در `src/lib/*` و در `app.js` در توابع بالا |
| تست دستیِ بدون اینترنت | 502 و تشخیص اشتباه | `npm run dev:mock` |
| تغییر `PAGE_JS` بدون `node --check` و مرورگر | صفحهٔ سفید | `verify` + بازکردن صفحه |
| `pkill -f app.js` | کشته‌شدن شل خودتان | `pkill -f "AiProvider/ap[p].js"` |

---

## Related — مرتبط

- [`edit-appjs`](../edit-appjs/SKILL.md) — قواعد سختِ `app.js`
- [`debug-stream`](../debug-stream/SKILL.md) — وقتی رفتار استریم درست نیست
- [`update-docs`](../update-docs/SKILL.md) — بلوک‌های GENERATED
- `HANDOFF.md` — وضعیت جاری و فهرست کارهای باقی‌مانده
- `scripts/smoke.mjs`, `scripts/verify.mjs`, `scripts/lib/test-config.mjs`
