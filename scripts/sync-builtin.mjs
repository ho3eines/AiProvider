#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  sync-builtin.mjs — بازسازی کپی داخلی رجیستری در app.js
 * ═══════════════════════════════════════════════════════════════════════════
 *  app.js باید «تک‌فایل و بدون وابستگی» بماند، پس یک کپی از providers.json را
 *  داخل خودش دارد (`const BUILTIN_PROVIDERS`) تا اگر فایل کنارش نبود هم کار کند.
 *  این اسکریپت آن کپی را از روی providers.json بازسازی می‌کند — هرگز دستی
 *  ویرایشش نکنید.
 *
 *  کاربرد:
 *    npm run sync:builtin            → بازسازی + node --check
 *    npm run sync:builtin -- --check → فقط بررسی همگامی (کد خروج ۱ اگر فرق داشت)
 *
 *  بعد از اجرا: `npm run verify` و `npm run smoke`
 *  (skills/add-model · skills/add-provider · skills/edit-appjs)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app.js');
const CFG = join(ROOT, 'providers.json');
const checkOnly = process.argv.includes('--check');

const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
delete cfg.$schema; // کلید اسکیمای JSON فقط برای ویرایشگر است، نه زمان اجرا

const src = readFileSync(APP, 'utf8');
const start = src.indexOf('const BUILTIN_PROVIDERS = {');
if (start < 0) {
  console.error('✖ `const BUILTIN_PROVIDERS = {` در app.js پیدا نشد.');
  process.exit(1);
}
const endRe = /\n[ \t]*\};/g;
endRe.lastIndex = start;
const endMatch = endRe.exec(src);
if (!endMatch) {
  console.error('✖ پایانِ آبجکت BUILTIN_PROVIDERS پیدا نشد.');
  process.exit(1);
}
const end = endMatch.index + endMatch[0].length;

/* JSON با تورفتگی ۲، سپس کل محتوا ۲ فاصله تورفته تا سبک فایل حفظ شود */
const body = JSON.stringify(cfg, null, 2)
  .split('\n')
  .slice(1, -1)
  .map((l) => '  ' + l)
  .join('\n');
const block = `const BUILTIN_PROVIDERS = {\n${body}\n  };`;
const old = src.slice(start, end);

if (old === block) {
  console.log('✓ BUILTIN_PROVIDERS همگام است (تغییری لازم نبود).');
  process.exit(0);
}
if (checkOnly) {
  console.error('✗ BUILTIN_PROVIDERS با providers.json فرق دارد → npm run sync:builtin');
  process.exit(1);
}

writeFileSync(APP, src.slice(0, start) + block + src.slice(end));
const models = (cfg.providers || []).reduce((n, p) => n + ((p.models || []).length), 0);
console.log(`✓ BUILTIN_PROVIDERS بازسازی شد — ${(cfg.providers || []).length} پروایدر · ${models} مدل`);

const check = spawnSync(process.execPath, ['--check', APP], { encoding: 'utf8' });
if (check.status !== 0) {
  console.error('✖ node --check شکست خورد:\n' + (check.stderr || ''));
  writeFileSync(APP, src); // بازگردانی
  console.error('   app.js به حالت قبل برگردانده شد.');
  process.exit(1);
}
console.log('✓ node --check app.js سالم است');
console.log('  بعدی: npm run verify && npm run smoke');
