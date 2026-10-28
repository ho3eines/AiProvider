#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 14 — بروزرسانی مستندات برای همگام‌سازی با freemodels.pro (اکتبر ۲۰۲۶)
README.md + HANDOFF.md + AI-GUIDE.md + package.json + worklog.md + سینک download/
"""
import shutil, datetime

ROOT = '/home/z/my-project/'

# ───────────────────────────── README.md ─────────────────────────────
p = ROOT + 'README.md'
s = open(p, encoding='utf-8').read()
n0 = len(s)

# ۱) جدول بخش ۱۱ — مدل‌ها
s = s.replace(
"""منبع واحد لیست مدل‌ها `src/lib/models.ts` (Next) و ثابت `FM_MODELS` (app.js) است؛ هم پیکر UI و هم اندپوینت‌های `/v1` از همین می‌خوانند، پس همیشه همگام‌اند. مدل پیش‌فرض: **`claude-fable-5.1`**.

| Model ID | Display Name | Vendor | Group |
|---|---|---|---|
| `claude-sonnet-5` | Claude Sonnet 5 | Anthropic | Claude Pro |
| `claude-fable-5` | Claude Fable 5 | Anthropic | Claude Pro |
| `claude-fable-5.1` | Claude Fable 5.1 ⭐ پیش‌فرض | Anthropic | Claude Pro |
| `sol`   | GPT 5.6 Sol | OpenAI | ChatGPT Pro |
| `terra` | GPT 5.6 Terra | OpenAI | ChatGPT Pro |
| `glm-5.2` | GLM 5.2 | Z.AI | Other Pro Models |
| `kimi-k3` | Kimi K3 | Moonshot AI | Other Pro Models |""",
"""منبع واحد لیست مدل‌ها `src/lib/models.ts` (Next) و ثابت `FM_MODELS` (app.js) است؛ هم پیکر UI و هم اندپوینت‌های `/v1` از همین می‌خوانند، پس همیشه همگام‌اند. مدل پیش‌فرض: **`claude-sonnet-5`** (بروزرسانی اکتبر ۲۰۲۶ — قبلاً `claude-fable-5.1` بود).

> ⚠️ **بروزرسانی freemodels.pro (اکتبر ۲۰۲۶):** دو مدل جدید `claude-opus-5.5` (پرچم‌دار) و `gpt-6-astra` اضافه شدند و نام نمایشی `claude-sonnet-5` به «Claude Sonnet 5.5» تغییر کرد (ID همان قبلی است). ترتیب جدول، ترتیب رسمی سایت است.

