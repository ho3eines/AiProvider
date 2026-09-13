---
name: edit-appjs
description: قواعد ویرایش امنِ فایل تک‌خطی app.js — ساختار فایل، سه بلوک قالبِ PAGE_CSS/PAGE_JS/PAGE_HTML، محدودیت‌های سخت‌گیرانهٔ String.raw، جریان دادهٔ کلاینت، کپی داخلی رجیستری و لوگوها، و بررسی‌های اجباری بعد از هر تغییر.
---

# Editing app.js — نسخهٔ تک‌فایل

## When to use — چه زمانی

هر وقت قرار است `app.js` را تغییر دهید: رفع اشکال، قابلیت جدید در UI،
endpoint تازه، یا همگام‌سازی با تغییری که در `src/` داده‌اید
(→ [`add-feature`](../add-feature/SKILL.md)).

`app.js` نسخهٔ **بدون وابستگی** پروژه است: یک فایل ~۳۷۰۰ خطی که با
`node app.js` بالا می‌آید و UI، پروکسی، و API سازگار OpenAI/Anthropic را
یک‌جا ارائه می‌کند. هیچ `npm install`، هیچ build، هیچ import بیرونی.

---

## File map — نقشهٔ فایل

شمارهٔ خط‌ها جابه‌جا می‌شوند؛ همیشه با `grep` پیدا کنید:

```bash
grep -n "^const PROVIDERS_FILE\|^const BUILTIN_PROVIDERS\|^function getProviders\|^function resolveModel\|^function buildUpstreamPayload\|^function publicCatalog\|^const PAGE_CSS\|^const PAGE_JS\|^const PAGE_HTML\|^function openUpstream\|^function makeUpstreamParser\|^const BOOT_CFG\|^const server = http" app.js
```

| بخش | نماد / الگوی جست‌وجو | نقش |
|---|---|---|
| سرآیند و requires | `require('node:http')` | فقط ماژول‌های داخلی Node |
| ثابت‌های بوت | `const BOOT_CFG`, `BOOT_UPSTREAM`, `UPSTREAM_URL`, `SPOOFED_HEADERS`, `MAX_BODY_BYTES`, `UPSTREAM_TIMEOUT_MS`, `FM_MODELS`, `DEFAULT_MODEL_ID` | سازگاری با کد قدیم؛ مقدارشان از پروایدر پیش‌فرضِ رجیستری در لحظهٔ بالا آمدن گرفته می‌شود (هندلرها از توابع زنده استفاده می‌کنند) |
| رجیستری | `const BUILTIN_PROVIDERS`, `function getProviders`, `readProvidersConfig`, `withEnvToggles` | کپی داخلی + خواندن زندهٔ `providers.json` |
| توابع رجیستری | `resolveModel`, `buildUpstreamPayload`, `publicCatalog`, `upstreamOptions` | معادل `src/lib/catalog.ts` |
| کلیدها | `const API_KEYS`, `keyIsValid`, `loadOrCreateKeys` | `api-keys.json` + env |
| لاگ | `const C` (رنگ‌ها)، `function logReq`، `function safeDestroy` | رنگ/برچسب لاگ‌ها و بستن امن سوکت |
| **CSS** | `const PAGE_CSS = String.raw\`` | کل استایل UI |
| **JS کلاینت** | `const PAGE_JS = String.raw\`` | کل منطق مرورگر (~۱۵۰۰ خط) |
| **HTML** | `const PAGE_HTML = \`` | اسکلت صفحه + جای‌گذاری `__SERVER_DATA_JSON__` |
| لوگوها | `const EMBEDDED_LOGOS = {…}` | base64 لوگوها (با `npm run embed:logos` ساخته می‌شود) |
| اتصال | `function openUpstream` | معادل `src/lib/upstream.ts` |
| بدنه/پاسخ | `readBody`, `sendJson` | خواندن بدنه با سقف بایت، پاسخ JSON |
| پارسر | `function makeUpstreamParser(onDelta, opts)` | معادل `src/lib/sse.ts` |
| handlerها | `handleHome`, `handleChat`, `handleCatalog`, `handleKeys`, `handlePing`, `handleModels`, `handleOpenAI`, `handleAnthropic` | یکی به‌ازای هر endpoint |
| روتر | `const server = http.createServer((req, res) => {` | تطبیق مسیر + `OPTIONS → 204` + 404 |
| بنر | انتهای فایل | چاپ پورت، مدل‌ها، کلیدها |

**دو گویشِ متفاوت در یک فایل:**

