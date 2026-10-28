# استقرار روی Cloudflare Workers / Pages

> همان «چت هوشمند»، بدون سرور Node — روی رانتایم Cloudflare (workerd).
> کد اصلی در `cloudflare/worker.mjs` است و UI/مدل‌ها/پارسر SSE را **از خودِ `app.js` ایمپورت می‌کند**،
> پس دو نسخه هیچ‌وقت از هم جدا نمی‌افتند.

| مورد | مقدار |
|---|---|
| نقطهٔ ورود | `cloudflare/worker.mjs` |
| پیکربندی | `cloudflare/wrangler.jsonc` |
| ماک آپستریم (تست آفلاین) | `cloudflare/mock-upstream.mjs` |
| تست استریم | `cloudflare/tests/stream.test.mjs` |
| بیلد نسخهٔ Pages | `cloudflare/pages-build.mjs` → `cloudflare/pages-dist/_worker.js` |
| اندازهٔ باندل | ~۱۸۴KB خام / **~۵۴KB gzip** (سقف Workers خیلی بیشتر است) |
| وابستگی npm | فقط `wrangler` (devDependency) — زمان اجرا هیچ وابستگی ندارد |

---

## ۱) چرا روی Workers کار می‌کند؟

1. **آپستریم خودش یک Worker است** (`freemodels-chat.freemodels.workers.dev`)، پس درخواست
   Worker→Worker با `fetch` رانتایم انجام می‌شود و استریم SSE بدون بافر عبور می‌کند.
2. **هیچ فایل‌سیستمی لازم نیست** — در نسخهٔ Node کلیدها در `api-keys.json` ذخیره می‌شدند؛
   اینجا از **Secret** یا **KV** می‌آیند.
3. **هدرهای جعلی مرورگر کار می‌کنند** — در Workers می‌توان `Origin`/`Referer`/`User-Agent`
   را ست کرد (این دقیقاً همان چیزی است که CORS آپستریم را دور می‌زند).
   در تست‌ها رسیدن این هدرها به آپستریم راستی‌آزمایی شده است.
4. **استریم طولانی مشکلی ندارد** — محدودیت Workers روی *زمان CPU* است نه *زمان دیواری*؛
   انتظار کشیدن برای توکن‌های آپستریم CPU مصرف نمی‌کند.

---

## ۲) اجرای محلی

```bash
npm install                 # فقط یک‌بار (wrangler نصب می‌شود)

# ترمینال ۱ — ماک آپستریم (اختیاری؛ بدون اینترنت هم تست کنید)
npm run cf:mock                                  # → http://127.0.0.1:9912

# ترمینال ۲ — Worker با workerd
npm run cf:dev                                   # → http://127.0.0.1:8787
```

اگر می‌خواهید Worker به ماک وصل شود، `cloudflare/.dev.vars` بسازید (از `.dev.vars.example` کپی کنید):

```bash
cp cloudflare/.dev.vars.example cloudflare/.dev.vars
# سپس داخل آن: UPSTREAM_URL=http://127.0.0.1:9912/
```

یا بدون فایل، مستقیم روی خط فرمان:

```bash
npx wrangler dev --config cloudflare/wrangler.jsonc --ip 0.0.0.0 --port 8787 \
  --var UPSTREAM_URL:http://127.0.0.1:9912/ \
  --var OPENAI_API_KEY:sk-test-openai-0123456789abcdef \
  --var ANTHROPIC_API_KEY:sk-ant-api03-test-0123456789abcdef
```

### راستی‌آزمایی محلی

```bash
npm run cf:smoke          # ۷ تست scripts/smoke.mjs روی http://127.0.0.1:8787
OPENAI_API_KEY=sk-test-openai-0123456789abcdef npm run cf:test   # ۱۴ تست (شامل استریم واقعی)
```

`cf:test` چیزهایی را چک می‌کند که smoke پوشش نمی‌دهد: زنده‌بودن استریم (زمان رسیدن اولین تکه)،
رویدادهای Anthropic، `usage` در `stream_options`، `reasoning_content`، پاس‌دادن خطای آپستریم و
قطع‌شدن کلاینت.

---

## ۳) دیپلوی روی Cloudflare Workers

