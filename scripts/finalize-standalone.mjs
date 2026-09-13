/**
 * finalize-standalone.mjs — کپی assets لازم داخل خروجی standalone نکست
 *
 * چرا؟ وقتی `output: "standalone"` فعال است، `next build` فقط سرور و ماژول‌های
 * trace‌شده را در `.next/standalone` می‌گذارد؛ `public/` و `.next/static/` باید
 * دستی کپی شوند وگرنه در پروداکشن CSS/JS/تصاویر 404 می‌شوند.
 *
 * این اسکریپت جای‌گزین `cp -r ...` در package.json است تا روی ویندوز هم کار کند
 * و در Dockerfile هم با `npm run build` اجرا شود.
 */
import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
const staticSrc = path.join(root, '.next', 'static');
const publicSrc = path.join(root, 'public');

if (!existsSync(path.join(standalone, 'server.js'))) {
  console.error(
    '\n❌ .next/standalone/server.js پیدا نشد.\n' +
      '   → در next.config.ts باید `output: "standalone"` تنظیم باشد و `next build` موفق اجرا شده باشد.\n',
  );
  process.exit(1);
}

/* ۱) .next/static → .next/standalone/.next/static */
if (existsSync(staticSrc)) {
  await mkdir(path.join(standalone, '.next'), { recursive: true });
  await cp(staticSrc, path.join(standalone, '.next', 'static'), { recursive: true });
  console.log('✓ .next/static → .next/standalone/.next/static');
} else {
  console.warn('⚠ .next/static وجود ندارد — احتمالاً build کامل انجام نشده است.');
}

/* ۲) public → .next/standalone/public */
if (existsSync(publicSrc)) {
  await cp(publicSrc, path.join(standalone, 'public'), { recursive: true });
  const n = (await readdir(publicSrc)).length;
  console.log(`✓ public (${n} فایل) → .next/standalone/public`);
} else {
  console.warn('⚠ پوشهٔ public وجود ندارد — لوگوها/robots.txt سرو نمی‌شوند.');
}

/* ۳) فایل کلیدها (اختیاری) — اگر در ریشهٔ پروژه باشد، کنار server.js هم کپی می‌شود
      تا اجرای محلیِ standalone همان کلیدها را ببیند. در Docker عمدتاً وجود ندارد
      (کلیدها از env می‌آیند). */
const keys = path.join(root, 'api-keys.json');
if (existsSync(keys)) {
  await cp(keys, path.join(standalone, 'api-keys.json'));
  console.log('✓ api-keys.json → .next/standalone/api-keys.json');
}

const size = await dirSize(standalone);
console.log(`\n✅ خروجی آمادهٔ استقرار: .next/standalone (${(size / 1024 / 1024).toFixed(1)} MB)`);
console.log('   اجرا:  node .next/standalone/server.js   (PORT/HOSTNAME از env خوانده می‌شود)\n');

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(p);
    else if (entry.isFile()) total += (await stat(p)).size;
  }
  return total;
}