| Model ID | Display Name | Vendor | Group |
|---|---|---|---|
| `claude-opus-5.5` | Claude Opus 5.5 🆕 | Anthropic | Claude Pro |
| `claude-sonnet-5` | Claude Sonnet 5.5 ⭐ پیش‌فرض | Anthropic | Claude Pro |
| `claude-fable-5` | Claude Fable 5 | Anthropic | Claude Pro |
| `claude-fable-5.1` | Claude Fable 5.1 | Anthropic | Claude Pro |
| `sol`   | GPT 5.6 Sol | OpenAI | ChatGPT Pro |
| `terra` | GPT 5.6 Terra | OpenAI | ChatGPT Pro |
| `glm-5.2` | GLM 5.2 | Z.AI | Other Pro Models |
| `kimi-k3` | Kimi K3 | Moonshot AI | Other Pro Models |
| `gpt-6-astra` | GPT 6 Astra 🆕 | OpenAI | ChatGPT Pro |""")

# ۲) شمارش مدل‌ها در متن‌های مختلف
for a, b in [
    ("# لیست ۷ مدل", "# لیست ۹ مدل"),
    ("۷ مدل · پاسخ SSE سبک OpenAI", "۹ مدل · پاسخ SSE سبک OpenAI"),
    ("`FM_MODELS` (۷ مدل + گروه)", "`FM_MODELS` (۹ مدل + گروه)"),
    ("(پاسخ واقعی هر ۷ مدل را دارد.)", "(پاسخ واقعی هر ۹ مدل را دارد.)"),
    ("`GET /v1/models` بدون کلید → 200 با ۷ مدل", "`GET /v1/models` بدون کلید → 200 با ۹ مدل"),
    ("۳ گروه / ۷ مدل / ۴ لوگو", "۳ گروه / ۹ مدل / ۴ لوگو"),
    ("| 6 | ۷ مدل + کلیدهای API", "| 6 | ۹ مدل + کلیدهای API"),
    ('"defaultModel": "claude-fable-5.1",', '"defaultModel": "claude-sonnet-5",'),
]:
    if a in s:
        s = s.replace(a, b)

# ۳) Known Issues: بازنویسی بند ۷ + افزودن بند ۸
s = s.replace(
"7. **ID واقعی مدل‌های GPT در سایت فقط `sol` و `terra` است** (کشف‌شده از باندل رسمی freemodels.pro)؛ alias سازگاری برای IDهای قدیمی و نام نمایشی حفظ شده است.",
"""7. **ID واقعی مدل‌های GPT در سایت فقط `sol` و `terra` است** (کشف‌شده از باندل رسمی freemodels.pro)؛ alias سازگاری برای IDهای قدیمی و نام نمایشی حفظ شده است.
8. **بلاک جغرافیایی آپستریم (Token Harbor) — اکتبر ۲۰۲۶:** بک‌اند جدید freemodels درخواست‌های خروجی از مناطق تحریمی، چین، هنگ‌کنگ و ماکائو را با `403` رد می‌کند («API access from your region is not available»). اگر سرور شما (مثل سندباکس پیش‌فرض با egress هنگ‌کنگ) در این مناطق باشد، چت از سمت سرور خطای 403 می‌دهد در حالی که `/v1/models` و UI سالم‌اند. راه‌حل: استقرار روی **Cloudflare Workers** (بخش ۷ — ترافیک Worker→Worker داخل شبکهٔ Cloudflare می‌ماند) یا **Railway/Docker** در منطقهٔ مجاز (US/EU).""")
open(p, 'w', encoding='utf-8').write(s)
print('README.md:', n0, '->', len(s))

# ───────────────────────────── HANDOFF.md ─────────────────────────────
p = ROOT + 'HANDOFF.md'
s = open(p, encoding='utf-8').read()
n0 = len(s)
for a, b in [
    ("→ OpenAI list (7 مدل، owned_by", "→ OpenAI list (۹ مدل، owned_by"),
    ("«claude-fable-5.1» همه یکی می‌شوند؛ خالی → `claude-fable-5.1`.", "«claude-fable-5.1» همه یکی می‌شوند؛ خالی → `claude-sonnet-5` (پیش‌فرض جدید سایت، اکتبر ۲۰۲۶)."),
    ("`GET /v1/models` بدون کلید → ۲۰۰ با ۷ مدل", "`GET /v1/models` بدون کلید → ۲۰۰ با ۹ مدل"),
    ("۳ گروه / ۷ مدل / ۴ لوگو", "۳ گروه / ۹ مدل / ۴ لوگو"),
    ("| 6 | ۷ مدل + کلیدها", "| 6 | ۹ مدل + کلیدها"),
]:
    if a in s:
        s = s.replace(a, b)
open(p, 'w', encoding='utf-8').write(s)
print('HANDOFF.md:', n0, '->', len(s))

# ───────────────────────────── AI-GUIDE.md ─────────────────────────────
p = ROOT + 'AI-GUIDE.md'
s = open(p, encoding='utf-8').read()
n0 = len(s)
s = s.replace(
"""| `claude-fable-5.1` | Claude Fable 5.1 | Anthropic | Claude Pro | **پیش‌فرض** — تعادل کف کیفیت برای کار عمومی |
| `claude-sonnet-5` | Claude Sonnet 5 | Anthropic | Claude Pro | کدنویسی و استدلال ساخت‌یافته |
| `claude-fable-5` | Claude Fable 5 | Anthropic | Claude Pro | نگارش خلاق و روایت |
| `sol`   | GPT 5.6 Sol | OpenAI | ChatGPT Pro | پاسخ سریع و محاوره‌ای |
| `terra` | GPT 5.6 Terra | OpenAI | ChatGPT Pro | تحلیل چندمرحله‌ای و داده |
| `glm-5.2` | GLM 5.2 | Z.AI | Other Pro Models | چندزبانه و کار سبک |
| `kimi-k3` | Kimi K3 | Moonshot AI | Other Pro Models | متون بلند و جمع‌بندی |""",
"""| `claude-opus-5.5` | Claude Opus 5.5 | Anthropic | Claude Pro | 🆕 پرچم‌دار — پیچیده‌ترین کدنویسی و کارهای agentic |
| `claude-sonnet-5` | Claude Sonnet 5.5 | Anthropic | Claude Pro | **پیش‌فرض** (اکتبر ۲۰۲۶) — استدلال با extended thinking |
| `claude-fable-5` | Claude Fable 5 | Anthropic | Claude Pro | نگارش خلاق و روایت |
| `claude-fable-5.1` | Claude Fable 5.1 | Anthropic | Claude Pro | نگارش خلاق + پژوهش (پیش‌فرض قدیمی) |
| `sol`   | GPT 5.6 Sol | OpenAI | ChatGPT Pro | پاسخ سریع و محاوره‌ای |
| `terra` | GPT 5.6 Terra | OpenAI | ChatGPT Pro | تحلیل چندمرحله‌ای و داده |
| `glm-5.2` | GLM 5.2 | Z.AI | Other Pro Models | چندزبانه و کار سبک |
| `kimi-k3` | Kimi K3 | Moonshot AI | Other Pro Models | متون بلند و جمع‌بندی |
| `gpt-6-astra` | GPT 6 Astra | OpenAI | ChatGPT Pro | 🆕 پرچم‌دار reasoning-first برای کدنویسی/ریاضی/علوم |""")
for a, b in [
    ("لیست استاندارد OpenAI با ۷ مدل", "لیست استاندارد OpenAI با ۹ مدل"),
]:
    if a in s:
        s = s.replace(a, b)
open(p, 'w', encoding='utf-8').write(s)
print('AI-GUIDE.md:', n0, '->', len(s))

# ───────────────────────────── package.json نسخه ─────────────────────────────
p = ROOT + 'package.json'
s = open(p, encoding='utf-8').read()
s = s.replace('"version": "0.3.0"', '"version": "0.3.1"')
open(p, 'w', encoding='utf-8').write(s)
print('package.json -> 0.3.1')

# ───────────────────────────── worklog.md Task 14 ─────────────────────────────
today = str(datetime.date.today())
entry = """
---
Task ID: 14
Agent: main (Z.ai Code)
Task: درخواست کاربر («ریپوی GitHub خودم را تغییر دادم؛ freemodels.pro آپدیت جدید داده — کامل بررسی و بروزرسانی کن») — سینک با نسخهٔ 0.3.0 ریپو + بروزرسانی کاتالوگ مدل‌ها طبق سایت جدید