```bash
npx wrangler login                                   # یک‌بار
npm run cf:deploy                                    # → https://smart-chat.<subdomain>.workers.dev

# کلیدهای پایدار (Secret) — بدون این‌ها هر ایزوله کلید تصادفی موقتی می‌سازد
npx wrangler secret put OPENAI_API_KEY   --config cloudflare/wrangler.jsonc
npx wrangler secret put ANTHROPIC_API_KEY --config cloudflare/wrangler.jsonc

npx wrangler tail --config cloudflare/wrangler.jsonc  # لاگ زنده
```

سپس:

```bash
npm run smoke -- --url https://smart-chat.<subdomain>.workers.dev
OPENAI_API_KEY=sk-... npm run cf:test -- --url https://smart-chat.<subdomain>.workers.dev
```

### (اختیاری) KV برای پایداری کلیدها بدون Secret

```bash
npx wrangler kv namespace create API_KEYS
# id را در cloudflare/wrangler.jsonc ▸ kv_namespaces بگذارید و کامنت را بردارید
npm run cf:deploy
```

Worker اولین‌بار کلیدها را می‌سازد و در KV (کلید `api-keys`) ذخیره می‌کند؛ بعد از آن همان‌ها
خوانده می‌شوند. `/healthz` فیلد `keysSource` را برمی‌گرداند: `secret` | `kv` | `kv-generated` | `ephemeral`.

---

## ۴) دیپلوی روی Cloudflare Pages

```bash
npm run cf:pages:build     # → cloudflare/pages-dist/_worker.js
npm run cf:pages:deploy    # = بیلد + wrangler pages deploy
```

اجرای محلی نسخهٔ Pages (دقت کنید سینتکس `pages dev` با `dev` فرق دارد —
بایندینگ‌ها با `--binding` داده می‌شوند نه `--var`، و فلگ سازگاری را باید دستی بدهید):

```bash
npx wrangler pages dev cloudflare/pages-dist --port 8788 --ip 0.0.0.0 \
  --compatibility-date=2026-09-01 --compatibility-flags=nodejs_compat \
  --binding UPSTREAM_URL=http://127.0.0.1:9912/ \
  --binding OPENAI_API_KEY=sk-test-openai-0123456789abcdef \
  --binding ANTHROPIC_API_KEY=sk-ant-api03-test-0123456789abcdef
```

برای دیپلوی از داشبورد: پروژهٔ Pages بسازید، ریپو را وصل کنید،
**Build command** = `npm run cf:pages:build` و **Output directory** = `cloudflare/pages-dist`؛
سپس در **Settings ▸ Functions** فلگ سازگاری `nodejs_compat` و یک Compatibility Date
(مثلاً `2026-09-01`) ست کنید، و متغیرها را در **Settings ▸ Variables** بگذارید
(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `UPSTREAM_URL`, `EXPOSE_KEYS`).

> ⚠️ اگر `nodejs_compat` را در پروژهٔ Pages ست نکنید، باندلر Pages ماژول‌های `node:*` را با
> shimهای `unenv` جایگزین می‌کند و Worker موقع بالا آمدن می‌میرد. (در کد هم مراقب این هستیم:
> `app.js` هیچ‌وقت در زمان import سراغ `node:http` نمی‌رود — `http.createServer` فقط داخل
> `if (RUN_AS_SERVER)` صدا زده می‌شود، وگرنه خطای `http.createServer is not implemented yet!`
> می‌گرفتیم.)

> کدام را انتخاب کنم؟ **Workers** ساده‌تر است (یک دستور، یک کانفیگ، لاگ‌ها با `wrangler tail`).
> Pages فقط وقتی لازم است که بخواهید علاوه بر Worker، فایل‌های استاتیک هم سرو کنید.

---

## ۵) متغیرها

| متغیر | نوع | پیش‌فرض | توضیح |
|---|---|---|---|
| `UPSTREAM_URL` | var | `https://freemodels-chat.freemodels.workers.dev/` | آدرس آپستریم (برای تست: ماک محلی) |
| `EXPOSE_KEYS` | var | `false` | `true` → کلیدها در UI نمایش داده می‌شوند. **در دیپلوی عمومی false بماند** |
| `OPENAI_API_KEY` | **secret** | — | کلید سبک OpenAI (`Authorization: Bearer`) |
| `ANTHROPIC_API_KEY` | **secret** | — | کلید سبک Anthropic (`x-api-key`) |
| `API_KEYS` | KV binding | — | پایداری کلیدها بین دیپلوی‌ها (اختیاری) |