| ناحیه | گویش | مثال |
|---|---|---|
| کد سرور (بیرون از PAGE_JS/PAGE_CSS) | CommonJS مدرن Node | `const`, `=>`, `async/await`, `Object.assign` |
| داخل `PAGE_JS` | **فقط ES5** | `var`, `function`, بدون `=>`/`let`/`const`/`?.`/`??` (`async` مجاز است) |

---

## The hard rules — قواعد سخت (شکستنشان فایل را خراب می‌کند)

`PAGE_CSS` و `PAGE_JS` داخل **`String.raw\`…\``** هستند. پس داخلشان:

1. **backtick ممنوع** → رشتهٔ template را با `'\x60'` بسازید:
   ```js
   var tick = '\x60';                      // ✓ مجاز
   html += tick + code + tick;             // ✓
   // html += `code`;                      // ✗ کل بلوک را می‌بندد
   ```
2. **`${` ممنوع** → الحاق رشته:
   ```js
   var url = '/api/chat?m=' + encodeURIComponent(id);   // ✓
   // var url = `/api/chat?m=${id}`;                     // ✗
   ```
   (در CSS هم `${` ننویسید؛ مثلاً `content: "${x}"` ممنوع.)
3. **`</script>` ممنوع** → تجزیهٔ HTML صفحه را می‌شکند:
   ```js
   var close = '<' + '/script>';           // ✓ اگر لازم شد
   ```
4. **ES6+ در PAGE_JS ممنوع** (`let/const/=>/?./??/class`) — مرورگرهای قدیمی و
   سازگاری با سبک موجود. `Object.assign` و `async/await` مجازند.
5. بعد از **هر** تغییر:
   ```bash
   node --check app.js     # یا: npm run check:appjs
   npm run verify          # PAGE_JS را استخراج و جداگانه چک می‌کند + توکن‌های ممنوعه
   npm run smoke           # ۳۰ آزمون رفتاری
   ```

> `npm run verify` بلوک `PAGE_JS` را بیرون می‌کشد، در فایل موقت می‌گذارد و
> `node --check` می‌گیرد؛ پس حتی اگر `app.js` سالم بماند ولی `PAGE_JS` خراب
> شود، می‌فهمید.

---

## Client data flow — جریان داده در مرورگر

```
providers.json  ──(getProviders)──►  publicCatalog(cfg)  ──►  serverDataJson()
                                                                    │
PAGE_HTML:  window.__FM__ = __SERVER_DATA_JSON__;  ◄────────────────┘
                                                                    │
PAGE_JS:    var FM_DATA = window.__FM__ || {};                      ▼
            var MODELS = (FM_DATA.models && FM_DATA.models.length) ? FM_DATA.models : MODELS_FALLBACK;
            var DEFAULT_SETTINGS = { modelId: FM_DATA.defaultModel || '…', … };
```

نکته‌ها:

- `handleHome` **در هر درخواست** `PAGE_HTML.replace('__SERVER_DATA_JSON__', …)` را
  اجرا می‌کند → hot reload رجیستری بدون restart در UI هم دیده می‌شود.
  (در `replace` از تابع استفاده شده تا `$` در JSON معنای ویژه نگیرد.)
- `MODELS_FALLBACK` یک فهرست ثابتِ اضطراری داخل `PAGE_JS` است؛ فقط وقتی به کار
  می‌آید که تزریق سرور نرسد. `npm run verify` هم‌خوانی‌اش را با مدل‌های پروایدر
  پیش‌فرض می‌سنجد → اگر مدل/نام/گروه/لوگو را عوض کردید، اینجا را هم به‌روز کنید.
- آیکن گروه‌ها: `MP_ICON_SVG` (نام → SVG) با `MP_GROUP_ICONS` (عنوان گروه → SVG).
  نام‌های مجاز باید با `GROUP_ICONS` در `src/app/page.tsx` یکی باشند
  (`sparkles, zap, globe, flask, bot, brain`)؛ `verify` این برابری را چک می‌کند.
- پیکر مدل توسط `buildPicker()` ساخته می‌شود: گروه‌ها به‌ترتیب `MODELS`.

---

## Registry & logos — رجیستری و لوگوها

```bash
npm run sync:builtin              # BUILTIN_PROVIDERS ← providers.json (دستی ویرایش نکنید)
npm run embed:logos -- --dry-run  # چه لوگویی، با چه حجمی جاسازی می‌شود
npm run embed:logos               # بازسازی EMBEDDED_LOGOS + node --check
```

