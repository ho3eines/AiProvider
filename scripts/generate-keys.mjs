/**
 * generate-keys.mjs — ساخت کلیدهای API پایدار برای استقرار (Railway/Docker)
 *
 * چرا لازم است؟ فایل `api-keys.json` داخل کانتینر ephemeral است؛ اگر کلیدها را
 * از env ندهید، با هر دیپلوی کلید تازه ساخته می‌شود و کلاینت‌های `/v1` می‌شکنند.
 *
 * خروجی: دو متغیر محیطی آمادهٔ کپی در Railway (Variables) یا فایل `.env`:
 *
 *   npm run keys:generate              → فقط چاپ
 *   npm run keys:generate -- --write   → چاپ + نوشتن در api-keys.json
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const token = (len) => {
  const b = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ABC[b[i] % ABC.length];
  return s;
};

const write = process.argv.includes('--write');
const keyFile = path.join(process.cwd(), 'api-keys.json');

let openai = 'sk-' + token(48);
let anthropic = 'sk-ant-api03-' + token(88);

/* اگر --write و فایل موجود است، کلیدهای فعلی حفظ می‌شوند مگر --force داده شود */
if (write && existsSync(keyFile) && !process.argv.includes('--force')) {
  try {
    const j = JSON.parse(readFileSync(keyFile, 'utf8'));
    if (j.openai && j.anthropic) {
      openai = j.openai;
      anthropic = j.anthropic;
      console.log('# کلیدهای موجود در api-keys.json حفظ شدند (برای ساخت کلید تازه: --force)\n');
    }
  } catch {
    /* فایل خراب — کلید تازه می‌سازیم */
  }
}

if (write) {
  writeFileSync(keyFile, JSON.stringify({ openai, anthropic, createdAt: new Date().toISOString() }, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(`# نوشته شد: ${keyFile} (permission 600)\n`);
}

console.log('# ── Railway ▸ Service ▸ Variables (کپی کنید) ─────────────────');
console.log(`OPENAI_API_KEY=${openai}`);
console.log(`ANTHROPIC_API_KEY=${anthropic}`);
console.log('# ─────────────────────────────────────────────────────────────');
console.log('\nنکته: هر دو کلید روی هر دو اندپوینت /v1/chat/completions و /v1/messages پذیرفته می‌شوند.');
console.log('برای استقرار عمومی بهتر است EXPOSE_KEYS=false هم اضافه کنید تا کلیدها در UI ماسک شوند.\n');