⚠️ تفاوت مهم با نسخهٔ Node: در Worker مقدار پیش‌فرض `EXPOSE_KEYS` **false** است
(چون استقرار Workers عملاً همیشه عمومی است)، ولی در نسخهٔ محلی Node پیش‌فرض `true` است.

---

## ۶) تفاوت‌ها و محدودیت‌ها

| موضوع | نسخهٔ Node (`app.js`) | نسخهٔ Worker |
|---|---|---|
| رانتایم | `node:http` + `https.request` | Fetch API روی workerd |
| کلیدها | `api-keys.json` یا env | Secret / KV / تصادفی موقتی |
| `/healthz` | `runtime: "single-file-node"` + `node` | `runtime: "cloudflare-worker"` + `keysSource` |
| `uptimeSec` | عمر پروسه | عمر **ایزوله** (با هر نمونه صفر می‌شود) |
| زمان CPU | نامحدود | ۳۰ ثانیه (Free) / تا ۵ دقیقه (Paid) — زمان انتظار آپستریم حساب نمی‌شود |
| زیردرخواست‌ها | نامحدود | ۵۰ (Free) / ۱۰۰۰ (Paid) در هر درخواست — ما فقط ۱ زیردرخواست داریم |
| اندازهٔ بدنه | ۵MB (سقف کد) | ۵MB (سقف کد) + ۱۰۰MB سقف پلتفرم |
| `console.log` | کنسول/داکر | `wrangler tail` و داشبورد Workers ▸ Logs |

نکات فنی که در کد رعایت شده‌اند:

- **`Date.now()` در زمان ارزیابی ماژول در workerd صفر است**؛ پس سن ایزوله و فیلد `created`
  به‌صورت تنبل (در اولین درخواست) محاسبه می‌شوند.
- `Content-Length` و `Accept-Encoding` دستی ست نمی‌شوند (رانتایم خودش مدیریت می‌کند).
- هدرهای `access-control-*`, `transfer-encoding`, `content-encoding`, `content-length`,
  `connection` از پاسخ آپستریم حذف می‌شوند تا `Response` معتبر بماند.
- قطع کلاینت (`req.signal`) فوراً درخواست آپستریم را `abort` می‌کند → دکمهٔ «توقف» واقعاً کار می‌کند.

---

## ۷) رفع اشکال

| نشانه | علت/راه‌حل |
|---|---|
| `401` روی `/v1/*` | کلید درست نیست؛ `wrangler secret put …` یا `/healthz` را ببینید (`keysSource`) |
| کلیدها در UI ماسک‌اند | طبیعی است (`EXPOSE_KEYS=false`)؛ برای دیدنشان `EXPOSE_KEYS=true` بگذارید |
| `502` روی `/api/chat` | آپستریم در دسترس نیست؛ `GET /api/ping` نمونهٔ خطا را نشان می‌دهد |
| `504` | تایم‌اوت ۱۸۰ ثانیهٔ آپستریم |
| استریم تکه‌تکه نمی‌آید | احتمالاً پروکسی میانی بافر می‌کند؛ هدر `X-Accel-Buffering: no` ست شده است |
| `wrangler dev` بالا نمی‌آید | `npm install` انجام شده؟ `npx wrangler --version` را چک کنید |

---

## ۸) چه چیزی shared است؟

`cloudflare/worker.mjs` این‌ها را از `app.js` ایمپورت می‌کند (single source of truth):

`buildPageHtml` · `serverDataJson` · `EMBEDDED_LOGOS` · `FM_MODELS` · `DEFAULT_MODEL_ID` ·
`resolveModelId` · `SPOOFED_HEADERS` · `OPEN_CORS` · `MAX_BODY_BYTES` · `UPSTREAM_TIMEOUT_MS` ·
`UPSTREAM_URL` · `makeUpstreamParser` · `collectUpstreamText` · `flattenContent` · `maskKey` · `isUsableKey`

برای همین، اگر UI یا لیست مدل‌ها در `app.js` عوض شود، نسخهٔ Worker هم **خودبه‌خود** همان می‌شود.
