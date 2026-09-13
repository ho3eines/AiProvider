# سند تحویل پروژه — Project Handoff

> **دستورالعمل تحویل به توسعه‌دهنده/ایجنت بعدی | Handoff Brief for the Next Developer/Agent**
> تاریخ: ۱۳ سپتامبر ۲۰۲۶ (۲۲ شهریور ۱۴۰۵) · نسخهٔ سند: ۲.۰
> این سند مکمل `README.md` (داکیومنت کامل — شامل بخش‌های Docker و Railway) و `worklog.md` (گزارش خام تسک‌ها) است.

---

## 1. TL;DR | خلاصهٔ تحویل

**چت هوشمند** یک اپ چت AI فارسی (RTL، تم تاریک) متصل به سرویس رایگان freemodels است که در قالب **دو نسخهٔ معادل** تحویل می‌شود: (۱) اپ Next.js 16 در `src/` و (۲) فایل تک‌فایل Node خالص `app.js` بدون هیچ وابستگی. هر دو نسخه UI چت کامل + پروکسی استریم آپستریم + **سه اندپوینت API سازگار OpenAI/Anthropic** با کلیدهای محلی (`api-keys.json`) دارند. همه‌چیز تست شده و کار می‌کند؛ تنها مشکل شناخته‌شده، خطای موقت 429 سهمیهٔ خود سرویس رایگان است که به‌درستی به کاربر نشان داده می‌شود.

**دستورهایی که همه‌چیز را راه می‌اندازد:**

```bash
npm install && npm run dev   # نسخهٔ Next.js → http://localhost:3000  (bun install هم کار می‌کند)
node app.js                  # نسخهٔ تک‌فایل (PORT/HOST از env؛ پیش‌فرض 3000 روی 0.0.0.0)
node --check app.js          # قبل از هر تغییر در app.js این را اجرا کن

# استقرار (Docker → Railway)
npm run keys:generate        # کلیدهای پایدار برای Railway Variables
docker build -t smart-chat . && docker run --rm -p 3000:3000 smart-chat
railway up && railway domain # دیپلوی + دامنهٔ عمومی (railway.json بیلدر را روی Dockerfile قفل کرده)
npm run smoke -- --url https://<your-app>.up.railway.app   # راستی‌آزمایی بعد از دیپلوی
```

**چهار دستور سلامت کد:** `npm run lint` (۰ خطا) · `npm run typecheck` (۰ خطا) · `npm run build` · `npm run smoke` (۷/۷).

## 2. Where Things Live | نقشهٔ مسیرها

| What | Where |
|---|---|
| UI چت (Next) | `src/app/page.tsx` (~۱۵۰۰ خط، client component) |
| پروکسی چت (Next) | `src/app/api/chat/route.ts` ← `src/lib/upstream.ts` |
| سلامت سبک (health check) | `src/app/healthz/route.ts` (Next) · `handleHealthz()` در `app.js` — بدون تماس با آپستریم |
| API سازگار OpenAI | `src/app/v1/chat/completions/route.ts` + `src/app/v1/models/route.ts` |
| API سازگار Anthropic | `src/app/v1/messages/route.ts` |
| پارسر SSE جهانی | `src/lib/sse.ts` — «قلب» تبدیل فرمت؛ تغییر آپستریم = بررسی این فایل |
| رندر مارک‌داون امن | `src/lib/markdown.ts` |
| لیست مدل‌ها (منبع واحد) | `src/lib/models.ts` (Next) + ثابت `FM_MODELS` در app.js |
| کلیدها | `api-keys.json` (ignore شده — الگو: `api-keys.example.json`) + `src/lib/apikeys.ts` / `loadOrCreateKeys()` در app.js + env |
| **استقرار** | `Dockerfile` (Next) · `Dockerfile.single` (app.js) · `.dockerignore` · `railway.json` · `docker-compose.yml` · `.env.example` |
| **ابزارهای کمکی** | `scripts/finalize-standalone.mjs` (کپی assets) · `scripts/generate-keys.mjs` (کلید پایدار) · `scripts/smoke.mjs` (تست دود) |
| UI چت (تک‌فایل) | `app.js`: `PAGE_CSS` · `PAGE_JS` · `PAGE_HTML` · هندلرهای سرور (خط ~۳۰۴۰ به بعد) |
| لوگوها | `public/` (۴ فایل واقعی) + base64 در `EMBEDDED_LOGOS` · ابزار: `scripts/embed_logos.py` |
| تاریخچهٔ کامل کار | `worklog.md` (۸ تسک با جزئیات تست) |

