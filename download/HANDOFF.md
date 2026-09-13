# سند تحویل پروژه — Project Handoff

> **دستورالعمل تحویل به توسعه‌دهنده/ایجنت بعدی | Handoff Brief for the Next Developer/Agent**
> تاریخ: ۱۳ سپتامبر ۲۰۲۶ (۲۲ شهریور ۱۴۰۵) · نسخهٔ سند: ۲.۰
> این سند مکمل `README.md` (داکیومنت کامل)، `AI-GUIDE.md` (راهنمای عمیق لایهٔ AI)
> و `skills/` (دفترچهٔ عملیات تغییرات) است؛ `worklog.md` گزارش خام تسک‌هاست.

---

## 1. TL;DR | خلاصهٔ تحویل

**چت هوشمند (AiProvider)** یک اپ چت AI فارسی (RTL، تم تاریک) است که به سرویس‌های
چت رایگان وصل می‌شود و هم‌زمان **API سازگار با OpenAI و Anthropic** ارائه
می‌دهد. دو نسخهٔ معادل دارد: (۱) اپ Next.js 16 در `src/` و (۲) فایل تک‌فایل
Node خالص `app.js` بدون هیچ وابستگی.

از نسخهٔ ۲.۰، **همهٔ پروایدرها/مدل‌ها/آپستریم‌ها در یک رجیستری واحد به نام
`providers.json`** تعریف می‌شوند و هر دو نسخه آن را در زمان اجرا با hot reload
می‌خوانند. یعنی افزودن مدل جدید یا وصل‌کردن یک سایت دیگر **بدون نوشتن کد**
انجام می‌شود.

<!-- GENERATED:counts -->
**پروایدرهای فعال:** 1 · **مدل‌ها:** 7 · **گروه‌های پیکر:** 3 · **روت‌های Next:** 7 · **روت‌های app.js:** 9 · **مدل پیش‌فرض:** `claude-fable-5.1`
<!-- /GENERATED:counts -->

**چهار دستور که همه‌چیز را راه می‌اندازد:**

```bash
bun install && bun run dev   # نسخهٔ Next.js → http://localhost:3000
node app.js                  # نسخهٔ تک‌فایل (PORT/HOST با env)
npm run dev:mock             # محیط آفلاین: آپستریم ساختگی + پروایدرهای آزمایشی
npm run verify && npm run smoke   # صحت‌سنجی ساختار + ۳۰ آزمون رفتاری
```

**قبل از هر تغییر، مهارت مربوط را بخوان** (`skills/README.md` → جدول «کدام
مهارت را بخوانم؟»). خلاصه:

| می‌خواهی… | بخوان |
|---|---|
| مدل اضافه/حذف/ویرایش کنی | `skills/add-model/SKILL.md` |
| به سایت/آپستریم جدید وصل شوی | `skills/add-provider/SKILL.md` |
| قابلیت تازه بنویسی | `skills/add-feature/SKILL.md` |
| `app.js` را دست بزنی | `skills/edit-appjs/SKILL.md` |
| اشکال استریم/خطا را پیدا کنی | `skills/debug-stream/SKILL.md` |
| مستندات را به‌روز کنی | `skills/update-docs/SKILL.md` |

---

## 2. Where Things Live | نقشهٔ مسیرها

| What | Where |
|---|---|
| **رجیستری (منبع حقیقت)** | `providers.json` + اسکیمای `docs/providers.schema.json` |
| کپی داخلی رجیستری در نسخهٔ تک‌فایل | `BUILTIN_PROVIDERS` در `app.js` — با `npm run sync:builtin` بازسازی می‌شود (دستی نه!) |
| خواندن/نرمال‌سازی رجیستری | `src/lib/catalog.ts` (ایزومورفیک: سرور + کلاینت) |
| خواندن زندهٔ رجیستری (hot reload) | `src/lib/providers.ts` (Next) · `getProviders()`/`readProvidersConfig()` در `app.js` |
| انتخاب پروایدر از روی مدل | `resolveModel()` در `catalog.ts` / `app.js` |
| ساخت بدنهٔ آپستریم | `buildUpstreamPayload()` در `catalog.ts` / `app.js` |
| اتصال به آپستریم | `src/lib/upstream.ts` · `openUpstream()` در `app.js` |
| پارسر جهان‌شمول SSE | `src/lib/sse.ts` · `makeUpstreamParser()` در `app.js` |
| لایهٔ سازگاری OpenAI/Anthropic | `src/lib/v1.ts` · helperها در `app.js` |
| رندر مارک‌داون امن | `src/lib/markdown.ts` · `renderMarkdown()` در `PAGE_JS` |
| کلیدها | `api-keys.json` (+ `src/lib/apikeys.ts` / `loadOrCreateKeys()` در `app.js`) |
| UI چت (Next) | `src/app/page.tsx` (client component) + `layout.tsx` + `globals.css` + `error.tsx` |
| UI چت (تک‌فایل) | `app.js`: `PAGE_CSS` · `PAGE_JS` · `PAGE_HTML` (با grep پیدایشان کنید، شمارهٔ خط جابه‌جا می‌شود) |
| لوگوها | `public/` + base64 در `EMBEDDED_LOGOS` · ابزار: `npm run embed:logos` |
| ابزارهای کیفیت | `scripts/verify.mjs` · `scripts/smoke.mjs` · `scripts/mock-upstream.mjs` · `scripts/dev-mock.mjs` · `scripts/docs-sync.mjs` · `scripts/sync-builtin.mjs` · `scripts/embed-logos.mjs` · `scripts/lib/test-config.mjs` |
| مهارت‌ها | `skills/*/SKILL.md` |
| انتشار آفلاین | `download/` (کپی `.md` + HTML/PDF + فونت‌ها) |
| تاریخچهٔ کامل کار | `worklog.md` (۸ تسک) |