Work Log:
- کلون https://github.com/ho3eines/AiProvider (v0.3.0): تغییرات جدید نسبت به سندباکس = آداپتور ReAct Tool-Calling در /v1/chat/completions و /v1/messages (src/lib/v1.ts جدید با buildToolSystemPrompt/extractToolCalls/createStreamingToolFilter)، نسخهٔ کامل Cloudflare Workers/Pages (cloudflare/worker.mjs که UI/مدل‌ها/پارسر SSE را از app.js ایمپورت می‌کند)، Dockerfile/Dockerfile.single/docker-compose/railway.json، EXPOSE_KEYS masking، اسکریپت‌های smoke/typecheck/generate-keys/finalize-standalone
- نکتهٔ دیباگ: نمایش تگ‌های <tool_call> در خروجی ابزار فیلتر می‌شود و فایل «خالی» به‌نظر می‌رسید؛ با od/xxd راستی‌آزمایی شد که TOOL_OPEN/TOOL_CLOSE در فایل سالم‌اند — هیچ فیکسی لازم نبود (فقط توهم نمایشی)
- کشف بروزرسانی سایت (باندل جدید assets/index-BK3dGfE7.js): دو مدل جدید claude-opus-5.5 (Flagship) و gpt-6-astra (Free)؛ نام نمایشی claude-sonnet-5 → «Claude Sonnet 5.5»؛ پیش‌فرض سایت → claude-sonnet-5؛ ترتیب رسمی ۹ مدل استخراج شد
- کشف بحرانی زیرساخت: بک‌اند جدید آپستریم «Token Harbor» است و درخواست‌های خروجی از مناطق تحریمی/چین/هنگ‌کنگ/ماکائو را 403 می‌کند — سندباکس (egress هنگ‌کنگ) بلاک است؛ راه استاندارد: استقرار Cloudflare Workers (Worker→Worker داخل شبکهٔ CF) یا Railway/Docker در US/EU؛ در Known Issue ۸ مستند شد
- آپدیت مدل‌ها در هر دو نسخه: src/lib/models.ts · src/app/page.tsx (لیست + DEFAULT_SETTINGS) · app.js (FM_MODELS سرور + var MODELS کلاینت + DEFAULT_MODEL_ID + renderApiInfo) · src/app/api/ping/route.ts — ۹ مدل، نام جدید، پیش‌فرض جدید؛ alias های gpt-5.6-sol/terra حفظ شد
- راستی‌آزمایی: node --check ✓ · npx tsc --noEmit صفر خطا ✓ (بعد از حذف _github_clone) · /v1/models → ۲۰۰ با ۹ مدل به ترتیب سایت ✓ · /v1/chat/completions بدون کلید → 401 ✓ · UI هر دو نسخه → 200 ✓ · app.js مستقل: healthz models=9 defaultModel=claude-sonnet-5 ✓
- مستندات: README (جدول ۹ مدل + Known Issue ۸ Token Harbor + شمارش‌ها)، HANDOFF (۹ مدل + پیش‌فرض جدید)، AI-GUIDE (کاتالوگ ۹ مدل با نقش‌های جدید) — ریشه + download/ · نسخهٔ package.json → 0.3.1

Stage Summary:
- پروژه حالا ۱۰۰٪ با freemodels.pro اکتبر ۲۰۲۶ همگام است: ۹ مدل، پیش‌فرض claude-sonnet-5، alias های قدیمی سالم
- محدودیت محیطی سندباکس (egress هنگ‌کنگ → 403 Token Harbor) رفع‌شدنی از سمت کد نیست؛ برای کار واقعی: npm run cf:deploy (Cloudflare) یا docker:build + Railway
"""
p = ROOT + 'worklog.md'
s = open(p, encoding='utf-8').read()
s = s.rstrip() + entry
open(p, 'w', encoding='utf-8').write(s)
print('worklog.md: Task 14 appended')

# ───────────────────────────── سینک download/ ─────────────────────────────
for f in ['README.md', 'HANDOFF.md', 'AI-GUIDE.md']:
    shutil.copy(ROOT + f, ROOT + 'download/' + f)
print('download/ synced')
