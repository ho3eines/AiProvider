/**
 * کلیدهای API (طبق قوانین OpenAI و Anthropic)
 * • کلید سبک OpenAI    : sk-...      → هدر Authorization: Bearer <key>
 * • کلید سبک Anthropic : sk-ant-...  → هدر x-api-key: <key>
 * اولین استفاده: ساخته و در api-keys.json (کنار پروژه) ذخیره می‌شود تا
 * نسخهٔ Next.js و نسخهٔ تک‌فایل app.js هر دو «همان» کلیدها را بپذیرند.
 * با env هم می‌توان دستی تعیین کرد: OPENAI_API_KEY / ANTHROPIC_API_KEY
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ApiKeys {
  openai: string;
  anthropic: string;
}

const KEY_FILE = join(process.cwd(), 'api-keys.json');

function randomToken(len: number): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += abc[bytes[i] % abc.length];
  return s;
}

let cached: ApiKeys | null = null;

/** لود/ساخت کلیدها (نتیجه در حافظه کش می‌شود) */
export function getApiKeys(): ApiKeys {
  if (cached) return cached;
  const envOpen = (process.env.OPENAI_API_KEY || '').trim();
  const envAnt = (process.env.ANTHROPIC_API_KEY || '').trim();
  try {
    if (existsSync(KEY_FILE)) {
      const j = JSON.parse(readFileSync(KEY_FILE, 'utf8')) as Record<string, unknown>;
      if (
        typeof j.openai === 'string' && j.openai &&
        typeof j.anthropic === 'string' && j.anthropic
      ) {
        cached = { openai: envOpen || j.openai, anthropic: envAnt || j.anthropic };
        return cached;
      }
    }
  } catch {
    /* فایل خراب — دوباره می‌سازیم */
  }
  const fresh = {
    openai: envOpen || ('sk-' + randomToken(48)),
    anthropic: envAnt || ('sk-ant-api03-' + randomToken(88)),
    createdAt: new Date().toISOString(),
  };
  try {
    writeFileSync(KEY_FILE, JSON.stringify(fresh, null, 2) + '\n', { mode: 0o600 });
  } catch {
    /* فایل‌سیستم اجازه نداد — کلیدها فقط تا پایان پروسه در حافظه می‌مانند */
  }
  cached = { openai: fresh.openai, anthropic: fresh.anthropic };
  return cached;
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
