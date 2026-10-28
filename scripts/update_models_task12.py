#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 12 — همگام‌سازی لیست مدل‌ها با بروزرسانی جدید freemodels.pro (اکتبر ۲۰۲۶)
تغییرات:
  ۱) افزودن claude-opus-5.5 (Flagship) و gpt-6-astra (Free) → مجموع ۹ مدل
  ۲) نام نمایشی «Claude Sonnet 5» → «Claude Sonnet 5.5» (طبق سایت)
  ۳) پیش‌فرض جدید سایت: claude-sonnet-5 (قبلاً claude-fable-5.1 بود)
  ۴) مرتب‌سازی طبق ترتیب رسمی سایت
فایل‌ها: src/lib/models.ts ، src/app/page.tsx ، app.js ، src/app/api/ping/route.ts
"""
import re, sys

ROOT = '/home/z/my-project/'
ok = []

# ─────────────────────────── ۱) src/lib/models.ts ───────────────────────────
p = ROOT + 'src/lib/models.ts'
s = open(p, encoding='utf-8').read()
s = s.replace(
    """export const FM_MODELS: FmModel[] = [
  { id: 'claude-sonnet-5',  name: 'Claude Sonnet 5',  vendor: 'Anthropic',   group: 'Claude Pro' },
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   vendor: 'Anthropic',   group: 'Claude Pro' },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', vendor: 'Anthropic',   group: 'Claude Pro' },
  { id: 'sol',              name: 'GPT 5.6 Sol',      vendor: 'OpenAI',      group: 'ChatGPT Pro' },
  { id: 'terra',            name: 'GPT 5.6 Terra',    vendor: 'OpenAI',      group: 'ChatGPT Pro' },
  { id: 'glm-5.2',          name: 'GLM 5.2',          vendor: 'Z.AI',        group: 'Other Pro Models' },
  { id: 'kimi-k3',          name: 'Kimi K3',          vendor: 'Moonshot AI', group: 'Other Pro Models' },
];

export const DEFAULT_MODEL_ID = 'claude-fable-5.1'; // مدل پیش‌فرض (انتخاب‌شده در سایت)""",
    """export const FM_MODELS: FmModel[] = [
  { id: 'claude-opus-5.5',  name: 'Claude Opus 5.5',  vendor: 'Anthropic',   group: 'Claude Pro' },
  { id: 'claude-sonnet-5',  name: 'Claude Sonnet 5.5', vendor: 'Anthropic',  group: 'Claude Pro' },
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   vendor: 'Anthropic',   group: 'Claude Pro' },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', vendor: 'Anthropic',   group: 'Claude Pro' },
  { id: 'sol',              name: 'GPT 5.6 Sol',      vendor: 'OpenAI',      group: 'ChatGPT Pro' },
  { id: 'terra',            name: 'GPT 5.6 Terra',    vendor: 'OpenAI',      group: 'ChatGPT Pro' },
  { id: 'glm-5.2',          name: 'GLM 5.2',          vendor: 'Z.AI',        group: 'Other Pro Models' },
  { id: 'kimi-k3',          name: 'Kimi K3',          vendor: 'Moonshot AI', group: 'Other Pro Models' },
  { id: 'gpt-6-astra',      name: 'GPT 6 Astra',      vendor: 'OpenAI',      group: 'ChatGPT Pro' },
];

export const DEFAULT_MODEL_ID = 'claude-sonnet-5'; // مدل پیش‌فرض (انتخاب‌شده در سایت — اکتبر ۲۰۲۶)""")
s = s.replace(
    """ * ⚠️ ID واقعی مدل‌های GPT فقط «sol» و «terra» است (نه gpt-5.6-sol/gpt-5.6-terra) —
 * اگر ID ناشناس بفرستیم آپستریم بی‌سروصدا به مدل پیش‌فرض (Claude) fallback می‌کند.""",
    """ * ⚠️ ID واقعی مدل‌های GPT فقط «sol» و «terra» است (نه gpt-5.6-sol/gpt-5.6-terra) —
 * اگر ID ناشناس بفرستیم آپستریم بی‌سروصدا به مدل پیش‌فرض (Claude) fallback می‌کند.
 * بروزرسانی اکتبر ۲۰۲۶: دو مدل جدید claude-opus-5.5 و gpt-6-astra اضافه شدند و
 * نام نمایشی claude-sonnet-5 به «Claude Sonnet 5.5» تغییر کرد (ID همان قبلی است).""")
