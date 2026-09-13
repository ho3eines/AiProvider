/**
 * ابزارهای مشترک اندپوینت‌های /v1 (سازگار OpenAI و Anthropic)
 */
import type { IncomingMessage } from 'node:http';

/** CORS باز شامل هدرهای احراز هویت (برای استفادهٔ خارجی از API) */
export const V1_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
  'Access-Control-Max-Age': '86400',
};

/** هدرهای استاندارد پاسخ SSE */
export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
  ...V1_CORS,
};

/** تبدیل محتوای پیام (رشته یا آرایهٔ بلوک) به متن ساده برای آپستریم */
export function flattenContent(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    let s = '';
    for (const b of c) {
      if (typeof b === 'string') s += b;
      else if (b && typeof b === 'object' && typeof (b as Record<string, unknown>).text === 'string') {
        s += (b as Record<string, unknown>).text as string;
      }
    }
    return s;
  }
  return '';
}

/** خواندن کامل استریم ورودی به رشته (با سقف) */
export function readAll(res: IncomingMessage, cap = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve) => {
    let s = '';
    res.on('data', (c) => {
      if (s.length < cap) s += c.toString('utf8');
      else res.destroy();
    });
    res.on('end', () => resolve(s));
    res.on('error', () => resolve(s));
  });
}

/** تخمین توکن (برای فیلد usage) — تقریباً هر ۴ نویسه یک توکن */
export const estTokens = (chars: number): number => Math.max(1, Math.ceil(chars / 4));