**آپستریم:** `https://freemodels-chat.freemodels.workers.dev/` — فقط با هدرهای جعلی مرورگر (Origin/Referer = `https://freemodels.pro`) پاسخ می‌دهد. این ثابت در `src/lib/upstream.ts` و app.js ست شده؛ اگر روزی عوض شد، هر دو جا را تغییر بده.

## 3. Critical Gotchas | نکات بحرانی (قبل از دست‌زدن به کد بخوان)

این‌ها تصمیم‌های عمدی و تجربه‌شده‌اند؛ نقضشان باگ تولید می‌کند:

1. **در `PAGE_JS` و `PAGE_CSS` داخل app.js مطلقاً backtick و `${` و `</script>` ننویس.** کل UI داخل `String.raw` template literal است؛ یک backtick اضافه = فایل خراب. backtick مارک‌داون با `\x60` ساخته می‌شود (کل فایل فقط ۳ جفت delimiter دارد). **پس از هر تغییر:** `node --check app.js` + استخراج PAGE_JS و `node --check` جداگانهٔ آن.
2. **از `fetch` برای آپستریم استفاده نکن** — fetch ارسال `Origin`/`Referer` را ممنوع می‌کند و آپستریم CORS باز ندارد. باید `node:https` بماند (هر دو نسخه).
3. **Pipe مستقیم، نه بافر:** استریم باید تکه‌به‌تکه رد شود (`Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no`). تجمیع بافر = مرگ استریم زنده. قطع کلاینت → `destroy` آپستریم (نشتی اتصال ممنوع).
4. **z-index پیکر مدل:** `#topbar` = z-55، `#sidebar` = z-50، مودال = 60، توست = 70. هر flex-item با z-index استکینگ‌کانتکست می‌سازد؛ اگر پاپ‌آپ زیر سایدبار رفت، این ترتیب را خراب نکرده باشی. لنگر پاپ‌آپ `right-0` فیزیکی است تا در RTL روی چت باز شود.
5. **hydration:** خواندن `localStorage` (`fm_chats`/`fm_settings`) فقط بعد از mount در `useEffect` — نه در رندر اولیه.
6. **429 آپستریم باگ نیست** — «providers exhausted» سرویس رایگان است؛ نباید حذف یا مخفی شود، فقط شفاف نمایش داده می‌شود (حباب قرمز / کد وضعیت درست).
7. **هر دو نسخه باید همگام بمانند:** هر قابلیت/فیکس در `src/` باید معادل در `PAGE_JS`/هندلرهای app.js هم بگیرد (و بالعکس). لیست مدل‌ها فقط از منبع واحد (`models.ts` / `FM_MODELS`) — هیچ لیست موازی‌ای نساز.
8. **eslint:** `app.js` در `eslint.config.mjs` ignores است؛ آن را برنگردان (CommonJS مستقل جزو بیلد Next نیست).
9. **کلیدها:** اولویت `env` ← `API_KEYS_FILE` ← ساخت تصادفی؛ هر دو کلید روی هر دو اندپوینت پذیرفته می‌شوند (رفتار عمدی). مقادیر placeholder (شامل `REPLACE`/`CHANGEME`/`xxxx` یا کوتاه‌تر از ۱۶ نویسه) توسط `isUsableKey()` رد می‌شوند. `api-keys.json` دیگر در ریپو نیست (`.gitignore` + `.dockerignore`)؛ برای ساخت کلید پایدار: `npm run keys:generate`.
10. **`/v1/messages` باید سخت‌گیر بماند:** `model` و `max_tokens` اجباری (400 با پیام `Field required`) — کلاینت‌های Anthropic به این خطاها تکیه دارند.

**نکته‌های بحرانی استقرار (Docker/Railway):**

