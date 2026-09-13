# Skills — مهارت‌های تغییرپذیری پروژه | AiProvider Skill Index

> این پوشه «دفترچهٔ عملیات» پروژه است: هر مهارت یک کارِ تکرارشونده را
> گام‌به‌گام، با فرمان‌های آماده و دام‌های شناخته‌شده توضیح می‌دهد.
> مخاطب: خودِ توسعه‌دهنده **و** دستیار هوش مصنوعی (Claude/ChatGPT/…) که
> قرار است روی این ریپو کار کند.

---

## 1. Which skill do I need? — کدام مهارت را بخوانم؟

| می‌خواهم… | مهارت | تغییر کد لازم است؟ |
|---|---|---|
| یک مدل جدید به پروایدر موجود اضافه کنم | [`add-model/SKILL.md`](add-model/SKILL.md) | ❌ فقط `providers.json` |
| به یک سایت/آپستریم جدید وصل شوم | [`add-provider/SKILL.md`](add-provider/SKILL.md) | ❌ فقط `providers.json` (مگر فرمت پاسخ عجیب باشد) |
| قابلیت تازه به UI یا API بدهم | [`add-feature/SKILL.md`](add-feature/SKILL.md) | ✅ در **هر دو** نسخه |
| فایل تک‌خطیِ `app.js` را دست بزنم | [`edit-appjs/SKILL.md`](edit-appjs/SKILL.md) | ✅ با قواعد سخت‌گیرانه |
| بفهمم چرا استریم/پاسخ خراب است | [`debug-stream/SKILL.md`](debug-stream/SKILL.md) | 🔎 تشخیص، سپس یکی از بالا |
| README/مستندات را به‌روز کنم | [`update-docs/SKILL.md`](update-docs/SKILL.md) | ❌ فقط سند + `docs:sync` |

**قانون طلاییِ خواندن:** قبل از هر تغییر، مهارت مربوط را کامل بخوانید.
نیمی از خطاهای این پروژه «دانستنش در مهارت‌ها هست» — مثلاً ممنوعیت backtick
داخل `PAGE_JS`، یا همگام‌سازی `BUILTIN_PROVIDERS`.

---

## 2. The three golden rules — سه قانون طلایی

1. **منبع یکتا (Single source of truth).** فهرست مدل‌ها/پروایدرها فقط در
   `providers.json` است. هیچ فهرست موازیِ دستی در `src/` نسازید
   (`npm run verify` می‌گیردش).
2. **برابری دو نسخه (Parity).** هر قابلیت/رفع اشکال در `src/` باید معادلش در
   `app.js` باشد و برعکس. جدول «کجا چه چیزی است» در
   [`add-feature/SKILL.md`](add-feature/SKILL.md) § نقشه.
3. **پایان کار = سه فرمان.** بعد از هر تغییر:
   ```bash
   npm run verify   # ساختار، همگامی، سلامت سند
   npm run smoke    # ۳۰ آزمون رفتاری (بدون اینترنت)
   npm run docs:sync # به‌روزرسانی بلوک‌های GENERATED
   ```

---

## 3. Tooling map — ابزارهای آماده

| فرمان | چه کار می‌کند |
|---|---|
| `npm run dev` | نسخهٔ Next.js روی پورت ۳۰۰۰ |
| `npm run standalone` | نسخهٔ تک‌فایل (`node app.js`) روی پورت ۳۰۰۰ |
| `npm run dev:mock` | **محیط آفلاین**: آپستریم ساختگی + Next با ۶ پروایدر آزمایشی |
| `npm run dev:mock:appjs` | همان، ولی با نسخهٔ تک‌فایل |
| `npm run mock` | فقط آپستریم ساختگی (پورت `MOCK_PORT`، پیش‌فرض ۴۱۰۰) |
| `npm run smoke` | آزمون دود روی `app.js` (خودش سرور را بالا می‌آورد) |
| `npm run smoke -- --base http://127.0.0.1:3000` | آزمون روی سرورِ در حال اجرا |
| `npm run verify` | چک‌لیست ساختاری/همگامی (۲ خطا = نباید commit کرد) |
| `npm run verify -- --full` | + `tsc --noEmit` + `eslint` + smoke |
| `npm run sync:builtin` | بازسازی کپی `providers.json` داخل `app.js` |
| `npm run docs:sync` | پرکردن بلوک‌های `<!-- GENERATED:* -->` و کپی به `download/` |
| `npm run docs:check` | فقط بررسی اینکه اسناد عقب نمانده‌اند |
| `npm run embed:logos` | جاسازی لوگوهای `public/` داخل `app.js` (base64) |
| `npm run typecheck` / `npm run lint` / `npm run check:appjs` | بررسی‌های سریع |

---

## 4. Repo map — نقشهٔ ریپو

```
providers.json          ← رجیستری پروایدرها/مدل‌ها (منبع حقیقت)
docs/providers.schema.json  ← اسکیمای JSON همان فایل (اعتبارسنجی در ویرایشگر)
app.js                  ← نسخهٔ تک‌فایل، بدون وابستگی (node app.js)
src/lib/catalog.ts      ← خواندن/نرمال‌سازی رجیستری (ایزومورفیک: سرور+کلاینت)
src/lib/providers.ts    ← خواندن زندهٔ providers.json با hot reload
src/lib/upstream.ts     ← اتصال به آپستریم (هدرها، CORS، لاگ)
src/lib/sse.ts          ← پارسر جهان‌شمولِ استریم/پاسخ آپستریم
src/lib/v1.ts           ← لایهٔ سازگاری OpenAI/Anthropic
src/app/**              ← صفحهٔ چت + route handlerها
scripts/*.mjs           ← ابزارهای بالا (verify/smoke/mock/docs-sync/…)
skills/                 ← همین پوشه
download/               ← کپی اسناد + خروجی HTML/PDF برای انتشار
```

جزئیات بیشتر: `HANDOFF.md` (وضعیت و قواعد)، `AI-GUIDE.md` (راهنمای دستیار)،
`README.md` (سند کاربر/مخاطب عمومی).

---

## 5. Skill format — قالب هر مهارت

هر `SKILL.md` این بخش‌ها را دارد:

```markdown
---
name: add-model
description: چه کاری و کی استفاده شود (یک جمله)
---
## When to use — چه زمانی
## Steps — گام‌ها (با فرمان و کد آمادهٔ کپی‌شدنی)
## Verify — چطور مطمئن شوم درست شد
## Pitfalls — دام‌ها (خطاهایی که قبلاً رخ داده)
## Related — مهارت‌های مرتبط
```

**نوشتن مهارت جدید:** همین قالب را نگه دارید، کوتاه بنویسید (کمتر از ۲۵۰ خط)،
فرمان‌ها را قابل کپی بگذارید، و در جدول § ۱ همین فایل اضافه‌اش کنید.
`npm run verify` مسیرها و فرمان‌های `npm run …` که داخل مهارت‌ها نوشته‌اید را
با واقعیت ریپو مقایسه می‌کند تا سندِ کهنه نماند.
