/**
 * cloudflare/pages-build.mjs — ساخت بستهٔ Cloudflare Pages
 *
 * Cloudflare Pages در «حالت پیشرفته» یک فایل `_worker.js` در ریشهٔ دایرکتوری
 * خروجی می‌پذیرد و همهٔ درخواست‌ها را به آن می‌دهد. این اسکریپت همان Worker را
 * با باندلر خودِ wrangler می‌سازد و در `cloudflare/pages-dist/_worker.js` می‌گذارد:
 *
 *   npm run cf:pages:build     → cloudflare/pages-dist/_worker.js
 *   npm run cf:pages:deploy    → بیلد + wrangler pages deploy
 *
 * نکته: Workers (روش پیشنهادی) و Pages هر دو دقیقاً همین کد را اجرا می‌کنند؛
 * تفاوت فقط در محل دیپلوی است.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'pages-dist');
const TMP = path.join(HERE, '.bundle-tmp');
const CONFIG = path.join('cloudflare', 'wrangler.jsonc');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.log('→ باندل‌کردن Worker با wrangler (dry-run)…');
rmSync(TMP, { recursive: true, force: true });
/* نکته: wrangler مسیرهای نسبی `--outdir` را نسبت به «دایرکتوری فایل کانفیگ» حل می‌کند،
   پس مسیر مطلق می‌دهیم تا خروجی دقیقاً همان‌جا برود که انتظار داریم. */
execFileSync(
  npx,
  ['wrangler', 'deploy', '--config', CONFIG, '--dry-run', '--outdir=' + TMP],
  { cwd: ROOT, stdio: 'inherit' }
);

const bundled = readdirSync(TMP).find((f) => f.endsWith('.js') && !f.endsWith('.map'));
if (!bundled) throw new Error('فایل باندل‌شده پیدا نشد در ' + TMP);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
copyFileSync(path.join(TMP, bundled), path.join(OUT, '_worker.js'));
rmSync(TMP, { recursive: true, force: true });

console.log('');
console.log('✓ ساخته شد: cloudflare/pages-dist/_worker.js');
console.log('  دیپلوی:  npx wrangler pages deploy cloudflare/pages-dist --project-name smart-chat');
console.log('  (Secretها را در داشبورد Pages ▸ Settings ▸ Variables بگذارید: OPENAI_API_KEY / ANTHROPIC_API_KEY)');