11. **bind روی `0.0.0.0`:** `HOSTNAME` (Next) و `HOST` (app.js) هر دو پیش‌فرض `0.0.0.0` هستند. اگر `127.0.0.1` شود، Railway نمی‌رسد و دیپلوی با «Application failed to respond» می‌میرد.
12. **`PORT` را هاردکد نکن:** `server.js` خروجی standalone و `app.js` هر دو `process.env.PORT` را می‌خوانند. در `railway.json` عمداً `startCommand` نگذاشته‌ایم تا `CMD` داکرفایل حاکم بماند (تداخل این دو = شکست دیپلوی).
13. **health check فقط `/healthz`:** `/api/ping` به آپستریم می‌زند و با 429 موقت، کانتینر سالم را ری‌استارت می‌کند.
14. **`output: "standalone"` در `next.config.ts` حیاتی است** + کپی `public` و `.next/static` توسط `scripts/finalize-standalone.mjs` (وگرنه assets در پروداکشن 404).
15. **مسیر پویای `API_KEYS_FILE` در `src/lib/apikeys.ts` با `/* turbopackIgnore: true */` علامت‌گذاری شده** — اگر آن را برداری، Turbopack کل پروژه را داخل standalone trace می‌کند (حجم دیپلوی چند برابر می‌شود).
16. **`typescript.ignoreBuildErrors` خاموش است** — بیلد حالا خطای تایپ را قبول نمی‌کند؛ قبل از push حتماً `npm run typecheck` بزن.
17. **رازها داخل تصویر bake نمی‌شوند:** `.dockerignore` فایل‌های `.env*` و `api-keys.json` را بیرون نگه می‌دارد؛ این دو را از `.dockerignore` خارج نکن.

## 4. Frontend ↔ Backend Contract | قرارداد فرانت-بک

```
POST /api/chat   {messages:[{role,content}], modelId, thinking, deepSearch, stream}
  → استریم SSE سبک OpenAI آپستریم (delta.content + delta.reasoning_content) یا JSON
  → خطا: {error:{message}} با کد 413/502/504 یا عبور کد آپستریم (مثلاً 429)

GET /api/ping → {status:"ok"|"error", ms:number, sample:string(≤200)}   (به آپستریم می‌زند)
GET /healthz  → {status:"ok", runtime, uptimeSec, models, keysExposed}  (سبک — health check این است)

GET  /v1/models            → OpenAI list (7 مدل، owned_by=freemodels-<vendor>) — عمومی، بدون کلید
POST /v1/chat/completions  → chat.completion | chat.completion.chunk + [DONE]  (Bearer لازم است)
POST /v1/messages          → message | چرخهٔ message_start→…→message_stop (+ thinking block)
GET  /api/keys             → {openai, anthropic, exposed}  (فقط Next؛ app.js با window.__FM__ تزریق می‌کند)
                             با EXPOSE_KEYS=false → کلیدها ماسک و exposed:false
```

نرمال‌سازی مدل: `resolveModelId` — «Claude Fable 5.1» / «claude_fable 5.1» / «claude-fable-5.1» همه یکی می‌شوند؛ خالی → `claude-fable-5.1`.

## 5. Verification Checklist | چک‌لیست صحت‌سنجی (بعد از هر تغییر)

**خودکار (اول این‌ها):**
- [ ] `npm run lint` → 0 خطا · `npm run typecheck` → 0 خطا
- [ ] `npm run build` → موفق + `.next/standalone/server.js` وجود دارد (~۳۶MB)
- [ ] `node --check app.js` → سالم (+ استخراج PAGE_JS و `node --check` جداگانهٔ آن)
- [ ] `npm run smoke` → ۷/۷ ✓ (برای سرور راه دور: `npm run smoke -- --url https://<app>.up.railway.app`)

**سرور (curl):**
- [ ] `GET /` → 200 (Next یا app.js)
- [ ] `GET /healthz` → 200 + `status:"ok"` (بدون تماس با آپستریم)
- [ ] `OPTIONS /api/chat` → 204 با `Access-Control-Allow-Origin: *`
- [ ] `GET /api/ping` → `{"status":"ok",...}` (تاخیر ۲–۳ ثانیه طبیعی است؛ خطای سهمیهٔ آپستریم هم endpoint را سالم نگه می‌دارد)
- [ ] `GET /v1/models` بدون کلید → ۲۰۰ با ۷ مدل (عمومی)؛ `POST /v1/chat/completions` بدون کلید → 401
- [ ] `POST /v1/chat/completions` استریم → چانک‌ها + `[DONE]`؛ غیراستریم → `usage`
- [ ] `POST /v1/messages` بدون `max_tokens` → 400؛ با آن → چرخهٔ کامل رویدادها
- [ ] مسیر ناشناس → 404؛ بدنهٔ >5MB → 413 (app.js)

