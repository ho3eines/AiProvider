#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  embed-logos.mjs — جاسازی لوگوهای پروایدرها (base64) داخل app.js
 * ═══════════════════════════════════════════════════════════════════════════
 *  نسخهٔ تک‌فایل باید بدون فولدر public/ هم کار کند، پس لوگوها به‌صورت base64
 *  داخل ثابت EMBEDDED_LOGOS در app.js می‌نشینند و سرور همان مسیرهای مرجع
 *  (`/Claude-ai-logo.webp` و …) را سرو می‌کند.
 *
 *  منبع حقیقت: فیلد `logo` در مدل‌های providers.json.
 *   • لوگوی محلی (`/foo.png`)      ← از public/foo.png خوانده و جاسازی می‌شود
 *   • لوگوی خارجی (`https://…`)    ← جاسازی نمی‌شود (مرورگر خودش می‌گیرد)
 *
 *  اجرا:
 *    npm run embed:logos              → بازنویسی EMBEDDED_LOGOS در app.js
 *    npm run embed:logos -- --dry-run → فقط گزارش (فایل تغییر نمی‌کند)
 *    node scripts/embed-logos.mjs --max-kb 40   → هشدار برای لوگوی بزرگ‌تر
 *
 *  جایگزینِ مدرنِ `scripts/embed_logos.py` (که مسیرهای سخت‌کدِ سندباکس قدیمی و
 *  placeholder حذف‌شده داشت) — این نسخه Node-only و بدون وابستگی است.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app.js');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const maxKbIdx = args.indexOf('--max-kb');
const maxKb = maxKbIdx >= 0 ? Number(args[maxKbIdx + 1]) : 40;

const MIME = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

const cfg = JSON.parse(readFileSync(join(ROOT, 'providers.json'), 'utf8'));
const logos = new Map(); // route → { file, mime }
const skipped = [];

for (const p of cfg.providers || []) {
  for (const m of p.models || []) {
    const logo = m?.logo;
    if (!logo) continue;
    if (/^https?:\/\//i.test(logo) || logo.startsWith('data:')) {
      skipped.push(`${logo} (خارجی/دیتا — جاسازی نمی‌شود)`);
      continue;
    }
    if (!logo.startsWith('/')) {
      skipped.push(`${logo} (مسیر نامعتبر — باید با / شروع شود)`);
      continue;
    }
    if (logos.has(logo)) continue;
    const file = join(ROOT, 'public', logo);
    if (!existsSync(file)) {
      skipped.push(`${logo} (فایل public${logo} پیدا نشد)`);
      continue;
    }
    logos.set(logo, { file, mime: MIME[extname(logo).toLowerCase()] || 'application/octet-stream' });
  }
}

if (!logos.size) {
  console.error('✖ هیچ لوگوی محلیِ قابل جاسازی در providers.json نیست.');
  if (skipped.length) console.error('  رد شده‌ها:\n   - ' + skipped.join('\n   - '));
  process.exit(1);
}

const payload = {};
let totalBytes = 0;
for (const [route, { file, mime }] of [...logos.entries()].sort()) {
  const buf = readFileSync(file);
  totalBytes += buf.length;
  payload[route] = { mime, b64: buf.toString('base64') };
  const kb = buf.length / 1024;
  const flag = kb > maxKb ? ` ⚠ بزرگ‌تر از ${maxKb}KB` : '';
  console.log(`  • ${route} ← public${route} (${kb.toFixed(1)}KB, ${mime})${flag}`);
}

if (skipped.length) console.log('  رد شده:\n   - ' + skipped.join('\n   - '));

const json = JSON.stringify(payload);
console.log(`\nمجموع: ${logos.size} لوگو · ${(totalBytes / 1024).toFixed(1)}KB خام · ${(json.length / 1024).toFixed(1)}KB JSON`);

if (dryRun) {
  console.log('\n(--dry-run) app.js تغییر نکرد.');
  process.exit(0);
}

const src = readFileSync(APP, 'utf8');
const re = /^const EMBEDDED_LOGOS = \{.*\};$/m;
if (!re.test(src)) {
  console.error('✖ خط `const EMBEDDED_LOGOS = {...};` در app.js پیدا نشد.');
  process.exit(1);
}
const out = src.replace(re, () => `const EMBEDDED_LOGOS = ${json};`);
writeFileSync(APP, out, 'utf8');
console.log('✓ EMBEDDED_LOGOS در app.js بازنویسی شد.');

const check = spawnSync(process.execPath, ['--check', APP], { encoding: 'utf8' });
if (check.status === 0) console.log('✓ node --check app.js سالم است.');
else {
  console.error('✖ app.js بعد از جاسازی سینتکس نامعتبر دارد:\n' + (check.stderr || '').slice(0, 500));
  process.exit(1);
}
console.log('\nیادآوری: بعد از این تغییر `npm run verify` را هم اجرا کنید.');