open(p, 'w', encoding='utf-8').write(s)
ok.append('models.ts')

# ─────────────────────────── ۲) src/app/page.tsx ───────────────────────────
p = ROOT + 'src/app/page.tsx'
s = open(p, encoding='utf-8').read()
s = s.replace(
    """  { id: 'claude-sonnet-5',  name: 'Claude Sonnet 5',  vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'sol',              name: 'GPT 5.6 Sol',      vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: '/ChatGPT-Logo.svg.webp' },
  { id: 'terra',            name: 'GPT 5.6 Terra',    vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: '/ChatGPT-Logo.svg.webp' },
  { id: 'glm-5.2',          name: 'GLM 5.2',          vendor: 'Z.AI',        group: 'Other Pro Models', logo: '/zai.png' },
  { id: 'kimi-k3',          name: 'Kimi K3',          vendor: 'Moonshot AI', group: 'Other Pro Models', logo: '/kimi-logo-png_seeklogo-611650.png' },""",
    """  { id: 'claude-opus-5.5',  name: 'Claude Opus 5.5',  vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'claude-sonnet-5',  name: 'Claude Sonnet 5.5', vendor: 'Anthropic',  group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'sol',              name: 'GPT 5.6 Sol',      vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: '/ChatGPT-Logo.svg.webp' },
  { id: 'terra',            name: 'GPT 5.6 Terra',    vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: '/ChatGPT-Logo.svg.webp' },
  { id: 'glm-5.2',          name: 'GLM 5.2',          vendor: 'Z.AI',        group: 'Other Pro Models', logo: '/zai.png' },
  { id: 'kimi-k3',          name: 'Kimi K3',          vendor: 'Moonshot AI', group: 'Other Pro Models', logo: '/kimi-logo-png_seeklogo-611650.png' },
  { id: 'gpt-6-astra',      name: 'GPT 6 Astra',      vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: '/ChatGPT-Logo.svg.webp' },""")
s = s.replace("const DEFAULT_SETTINGS: Settings = {\n  modelId: 'claude-fable-5.1',",
              "const DEFAULT_SETTINGS: Settings = {\n  modelId: 'claude-sonnet-5',")
open(p, 'w', encoding='utf-8').write(s)
ok.append('page.tsx')

# ─────────────────────────── ۳) app.js (چهار نقطه) ───────────────────────────
p = ROOT + 'app.js'
s = open(p, encoding='utf-8').read()

# ۳-۱) FM_MODELS نسخه Node
s = s.replace(
    """const FM_MODELS = [
  { id: 'claude-sonnet-5',  name: 'Claude Sonnet 5',  vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'sol',              name: 'GPT 5.6 Sol',      vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: '/ChatGPT-Logo.svg.webp' },
  { id: 'terra',            name: 'GPT 5.6 Terra',    vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: '/ChatGPT-Logo.svg.webp' },
  { id: 'glm-5.2',          name: 'GLM 5.2',          vendor: 'Z.AI',        group: 'Other Pro Models', logo: '/zai.png' },
  { id: 'kimi-k3',          name: 'Kimi K3',          vendor: 'Moonshot AI', group: 'Other Pro Models', logo: '/kimi-logo-png_seeklogo-611650.png' },
];""",
    """const FM_MODELS = [
  { id: 'claude-opus-5.5',  name: 'Claude Opus 5.5',  vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'claude-sonnet-5',  name: 'Claude Sonnet 5.5', vendor: 'Anthropic',  group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', vendor: 'Anthropic',   group: 'Claude Pro',       logo: '/Claude-ai-logo.webp' },
  { id: 'sol',              name: 'GPT 5.6 Sol',      vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: '/ChatGPT-Logo.svg.webp' },
  { id: 'terra',            name: 'GPT 5.6 Terra',    vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: '/ChatGPT-Logo.svg.webp' },
  { id: 'glm-5.2',          name: 'GLM 5.2',          vendor: 'Z.AI',        group: 'Other Pro Models', logo: '/zai.png' },
  { id: 'kimi-k3',          name: 'Kimi K3',          vendor: 'Moonshot AI', group: 'Other Pro Models', logo: '/kimi-logo-png_seeklogo-611650.png' },
  { id: 'gpt-6-astra',      name: 'GPT 6 Astra',      vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: '/ChatGPT-Logo.svg.webp' },
];""")

