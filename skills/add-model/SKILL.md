---
name: add-model
description: افزودن/ویرایش/حذف مدل در رجیستری پروایدرها — بدون نوشتن حتی یک خط کد. وقتی استفاده کنید که بخواهید مدل تازه‌ای به یک پروایدرِ موجود اضافه کنید، نام/لوگو/گروه مدل را عوض کنید، یا مدل پیش‌فرض اپ را تغییر دهید.
---

# Add a Model — افزودن مدل جدید

## When to use — چه زمانی

- آپستریمِ موجود (مثلاً freemodels) مدل تازه‌ای منتشر کرده و می‌خواهید در UI،
  `/v1/models`، `/v1/chat/completions` و `/v1/messages` دیده شود.
- می‌خواهید نام نمایشی، لوگو، گروه، یا «مدل پیش‌فرض» را تغییر دهید.
- می‌خواهید نام‌های جایگزین (alias) برای یک مدل تعریف کنید.

> اگر مدل از **سایت دیگری** است → [`add-provider`](../add-provider/SKILL.md).
> اگر فقط برای تست است → همان‌جا § «تست با آپستریم ساختگی».

**هیچ کدی تغییر نمی‌کند.** هر دو نسخهٔ اپ (Next.js و `app.js`) رجیستری را
در زمان اجرا می‌خوانند و **hot reload** دارند (بررسی هر ۱ ثانیه با mtime) —
حتی restart لازم نیست.

---

## Steps — گام‌ها

### 1) مدل را در `providers.json` اضافه کنید

داخل `providers[i].models` یک آبجکت اضافه کنید (ترتیب = ترتیب نمایش در پیکر مدل):

```jsonc
{
  "id": "claude-opus-5",          // ← شناسهٔ عمومی؛ همین را کلاینت می‌فرستد (یکتا در کل رجیستری)
  "name": "Claude Opus 5",        // ← نام نمایشی در پیکر مدل
  "vendor": "Anthropic",          // ← سازنده؛ برای owned_by و زیرنویس UI
  "group": "Claude Pro",          // ← باید دقیقاً یکی از عنوان‌های groups همین پروایدر باشد
  "logo": "/Claude-ai-logo.webp"  // ← از public/ (یا URL کامل https://…)
}
```

فیلدهای اختیاری:

| فیلد | کاربرد |
|---|---|
| `"upstreamId": "claude-opus-5-20260101"` | اگر آپستریم مدل را با نام دیگری می‌شناسد؛ `id` عمومی می‌ماند |
| `"aliases": ["Claude Opus", "opus-5"]` | نام‌های جایگزینی که `resolveModel` می‌پذیرد (بدون حساسیت به بزرگی/کوچکی، `_`↔`-`) |
| `"default": true` | مدل پیش‌فرض اپ/API — **فقط یکی** در کل رجیستری |
| `"description": "…"` | توضیح کوتاه (فعلاً فقط مستندات) |

### 2) اگر گروه تازه است، گروه را هم تعریف کنید

در `providers[i].groups` (ترتیب = ترتیب نمایش گروه‌ها):

```jsonc
"groups": [
  { "title": "Claude Pro", "icon": "sparkles" },
  { "title": "Reasoning",  "icon": "brain" }   // ← گروه جدید
]
```

نام‌های آیکنِ مجاز (در هر دو نسخه یکسان‌اند):
`sparkles` · `zap` · `globe` · `flask` · `bot` · `brain`
(نام ناشناخته ← `globe`؛ برای آیکن تازه باید در هر دو نسخه اضافه شود →
[`add-feature`](../add-feature/SKILL.md)).

`title` گروه باید **دقیقاً** با `group` مدل یکی باشد، وگرنه مدل در گروه
«Other» می‌افتد.

### 3) اگر لوگو تازه است

1. فایل را در `public/` بگذارید (webp/png/svg، ترجیحاً ≤ ۲۵KB).
2. برای نسخهٔ تک‌فایل هم جاسازی شود:
   ```bash
   npm run embed:logos -- --dry-run   # اول ببینید چه چیزی تغییر می‌کند
   npm run embed:logos
   ```
   (لوگوها در `app.js` به‌صورت base64 در `EMBEDDED_LOGOS` می‌نشینند تا اپ
   بدون پوشهٔ `public` هم کامل باشد. اگر بزرگ‌تر از حد مجاز باشد اسکریپت هشدار
   می‌دهد → تصویر را کوچک کنید، مثلاً ۹۶×۹۶.)
3. لوگوی خارجی مجاز است: `"logo": "https://example.com/x.png"` — اما در حالت
   آفلاین نمایش داده نمی‌شود.

### 4) کپی داخلی `app.js` را همگام کنید

```bash
npm run sync:builtin
```

این `const BUILTIN_PROVIDERS` را از روی `providers.json` بازسازی می‌کند
(همان رجیستری، برای وقتی که فایل JSON کنار `app.js` نباشد) و در پایان
`node --check` می‌گیرد. **هرگز دستی ویرایشش نکنید.**

### 5) اعتبارسنجی و آزمون

```bash
npm run verify     # ساختار + یکتایی id + همگامی دو نسخه + سلامت سند
npm run smoke      # ۳۰ آزمون رفتاری روی app.js (بدون اینترنت)
npm run docs:sync  # بلوک‌های GENERATED در README/HANDOFF/AI-GUIDE + کپی download/
```

### 6) تست دستی

