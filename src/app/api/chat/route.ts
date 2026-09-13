/**
 * POST /api/chat — پروکسی چت به آپستریم با جعل هدرهای مرورگر
 * پاسخ آپستریم به‌صورت pipe مستقیم (بدون بافر تجمعی) رد می‌شود تا استریم SSE زنده بماند.
 */
import { NextResponse } from 'next/server';
import { MAX_BODY_BYTES, UPSTREAM_TIMEOUT_MS, openUpstream, logReq, OPEN_CORS } from '@/lib/upstream';
import { resolveModelId } from '@/lib/models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** پاسخ OPTIONS با CORS باز */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: OPEN_CORS });
}

function jsonError(status: number, message: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...OPEN_CORS },
  });
}

export async function POST(req: Request) {
  const started = Date.now();
  try {
    /* محدودیت حجم بدنه: ۵ مگابایت */
    const declared = Number(req.headers.get('content-length') || '0');
    if (declared > MAX_BODY_BYTES) {
      logReq('yellow', 'POST /api/chat → 413 (declared too large)');
      return jsonError(413, 'حجم درخواست بیش از حد مجاز (۵ مگابایت) است.');
    }
    const body = await req.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      logReq('yellow', 'POST /api/chat → 413 (body too large)');
      return jsonError(413, 'حجم درخواست بیش از حد مجاز (۵ مگابایت) است.');
    }

    /* نرمال‌سازی نرم modelId (هم‌سو با app.js): ID قدیمی/نام نمایشی → ID واقعی سایت */
    let bodyOut = body;
    try {
      const j = JSON.parse(body) as Record<string, unknown>;
      if (j && typeof j.modelId === 'string') {
        j.modelId = resolveModelId(j.modelId);
        bodyOut = JSON.stringify(j);
      }
    } catch {
      /* بدنه غیر JSON — همان عبور مستقیم */
    }

    /* اتصال به آپستریم با هدرهای جعلی */
    const { status, headers, res, req: upReq } = await openUpstream(bodyOut, UPSTREAM_TIMEOUT_MS);
    logReq('cyan', `POST /api/chat ← آپستریم پاسخ داد: ${status}`);

    /* ساخت هدرهای پاسخ — حذف access-control-* ، transfer-encoding ، content-encoding */
    const outHeaders = new Headers();
    for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase();
      if (lk.startsWith('access-control-')) continue;
      if (lk === 'transfer-encoding' || lk === 'content-encoding' || lk === 'content-length') continue;
      if (lk === 'connection' || lk === 'keep-alive') continue;
      if (v == null) continue;
      // در @types/node جدید، مقدار هدرهای ناشناخته `unknown` است → صریح رشته می‌کنیم
      outHeaders.set(k, Array.isArray(v) ? v.map(String).join(', ') : String(v));
    }
    outHeaders.set('Cache-Control', 'no-cache, no-transform');
    outHeaders.set('X-Accel-Buffering', 'no');

    /* استریم مستقیم آپستریم → کلاینت */
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            /* بسته شده */
          }
          logReq('green', `POST /api/chat ✓ تمام شد (${Date.now() - started}ms)`);
        };
        res.on('data', (chunk: Buffer) => {
          if (closed) return;
          try {
            controller.enqueue(new Uint8Array(chunk));
          } catch {
            closed = true;
            try {
              upReq.destroy();
            } catch {
              /* noop */
            }
          }
        });
        res.on('end', close);
        res.on('error', close);
        /* اگر کلاینت وسط کار قطع شد، درخواست آپستریم هم destroy شود (دکمه توقف واقعاً کار کند) */
        req.signal?.addEventListener(
          'abort',
          () => {
            logReq('yellow', 'POST /api/chat ⏹ کلاینت قطع شد — آپستریم destroy می‌شود');
            try {
              upReq.destroy();
            } catch {
              /* noop */
            }
          },
          { once: true }
        );
      },
      cancel() {
        try {
          upReq.destroy();
        } catch {
          /* noop */
        }
      },
    });

    return new Response(stream, { status, headers: outHeaders });
  } catch (e) {
    const err = e as Error;
    const isTimeout = err.message.includes('timeout') || err.message.includes('TIMEOUT');
    logReq('red', `POST /api/chat ✖ ${err.message} (${Date.now() - started}ms)`);
    return jsonError(
      isTimeout ? 504 : 502,
      isTimeout ? 'پاسخ آپستریم بیش از حد طول کشید (۱۸۰ ثانیه).' : 'اتصال به سرویس چت برقرار نشد: ' + err.message
    );
  }
}