# ۳-۲) DEFAULT_MODEL_ID
s = s.replace("const DEFAULT_MODEL_ID = 'claude-fable-5.1'; // مدل پیش‌فرض (انتخاب‌شده در سایت)",
              "const DEFAULT_MODEL_ID = 'claude-sonnet-5'; // مدل پیش‌فرض (انتخاب‌شده در سایت — اکتبر ۲۰۲۶)")

# ۳-۳) PAGE_JS — لیست مدل‌های سمت کلاینت (داخل رشتهٔ HTML)
s = s.replace(
    """  { id: 'claude-sonnet-5',  name: 'Claude Sonnet 5',  vendor: 'Anthropic',   group: 'Claude Pro',       logo: ropy1 },
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   vendor: 'Anthropic',   group: 'Claude Pro',       logo: ropy1 },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', vendor: 'Anthropic',   group: 'Claude Pro',       logo: ropy1 },
  { id: 'sol',              name: 'GPT 5.6 Sol',      vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: ropy2 },
  { id: 'terra',            name: 'GPT 5.6 Terra',    vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: ropy2 },
  { id: 'glm-5.2',          name: 'GLM 5.2',          vendor: 'Z.AI',        group: 'Other Pro Models', logo: ropy3 },
  { id: 'kimi-k3',          name: 'Kimi K3',          vendor: 'Moonshot AI', group: 'Other Pro Models', logo: ropy4 },""",
    """  { id: 'claude-opus-5.5',  name: 'Claude Opus 5.5',  vendor: 'Anthropic',   group: 'Claude Pro',       logo: ropy1 },
  { id: 'claude-sonnet-5',  name: 'Claude Sonnet 5.5', vendor: 'Anthropic',  group: 'Claude Pro',       logo: ropy1 },
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   vendor: 'Anthropic',   group: 'Claude Pro',       logo: ropy1 },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', vendor: 'Anthropic',   group: 'Claude Pro',       logo: ropy1 },
  { id: 'sol',              name: 'GPT 5.6 Sol',      vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: ropy2 },
  { id: 'terra',            name: 'GPT 5.6 Terra',    vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: ropy2 },
  { id: 'glm-5.2',          name: 'GLM 5.2',          vendor: 'Z.AI',        group: 'Other Pro Models', logo: ropy3 },
  { id: 'kimi-k3',          name: 'Kimi K3',          vendor: 'Moonshot AI', group: 'Other Pro Models', logo: ropy4 },
  { id: 'gpt-6-astra',      name: 'GPT 6 Astra',      vendor: 'OpenAI',      group: 'ChatGPT Pro',      logo: ropy2 },""")

# ۳-۴) PAGE_JS — DEFAULT_SETTINGS
s = s.replace("var DEFAULT_SETTINGS = { modelId: 'claude-fable-5.1',",
              "var DEFAULT_SETTINGS = { modelId: 'claude-sonnet-5',")

# ۳-۵) renderApiInfo — fallback هاردکد
s = s.replace("var model = (settings.modelId || FM.defaultModel || 'claude-fable-5.1').trim() || 'claude-fable-5.1';",
              "var model = (settings.modelId || FM.defaultModel || DEFAULT_MODEL_ID).trim() || DEFAULT_MODEL_ID;")

open(p, 'w', encoding='utf-8').write(s)
ok.append('app.js')

# ─────────────────────────── ۴) src/app/api/ping/route.ts ───────────────────────────
p = ROOT + 'src/app/api/ping/route.ts'
s = open(p, encoding='utf-8').read()
s = s.replace("modelId: 'claude-fable-5.1',", "modelId: 'claude-sonnet-5',")
open(p, 'w', encoding='utf-8').write(s)
ok.append('api/ping')

# ─────────────────────────── گزارش ───────────────────────────
print('Updated:', ', '.join(ok))
# شمارش اعتبارسنجی
for path, expect in [('src/lib/models.ts', 9), ('app.js', 9), ('src/app/page.tsx', 9)]:
    c = open(ROOT + path, encoding='utf-8').read()
    n = len(re.findall(r"\{ id: '", c))
    print(f'  {path}: {n} model entries (expect >= {expect})')
    for mid in ['claude-opus-5.5', 'gpt-6-astra']:
        print(f'    {mid}: {"OK" if mid in c else "MISSING!"}')
    print(f'    default claude-sonnet-5 present: {"OK" if "claude-sonnet-5" in c else "NO"}')