```bash
npm run standalone           # یا npm run dev
KEY=$(node -p "require('./api-keys.json').openai")

# مدل در فهرست هست؟
curl -s localhost:3000/v1/models -H "Authorization: Bearer $KEY" | node -p "JSON.parse(require('fs').readFileSync(0)).data.map(m=>m.id).join('\n')"

# کاتالوگ UI (گروه/لوگو/نام)
curl -s localhost:3000/api/models | node -p "JSON.parse(require('fs').readFileSync(0)).models.map(m=>m.id+' → '+m.group).join('\n')"

# واقعاً کار می‌کند؟
curl -sN localhost:3000/v1/chat/completions -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"model":"claude-opus-5","stream":true,"messages":[{"role":"user","content":"سلام"}]}'
```

در UI: صفحه را تازه کنید (کاتالوگ بعد از mount از `/api/models` گرفته می‌شود)
→ مدل باید در پیکر مدل، در گروه درست و با لوگوی درست دیده شود.

---

## Changing the default model — تغییر مدل پیش‌فرض

دو جا باید یکی باشند:

```jsonc
"defaults": { "providerId": "freemodels", "modelId": "claude-opus-5", … }
…
"models": [ …, { "id": "claude-opus-5", "default": true, … } ]
```

اولویت واقعی در کد (`defaultModelId` در `src/lib/catalog.ts`):
**`defaults.modelId`** ← اگر نباشد، مدلِ دارای **`"default": true`** ← اگر آن هم
نباشد، اولین مدلِ پروایدر پیش‌فرض. پس هر دو را روی یک مقدار بگذارید؛
`npm run verify` ناهمگامی یا چند `"default": true` را گزارش می‌کند.
بعد از تغییر، `npm run sync:builtin` را فراموش نکنید.

> **نکتهٔ app.js:** داخل `PAGE_JS` یک `MODELS_FALLBACK` ثابت هست که فقط وقتی
> به کار می‌آید که دادهٔ سرور به کلاینت نرسد. `verify` بررسی می‌کند که با
> رجیستری هم‌خوان باشد؛ اگر مدل پیش‌فرض را عوض کردید، این فهرست را هم
> به‌روز کنید (→ [`edit-appjs`](../edit-appjs/SKILL.md) § MODELS_FALLBACK).

---

## Removing / renaming a model — حذف یا تغییر نام

- **حذف:** آبجکت را از `models` پاک کنید → `sync:builtin` → `verify`.
  چت‌های ذخیره‌شده در `localStorage` کاربر با id قدیمی می‌مانند؛ UI مدلِ
  ناشناخته را با همان id خام نشان می‌دهد و درخواست به پروایدر پیش‌فرض می‌رود.
- **تغییر نام عمومی:** id را عوض نکنید! اگر لازم است نام دیگری هم پذیرفته شود،
  نام قبلی را در `aliases` بگذارید تا لینک/کلاینت‌های قدیمی نشکنند.

---

## Verify — چطور مطمئن شوم

- [ ] `npm run verify` بدون خطا (به‌ویژه «BUILTIN_PROVIDERS === providers.json»).
- [ ] `npm run smoke` همهٔ آزمون‌ها پاس.
- [ ] `GET /v1/models` مدل جدید را با `owned_by` درست برمی‌گرداند
      (`<ownedByPrefix>-<vendor-slug>`، مثلاً `freemodels-anthropic`).
- [ ] `GET /api/models` مدل را با گروه/لوگو/نام درست برمی‌گرداند.
- [ ] در UI، مدل در گروه درست با لوگو دیده می‌شود و پاسخ می‌دهد.
- [ ] `download/README.md` همگام است (`npm run docs:check`).

---

## Pitfalls — دام‌ها

| دام | نتیجه | راه‌حل |
|---|---|---|
| id تکراری در دو پروایدر | اولین پروایدر برنده می‌شود، دومی هرگز انتخاب نمی‌شود | `verify` می‌گیردش؛ id یکتا بگذارید |
| `group` با `groups` نمی‌خواند | مدل در «Other» می‌افتد | عنوان را دقیقاً کپی کنید |
| لوگو در `public/` هست ولی در `app.js` نه | در نسخهٔ تک‌فایل لوگو ۴۰۴ | `npm run embed:logos` |
| `sync:builtin` فراموش شد | نسخهٔ تک‌فایل بدون `providers.json` مدل جدید را ندارد | همیشه بعد از ویرایش JSON اجرا کنید |
| دستی `BUILTIN_PROVIDERS` را ویرایش کردید | دفعهٔ بعد `sync:builtin` رویش می‌نویسد | فقط JSON را ویرایش کنید |
| مدل را در `src/` سخت‌کد کردید | `verify` خطا می‌دهد (منبع باید یکتا بماند) | فقط `providers.json` |
| JSON با کامنت/ویرگول اضافه | پارس شکست می‌خورد، اپ به کپی داخلی برمی‌گردد | JSON خالص؛ `verify` چک می‌کند |
| انتظار دیدن مدل بدون تازه‌کردن صفحه | UI کاتالوگ را یک‌بار بعد از mount می‌گیرد | صفحه را refresh کنید |

---

## Related — مرتبط

- [`add-provider`](../add-provider/SKILL.md) — اتصال به سایت/آپستریم جدید
- [`edit-appjs`](../edit-appjs/SKILL.md) — جزئیات `app.js` و `MODELS_FALLBACK`
- [`update-docs`](../update-docs/SKILL.md) — بلوک‌های GENERATED در README
- [`debug-stream`](../debug-stream/SKILL.md) — اگر مدل اضافه شد ولی پاسخ نمی‌دهد
- `docs/providers.schema.json` — اسکیمای کامل رجیستری (اعتبارسنجی در ویرایشگر)
