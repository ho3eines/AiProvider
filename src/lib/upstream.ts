/**
 * تنظیمات و ابزار ارتباط با API آپستریم (freemodels)
 * هدرهای مرورگر جعل می‌شوند تا CORS آپستریم (که فقط freemodels.pro را باز گذاشته) دور زده شود.
 */
import { request as httpsRequest } from 'node:https';
// تایپ‌های HTTP از `node:http` export می‌شوند (node:https آن‌ها را ندارد)
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from 'node:http';

export const UPSTREAM_URL = 'https://freemodels-chat.freemodels.workers.dev/';
export const MAX_BODY_BYTES = 5 * 1024 * 1024; // حداکثر حجم بدنه درخواست: ۵ مگابایت
export const UPSTREAM_TIMEOUT_MS = 180_000; // تایم‌اوت آپستریم: ۱۸۰ ثانیه

/** هدرهایی که به‌جای مرورگر به آپستریم فرستاده می‌شود */
export const SPOOFED_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Origin': 'https://freemodels.pro',
  'Referer': 'https://freemodels.pro/',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
  // جلوگیری از پاسخ فشرده تا pipe مستقیم بدون نیاز به decompress باشد
  'Accept-Encoding': 'identity',
};

/** خطای اختصاصی آپستریم */
export class UpstreamError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface UpstreamResponse {
  status: number;
  headers: IncomingHttpHeaders;
  res: IncomingMessage;
  req: ClientRequest;
}

/**
 * باز کردن درخواست POST به آپستریم؛ همان لحظه‌ای که هدرهای پاسخ رسید resolve می‌شود
 * تا body/استریم توسط caller به‌صورت تدریجی pipe شود.
 */
export function openUpstream(body: string, timeoutMs = UPSTREAM_TIMEOUT_MS): Promise<UpstreamResponse> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      UPSTREAM_URL,
      {
        method: 'POST',
        headers: { ...SPOOFED_HEADERS, 'Content-Length': String(Buffer.byteLength(body, 'utf8')) },
      },
      (res) => resolve({ status: res.statusCode || 502, headers: res.headers, res, req })
    );
    req.setTimeout(timeoutMs, () => req.destroy(new UpstreamError('UPSTREAM_TIMEOUT', 'پاسخ آپستریم بیش از حد طول کشید (۱۸۰ ثانیه)')));
    req.on('error', (err) => reject(new UpstreamError('UPSTREAM_ERROR', err.message || 'خطای اتصال به آپستریم')));
    req.write(body, 'utf8');
    req.end();
  });
}

/* ---------- لاگ رنگی کنسول ---------- */
const C = {
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

export function logReq(color: keyof typeof C, msg: string): void {
  const t = new Date().toLocaleTimeString('en-GB');
  const c = C[color] ?? C.cyan;
  console.log(`${C.dim}[${t}]${C.reset} ${c}${msg}${C.reset}`);
}

/** هدرهای CORS باز برای پاسخ‌های خود سرور */
export const OPEN_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
