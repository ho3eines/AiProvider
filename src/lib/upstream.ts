/**
 * لایهٔ انتقال به آپستریم — تنها نقطهٔ تماس با دنیای بیرون
 *
 * • هدرهای مرورگر جعل می‌شود تا CORS آپستریم (که فقط freemodels.pro را باز گذاشته) دور زده شود.
 * • از `node:https`/`node:http` استفاده می‌شود، نه `fetch` — چون fetch ارسال دستی
 *   `Origin`/`Referer` را ممنوع می‌کند و آپستریم بدون آن‌ها پاسخ نمی‌دهد.
 * • URL/هدرها/تایم‌اوت از `providers.json` (رجیستری پروایدرها) خوانده می‌شود، پس
 *   برای اتصال به سایت جدید هیچ تغییری در این فایل لازم نیست (skills/add-provider).
 */
import { request as httpRequest } from 'node:http';
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_TIMEOUT_MS,
  defaultProvider,
  upstreamOptions,
  type Provider,
  type ProvidersConfig,
} from './catalog';

export { DEFAULT_MAX_BODY_BYTES as MAX_BODY_BYTES_DEFAULT, DEFAULT_TIMEOUT_MS as UPSTREAM_TIMEOUT_MS_DEFAULT };

/* ───────── مقادیر سازگار با کد قبلی (از پروایدر پیش‌فرض providers.json) ───────── */

const boot = upstreamOptions(defaultProvider());

/** URL آپستریمِ پروایدر پیش‌فرض */
export const UPSTREAM_URL = boot.url;
/** هدرهای جعل‌شدهٔ پروایدر پیش‌فرض */
export const SPOOFED_HEADERS: Record<string, string> = boot.headers;
/** حداکثر حجم بدنهٔ درخواست (پیش‌فرض ۵ مگابایت) */
export const MAX_BODY_BYTES = boot.maxBodyBytes || DEFAULT_MAX_BODY_BYTES;
/** تایم‌اوت آپستریم (پیش‌فرض ۱۸۰ ثانیه) */
export const UPSTREAM_TIMEOUT_MS = boot.timeoutMs || DEFAULT_TIMEOUT_MS;

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
  /** پروایدری که درخواست با آن ارسال شد */
  providerId: string;
}

export interface OpenUpstreamOptions {
  /** بدنهٔ JSON (رشته) */
  body: string;
  /** تایم‌اوت — پیش‌فرض از همان پروایدر */
  timeoutMs?: number;
  /** پیکربندی پروایدر — پیش‌فرض: پروایدر پیش‌فرض سیستم */
  provider?: Provider;
  /** برای دیباگ: نام مسیر لاگ‌شونده */
  label?: string;
  cfg?: ProvidersConfig;
}

/**
 * باز کردن درخواست به آپستریم؛ همان لحظه‌ای که هدرهای پاسخ رسید resolve می‌شود
 * تا body/استریم توسط caller به‌صورت تدریجی pipe شود (بدون بافر تجمعی).
 */
export function openUpstreamRequest(opts: OpenUpstreamOptions): Promise<UpstreamResponse> {
  const provider = opts.provider || defaultProvider(opts.cfg);
  const up = upstreamOptions(provider, opts.cfg);
  const timeoutMs = opts.timeoutMs ?? up.timeoutMs;
  const label = opts.label || 'upstream';

  return new Promise((resolve, reject) => {
    if (!up.url) {
      reject(new UpstreamError('UPSTREAM_CONFIG', `پروایدر «${provider?.id}» آدرس آپستریم ندارد (providers.json).`));
      return;
    }
    if (up.missingEnv.length) {
      console.warn(`[upstream] ${label}: متغیرهای محیطیِ تعریف‌نشده → ${up.missingEnv.join(', ')}`);
    }

    const isHttps = /^https:/i.test(up.url);
    const doRequest = isHttps ? httpsRequest : httpRequest;
    const req = doRequest(
      up.url,
      {
        method: up.method || 'POST',
        headers: { ...up.headers, 'Content-Length': String(Buffer.byteLength(opts.body, 'utf8')) },
      },
      (res) => resolve({ status: res.statusCode || 502, headers: res.headers, res, req, providerId: provider.id })
    );

    req.setTimeout(timeoutMs, () =>
      req.destroy(
        new UpstreamError('UPSTREAM_TIMEOUT', `پاسخ آپستریم بیش از حد طول کشید (${Math.round(timeoutMs / 1000)} ثانیه)`)
      )
    );
    req.on('error', (err) => {
      const e = err as Error & { code?: string };
      if (e instanceof UpstreamError || e.code === 'UPSTREAM_TIMEOUT') reject(e);
      else reject(new UpstreamError('UPSTREAM_ERROR', e.message || 'خطای اتصال به آپستریم'));
    });
    req.write(opts.body, 'utf8');
    req.end();
  });
}

/**
 * امضای سازگار با کد قبلی: `openUpstream(body, timeoutMs?)`.
 * اگر `provider` داده شود (یا `body` آبجکت گزینه‌ها باشد) از همان پروایدر استفاده می‌شود.
 */
export function openUpstream(
  body: string,
  timeoutOrOpts?: number | Omit<OpenUpstreamOptions, 'body'>,
  provider?: Provider
): Promise<UpstreamResponse> {
  if (typeof timeoutOrOpts === 'object' && timeoutOrOpts !== null) {
    return openUpstreamRequest({ ...timeoutOrOpts, body });
  }
  return openUpstreamRequest({ body, timeoutMs: timeoutOrOpts, provider });
}

/** میان‌بر: باز کردن درخواست برای یک پروایدر مشخص */
export function openUpstreamFor(provider: Provider, body: string, timeoutMs?: number): Promise<UpstreamResponse> {
  return openUpstreamRequest({ provider, body, timeoutMs });
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