**آپستریم فعلی:** `https://freemodels-chat.freemodels.workers.dev/` — فقط با
هدرهای مرورگر‌نما (Origin/Referer = `https://freemodels.pro`) پاسخ می‌دهد. این
مقادیر اکنون در `providers.json` (`providers[0].upstream`) هستند، نه در کد.
برای عوض‌کردن/افزودن آپستریم: `skills/add-provider/SKILL.md`.

---

## 3. Critical Gotchas | نکات بحرانی (قبل از دست‌زدن به کد)

این‌ها تصمیم‌های عمدی و تجربه‌شده‌اند؛ نقضشان باگ تولید می‌کند:

1. **منبع یکتا:** فهرست مدل‌ها/پروایدرها فقط در `providers.json`. هیچ لیست
   موازی در `src/` نساز (`npm run verify` می‌گیردش). تنها استثناها: کپی
   `BUILTIN_PROVIDERS` و `MODELS_FALLBACK` داخل `app.js` که خودکار/با
   `sync:builtin` همگام می‌مانند.
2. **برابری دو نسخه:** هر قابلیت/فیکس در `src/` باید معادلش در `app.js` باشد
   و برعکس. بعد از تغییر، `npm run smoke` را روی هر دو اجرا کن
   (یک‌بار مستقیم، یک‌بار با `dev:mock` + `--base`).
3. **در `PAGE_JS` و `PAGE_CSS` داخل `app.js` مطلقاً backtick و `${` و
   `</script>` ننویس.** کل UI داخل `String.raw` است؛ یک backtick اضافه = فایل
   خراب. backtick مارک‌داون با `\x60` ساخته می‌شود. داخل `PAGE_JS` فقط گویش
   **ES5** (`var`/`function`؛ بدون `=>`/`let`/`const`/`?.`/`??`؛ `async` مجاز).
   بعد از هر تغییر: `node --check app.js` (و `npm run verify` که `PAGE_JS` را
   جداگانه استخراج و چک می‌کند).
4. **TDZ را جدی بگیر:** توابع/ثابت‌هایی که رجیستری استفاده می‌کند (`C`,
   `logReq`, `safeDestroy`) باید **بالاتر** از آن تعریف شوند. `node --check`
   این خطا را نمی‌گیرد (زمان اجراست) — `npm run smoke` می‌گیرد.
5. **ترتیب پایان استریم:** اول چانک پایانی (`finish_reason`/`stop_reason`) را
   بفرست، **بعد** پرچم `finished` را ست کن. (باگ واقعی: `endStream` در
   `handleOpenAI` پرچم را اول ست می‌کرد و چانک `finish_reason` هرگز منتشر
   نمی‌شد.)
6. **از `fetch` برای آپستریم استفاده نکن** — fetch ارسال `Origin`/`Referer` را
   ممنوع می‌کند و بعضی آپستریم‌ها بدون آن‌ها رد می‌کنند. `node:https` بماند.
7. **Pipe مستقیم، نه بافر:** استریم تکه‌به‌تکه رد شود
   (`Cache-Control: no-cache, no-store, no-transform` + `X-Accel-Buffering: no`)؛
   `Accept-Encoding: identity` در هدرهای آپستریم بماند. قطع کلاینت ⇒ `destroy`
   آپستریم.