- مسیر لوگو در رجیستری `/foo.webp` است. نسخهٔ Next آن را از `public/` می‌دهد؛
  `app.js` از `EMBEDDED_LOGOS` (روتر: `if (req.method === 'GET' && EMBEDDED_LOGOS[path])`).
- اگر لوگویی جاسازی نشده باشد، در نسخهٔ تک‌فایل ۴۰۴ می‌شود (در Next سالم است).
- حجم را کنترل کنید: لوگوها را کوچک (مثلاً ۹۶×۹۶) نگه دارید؛ `embed:logos`
  با `--max-kb` هشدار می‌دهد.

---

## Adding an endpoint — افزودن مسیر جدید

سه جا، به همین ترتیب:

```js
/* ۱) handler — کنار بقیهٔ handlerها */
function handleFoo(req, res) {
  sendJson(res, 200, { ok: true });
  logReq('green', 'GET /api/foo → 200');
}

/* ۲) روتر — داخل http.createServer، قبل از 404 */
if (req.method === 'GET' && path === '/api/foo') {
  handleFoo(req, res);
  return;
}
```

۳) معادلش در نسخهٔ Next: `src/app/api/foo/route.ts` (با `export const runtime =
'nodejs'` و `dynamic = 'force-dynamic'`)، و اگر endpoint در فهرست مستندات است،
بلوک `<!-- GENERATED:endpoints -->` را `npm run docs:sync` به‌روز می‌کند.

`OPTIONS` نیازی به تغییر ندارد: روتر **هر** `OPTIONS` را با `204` و CORS باز
پاسخ می‌دهد.

---

## Lessons learned — درس‌هایی از اشکال‌های واقعی

1. **TDZ (Temporal Dead Zone):** تابع/ثابتی که در رجیستری استفاده می‌شود
   (`logReq`, `C`, `safeDestroy`) باید **بالاتر** از آن تعریف شده باشد. یک‌بار
   بلوک لاگ پایین‌تر از رجیستری بود و `ReferenceError: Cannot access 'C' before
   initialization` می‌داد — `node --check` این را **نمی‌گیرد**، چون خطای زمان
   اجراست. بعد از جابه‌جایی بلوک‌ها، حتماً `npm run smoke` را اجرا کنید.
2. **ترتیب `finished`:** در `handleOpenAI`، تابع `endStream()` اول
   `finished = true` می‌کرد و بعد `chunk({}, 'stop')` را صدا می‌زد؛ چون `chunk()`
   روی `finished` زود برمی‌گردد، چانک `finish_reason` هرگز منتشر نمی‌شد.
   قانون: **اول چانک پایانی را بفرستید، بعد پرچم پایان را ست کنید.**
3. **رشتهٔ بزرگ را با `replace(fn)` جای‌گذاری کنید:** اگر تابع نگذارید،
   `$&` و `$'` داخل JSON تفسیر می‌شوند و پاسخ خراب می‌شود.
4. **`readBody` سقف دارد:** بدنهٔ بزرگ‌تر از `maxBodyBytes` → `413`. برای
   تست‌های آپلود بزرگ، رجیستری/`defaults.maxBodyBytes` را عوض کنید نه کد را.
5. **`pkill -f app.js` شلِ خودتان را می‌کشد** (cmdline همان الگو را دارد).
   از الگوی کلاس کاراکتر استفاده کنید: `pkill -f "AiProvider/ap[p].js"`.

---

## Verify — چک‌لیست

- [ ] `node --check app.js` سالم
- [ ] `npm run verify` → «PAGE_JS استخراج و جداگانه چک شد»، «بدون backtick / ${ / </script»، «BUILTIN_PROVIDERS === providers.json»
- [ ] `npm run smoke` → ۳۰/۳۰
- [ ] اگر UI عوض شد: در مرورگر صفحه را باز کنید و کنسول را چک کنید (خطای JS در PAGE_JS فقط در مرورگر دیده می‌شود)
- [ ] معادل تغییر در `src/` هم اعمال شد (قانون برابری)
- [ ] اگر endpoint/رفتار تازه‌ای اضافه شد: آزمونش در `scripts/smoke.mjs` هم اضافه شد

---

## Related — مرتبط

- [`add-feature`](../add-feature/SKILL.md) — جریان کارِ تغییر در هر دو نسخه + نقشهٔ «کجا چه چیزی است»
- [`debug-stream`](../debug-stream/SKILL.md) — تشخیص اشکال استریم/پروکسی
- [`add-provider`](../add-provider/SKILL.md) — وقتی تغییر فقط در رجیستری است
- `HANDOFF.md` — قواعد طلایی پروژه و وضعیت جاری
