/**
 * کلیدهای API (طبق قوانین OpenAI و Anthropic)
 * • کلید سبک OpenAI    : sk-...      → هدر Authorization: Bearer <key>
 * • کلید سبک Anthropic : sk-ant-...  → هدر x-api-key: <key>
 *
 * ترتیب اولویت (هر دو نسخهٔ Next.js و app.js یکسان‌اند):
 *   1) متغیرهای محیطی  OPENAI_API_KEY / ANTHROPIC_API_KEY   ← توصیه‌شده برای Railway/Docker
 *   2) فایل کلیدها     API_KEYS_FILE (پیش‌فرض: <cwd>/api-keys.json)
 *   3) ساخت کلید تصادفی در اولین اجرا (و ذخیره در همان فایل، در صورت امکان نوشتن)
 *
 * نکتهٔ استقرار: فایل‌سیستم کانتینر ephemeral است؛ اگر کلیدها را در env نگذارید،
 * با هر دیپلوی/ری‌استارت کلید جدید ساخته می‌شود و کلاینت‌های /v1 باید کلید تازه بگیرند.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export interface ApiKeys {
  openai: string;
  anthropic: string;
}

/**
 * مسیر فایل کلیدها — با env قابل تغییر است (برای کانتینر/وُلوم پایدار).
 * `turbopackIgnore` لازم است: بدون آن، Turbopack مسیر پویا را «دسترسی پویا به کل
 * فایل‌سیستم» می‌بیند و کل پروژه را داخل خروجی standalone trace می‌کند
 * (حجم دیپلوی را بی‌دلیل بالا می‌برد).
 */
export const KEY_FILE: string = process.env.API_KEYS_FILE
  ? isAbsolute(/* turbopackIgnore: true */ process.env.API_KEYS_FILE)
    ? /* turbopackIgnore: true */ process.env.API_KEYS_FILE
    : resolve(/* turbopackIgnore: true */ process.cwd(), /* turbopackIgnore: true */ process.env.API_KEYS_FILE)
  : join(process.cwd(), 'api-keys.json');

/**
 * آیا کلیدها به کلاینت (مودال ⚙️ و GET /api/keys) نشان داده شوند؟
 * پیش‌فرض: بله (رفتار تاریخی اپ محلی). برای استقرار عمومی روی اینترنت:
 *   EXPOSE_KEYS=false  → کلیدها mask می‌شوند و فقط از راه env قابل خواندن‌اند.
 */
export function keysExposed(): boolean {
  const v = (process.env.EXPOSE_KEYS ?? '').trim().toLowerCase();
  if (!v) return true;
  return !(v === 'false' || v === '0' || v === 'no' || v === 'off');
}

function randomToken(len: number): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += abc[bytes[i] % abc.length];
  return s;
}

/**
 * آیا مقدار «کلید واقعی» است؟
 * مقادیر placeholder (مثل `sk-REPLACE_WITH_48_RANDOM_CHARS` از api-keys.example.json)
 * رد می‌شوند تا هیچ‌وقت یک کلید قابل حدس به‌جای کلید تصادفی امن استفاده نشود.
 */
export function isUsableKey(k: string | null | undefined): boolean {
  if (!k) return false;
  const v = k.trim();
  return v.length >= 16 && !/REPLACE|CHANGE_?ME|xxxx+/i.test(v);
}

/** نمایش امن کلید: sk-abcd••••••••wxyz */
export function maskKey(k: string): string {
  if (!k) return '';
  if (k.length <= 12) return '•'.repeat(k.length);
  return k.slice(0, 8) + '•'.repeat(10) + k.slice(-4);
}

let cached: ApiKeys | null = null;

/** لود/ساخت کلیدها (نتیجه در حافظه کش می‌شود) */
export function getApiKeys(): ApiKeys {
  if (cached) return cached;
  const envOpen = (process.env.OPENAI_API_KEY || '').trim();
  const envAnt = (process.env.ANTHROPIC_API_KEY || '').trim();
  const useEnvOpen = isUsableKey(envOpen);
  const useEnvAnt = isUsableKey(envAnt);
  try {
    if (existsSync(KEY_FILE)) {
      const j = JSON.parse(readFileSync(KEY_FILE, 'utf8')) as Record<string, unknown>;
      if (
        isUsableKey(typeof j.openai === 'string' ? j.openai : '') &&
        isUsableKey(typeof j.anthropic === 'string' ? j.anthropic : '')
      ) {
        cached = {
          openai: useEnvOpen ? envOpen : (j.openai as string),
          anthropic: useEnvAnt ? envAnt : (j.anthropic as string),
        };
        return cached;
      }
    }
  } catch {
    /* فایل خراب — دوباره می‌سازیم */
  }
  const fresh = {
    openai: useEnvOpen ? envOpen : 'sk-' + randomToken(48),
    anthropic: useEnvAnt ? envAnt : 'sk-ant-api03-' + randomToken(88),
    createdAt: new Date().toISOString(),
  };
  let persisted = false;
  try {
    writeFileSync(KEY_FILE, JSON.stringify(fresh, null, 2) + '\n', { mode: 0o600 });
    persisted = true;
  } catch {
    /* فایل‌سیستم اجازه نداد (کانتینر read-only) — کلیدها فقط تا پایان پروسه در حافظه می‌مانند */
  }
  cached = { openai: fresh.openai, anthropic: fresh.anthropic };
  logBootstrap(useEnvOpen && useEnvAnt, persisted);
  return cached;
}

/** لاگ یک‌بارمصرف راه‌اندازی کلیدها (برای دیدن کلید در لاگ‌های Railway) */
function logBootstrap(fromEnv: boolean, persisted: boolean): void {
  const src = fromEnv
    ? 'env (OPENAI_API_KEY + ANTHROPIC_API_KEY)'
    : persisted
      ? `ساخته/خوانده‌شده از ${KEY_FILE}`
      : 'حافظه (تصادفی — فایل قابل نوشتن نبود)';
  console.log(`[api-keys] منبع کلیدها: ${src}`);
  if (fromEnv) return;
  console.log(
    '[api-keys] کلیدها خودکار ساخته شدند. برای پایداری بین دیپلوی‌ها این‌ها را در Railway ▸ Variables بگذارید:\n' +
      `           OPENAI_API_KEY=${cached!.openai}\n` +
      `           ANTHROPIC_API_KEY=${cached!.anthropic}`,
  );
  if (!keysExposed()) {
    console.log(`[api-keys] EXPOSE_KEYS=false → کلیدها در UI و GET /api/keys ماسک می‌شوند: ${maskKey(cached!.openai)}`);
  }
}

/** اعتبارسنجی کلید — هر دو کلید روی هر دو اندپوینت پذیرفته می‌شوند */
export function keyIsValid(k: string | null | undefined, keys?: ApiKeys): boolean {
  if (!k) return false;
  const kk = keys || getApiKeys();
  return k === kk.openai || k === kk.anthropic;
}

/** استخراج توکن از هدر Authorization: Bearer */
export function bearerFrom(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}