8. **z-index پیکر مدل:** `#topbar` = 55، `#sidebar` = 50، مودال = 60، توست = 70.
   لنگر پاپ‌آپ `right-0` فیزیکی است تا در RTL روی چت باز شود.
9. **hydration:** خواندن `localStorage` (`fm_chats`/`fm_settings`) فقط بعد از
   mount در `useEffect`. کاتالوگ UI هم بعد از mount از `GET /api/models`
   گرفته می‌شود (مقدار اولیه = رجیستری بسته‌بندی‌شده) تا mismatch نشود.
10. **route handlerها:** در هر `route.ts` دو خط `export const runtime =
    'nodejs'` و `export const dynamic = 'force-dynamic'` بماند.
11. **کلیدها:** `api-keys.json` با permission 600؛ env
    (`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`) فایل را override می‌کند؛ هر دو کلید
    روی هر دو اندپوینت `/v1` پذیرفته می‌شوند (عمدی). **کلیدِ آپستریم** را هرگز
    در `providers.json` ننویس — از `${ENV_VAR}` استفاده کن (`verify` می‌گیردش).
12. **`/v1/messages` سخت‌گیر بماند:** `model` و `max_tokens` اجباری (400 با
    پیام `Field required`) — کلاینت‌های Anthropic به این خطاها تکیه دارند.
13. **429 آپستریم باگ نیست** — سهمیهٔ سرویس رایگان است؛ شفاف نمایش داده می‌شود
    (حباب قرمز / همان کد و فرمت استاندارد).
14. **eslint:** `app.js` در `eslint.config.mjs` ignores است؛ برنگردان.
15. **`pkill -f app.js` شلِ خودت را می‌کشد** — از `pkill -f "AiProvider/ap[p].js"`
    استفاده کن.
16. **اسناد:** داخل بلوک‌های `<!-- GENERATED:* -->` دستی ننویس؛ بعد از تغییر
    `npm run docs:sync`. سند را با خروجی UTF-16 کپی نکن (بایت NUL = سند خراب).

---

## 4. Frontend ↔ Backend Contract | قرارداد فرانت-بک

```
POST /api/chat   {messages:[{role,content}], modelId, thinking, deepSearch, stream}
  → استریم SSE آپستریم (pipe مستقیم) یا JSON
  → خطا: {error:{message}} با 413 (بدنه بزرگ) / 502 (اتصال) / 504 (تایم‌اوت)
         یا عبور کد آپستریم (مثلاً 429)

GET /api/models  → {models:[{id,name,vendor,group,logo,providerId}], groups:[{title,icon}], defaultModel}
                   (بدون نشت url/هدر/auth آپستریم)
GET /api/keys    → {openai, anthropic}
GET /api/ping?model=<id> → {status:"ok"|"error", ms, sample(≤200), provider, model}

GET  /v1/models[?extra=1] → OpenAI list (owned_by=<ownedByPrefix>-<vendor-slug>)
POST /v1/chat/completions → chat.completion | chat.completion.chunk + finish_reason + usage + [DONE]
POST /v1/messages         → message | message_start→ping→content_block_*→message_delta→message_stop
OPTIONS *                 → 204 با CORS باز
```

نرمال‌سازی مدل: `resolveModel()` — «Claude Fable 5.1» / «claude_fable 5.1» /
«claude-fable-5.1» همه یکی می‌شوند؛ `aliases` و `upstreamId` از رجیستری؛
ورودی خالی ← مدل پیش‌فرض؛ ورودی ناشناخته ← پروایدر پیش‌فرض با همان id.

---

## 5. Verification Checklist | چک‌لیست صحت‌سنجی (بعد از هر تغییر)

**خودکار (اجباری):**

```bash
npm run verify     # ساختار رجیستری + اسکیمای JSON + همگامی دو نسخه + سلامت سند
npm run smoke      # ۳۰ آزمون رفتاری (بدون اینترنت)
npm run typecheck && npm run lint && npm run check:appjs
```

```bash
npm run dev:mock   # و در ترمینال دوم:
npm run smoke -- --base http://127.0.0.1:3000   # همان آزمون‌ها روی نسخهٔ Next
```

**دستی (curl):**
- [ ] `GET /` → 200 و HTML فارسی RTL
- [ ] `GET /api/models` → مدل‌ها/گروه‌ها (و بدون اطلاعات آپستریم)
- [ ] `GET /api/ping?model=<id>` → `status:"ok"` با `provider` درست
- [ ] `GET /v1/models` با کلید → فهرست کامل؛ بدون کلید → 401؛ با `?extra=1` → group/vendor/logo
- [ ] `POST /v1/chat/completions` استریم → نقش + delta + `finish_reason:"stop"` + `[DONE]`
- [ ] `POST /v1/messages` بدون `max_tokens` → 400؛ با آن → چرخهٔ کامل رویدادها (+ بلوک thinking وقتی `thinking:true`)
- [ ] مسیر ناشناس → 404؛ بدنهٔ بزرگ → 413
- [ ] داغ‌بارگذاری: مدل را به `providers.json` اضافه کن و **بدون restart** در `/api/models` ببین