**استقرار (Docker/Railway):**
- [ ] `docker build -t smart-chat .` → موفق؛ `docker run --rm -p 3000:3000 smart-chat` → `/healthz` پاسخ می‌دهد
- [ ] `docker inspect --format '{{json .State.Health}}' <container>` → `healthy`
- [ ] کانتینر روی `0.0.0.0:$PORT` گوش می‌دهد (نه 127.0.0.1)
- [ ] `railway.json` → `builder: DOCKERFILE`، `healthcheckPath: /healthz`، بدون `startCommand`
- [ ] Variables: `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` + `EXPOSE_KEYS=false` ست شده‌اند

**مرورگر (هر دو نسخه):**
- [ ] پیکر مدل: ۳ گروه / ۷ مدل / ۴ لوگو، انتخاب مدل ماندگار پس از reload، بستن با Esc و کلیک بیرون
- [ ] ارسال پیام → استریم زنده + باکس «💭 تفکر» + آمار؛ Esc وسط استریم → «⏹ متوقف شد»
- [ ] ویرایش اینلاین پیام کاربر / بازتولید ↻ / خروجی MD و JSON
- [ ] رفرش → تاریخچه و تنظیمات سر جایشان (`fm_chats`/`fm_settings`)
- [ ] موبایل 390px: هدر جمع‌شونده، همبرگر، تارگت 44px، کامپوزر چسبان

## 6. Task History | تاریخچهٔ تسک‌ها (خلاصهٔ worklog)

| # | تسک | نکتهٔ ماندگار |
|---|---|---|
| 1 | بک‌اند پروکسی + کتابخانه‌های مشترک | تصمیم node:https برای هدرهای جعلی |
| 2 | فرانت‌اند کامل RTL فارسی | بدون hydration mismatch |
| 3 | تأیید مرورگری end-to-end | استریم ۲۸۶ تکه؛ همهٔ اکشن‌ها ✓ |
| 4 | تک‌فایل app.js | قیود PAGE_JS |
| 5 | تأیید مستقل app.js | تست ۶ مسیر + 413 |
| 6 | ۷ مدل + کلیدها + اندپوینت‌های /v1 (هر دو نسخه) | منبع واحد FM_MODELS؛ مودال 🔑 |
| 7 | بازیابی workspace از tar + پیکر مدل گروهی مطابق سایت | رفع باگ z-index stacking؛ embed لوگوها |
| 8 | استقرار Docker/Railway + سخت‌سازی | `/healthz`، `HOST`/`HOSTNAME` از env، `EXPOSE_KEYS`، `API_KEYS_FILE`، سه اسکریپت کمکی، lint/typecheck صفر، کلیدها از ریپو بیرون رفت |

## 7. Suggested Next Steps | مسیر پیشنهادی ادامهٔ کار

1. **Retry با backoff** برای 429 در لایهٔ پروکسی (بهترین بهبود تجربهٔ کاربر).
2. **Rate limiting** برای `/api/chat` در استقرار عمومی (الان بدون احراز هویت است).
3. **افزودن `group`/`vendor` به پاسخ `/v1/models`** به‌صورت فیلد اضافی سازگار.
4. **CI در GitHub Actions:** `lint` + `typecheck` + `build` + `docker build` + `smoke` (اسکریپت‌ها آماده‌اند).
5. **حذف اسکافلد Prisma** (`prisma/`، `src/lib/db.ts`، `db/custom.db`) اگر هیچ‌وقت لازم نشد — `npm ci` سبک‌تر می‌شود.
6. **استقرار:** راهنمای کامل Docker + Railway در `README.md` بخش‌های ۵ و ۶ است؛ پشت nginx/پروکسی شخصی حتماً `proxy_buffering off`.
7. **اگر آپستریم فرمتش عوض شد:** اول `src/lib/sse.ts` (و معادل `makeUpstreamParser` در app.js) را ببین — پارسر جهانی است و الگوهای شناخته‌شده را handle می‌کند.