**مرورگر (هر دو نسخه):**
- [ ] پیکر مدل: گروه‌ها/آیکن‌ها/لوگوها از رجیستری؛ انتخاب مدل ماندگار پس از
      reload؛ بستن با Esc و کلیک بیرون
- [ ] ارسال پیام → استریم زنده + باکس «💭 تفکر» + آمار؛ Esc وسط استریم → «⏹ متوقف شد»
- [ ] پنل 📡 Raw SSE بایت‌ها را نشان می‌دهد
- [ ] ویرایش اینلاین پیام کاربر / بازتولید ↻ / خروجی MD و JSON
- [ ] رفرش → تاریخچه و تنظیمات سر جایشان
- [ ] موبایل 390px: همبرگر، تارگت 44px، کامپوزر چسبان
- [ ] کنسول مرورگر بدون خطا (مخصوصاً بعد از دست‌زدن به `PAGE_JS`)

---

## 6. Task History | تاریخچهٔ تسک‌ها (خلاصهٔ worklog)

| # | تسک | نکتهٔ ماندگار |
|---|---|---|
| 1 | بک‌اند پروکسی + کتابخانه‌های مشترک | تصمیم `node:https` برای هدرهای مرورگر‌نما |
| 2 | فرانت‌اند کامل RTL فارسی | بدون hydration mismatch |
| 3 | تأیید مرورگری end-to-end | استریم ۲۸۶ تکه؛ همهٔ اکشن‌ها ✓ |
| 4 | تک‌فایل `app.js` | قیود `PAGE_JS` |
| 5 | تأیید مستقل `app.js` | تست مسیرها + 413 |
| 6 | ۷ مدل + کلیدها + اندپوینت‌های `/v1` در هر دو نسخه | منبع واحد؛ مودال 🔑 |
| 7 | بازیابی workspace + پیکر مدل گروهی مطابق سایت | رفع باگ z-index؛ embed لوگوها |
| 8 | **رجیستری پروایدرها + مهارت‌ها + ابزار کیفیت** | `providers.json` + اسکیمای JSON، `catalog.ts`/`providers.ts`، hot reload، `GET /api/models` در هر دو نسخه، `GET /api/keys` در `app.js`، `scripts/{verify,smoke,mock-upstream,dev-mock,docs-sync,sync-builtin,embed-logos}.mjs`، پوشهٔ `skills/`، رفع باگ `finish_reason`، پشتیبانی `HOST`، بازنویسی `README.md` با بلوک‌های تولیدی |

---

## 7. Suggested Next Steps | مسیر پیشنهادی ادامهٔ کار

1. **Fallback زنجیره‌ای پروایدرها:** وقتی آپستریم 429/5xx می‌دهد، خودکار به
   پروایدر بعدیِ همان مدل برود (فیلد پیشنهادی: `fallbackProvider` در رجیستری) —
   اکنون با رجیستریِ چندپروایدری، این کار فقط یک لایهٔ انتخاب در
   `resolveModel`/هندلرهاست.
2. **Retry با backoff** برای خطاهای گذرا در لایهٔ پروکسی.
3. **UI مدیریت رجیستری:** افزودن پروایدر/مدل از داخل صفحه (نوشتن روی
   `providers.json` با همان hot reload).
4. **پروفایل‌های پاسخ بیشتر** در `response.profile` برای آپستریم‌های
   غیراستاندارد (WebSocket/gRPC) — در `src/lib/sse.ts` و `makeUpstreamParser`.
5. **پاک‌سازی قالب:** Prisma/`src/lib/db.ts` و `DATABASE_URL` از تمپلیت باقی
   مانده‌اند و منطق چت استفاده نمی‌کند؛ یا حذفشان کن یا واقعاً برای تاریخچهٔ
   چت به کار بگیر.
6. **استقرار:** `bun run build && bun run start` (standalone) یا
   `HOST=0.0.0.0 node app.js` با systemd/pm2؛ پشت nginx حتماً
   `proxy_buffering off`.
7. **CI:** یک workflow که `npm run verify:full` را اجرا کند (همهٔ ابزارها
   بدون اینترنت کار می‌کنند، پس در CI ساده است).
