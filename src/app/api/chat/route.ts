/**
 * POST /api/chat — پروکسی چت به آپستریم با جعل هدرهای مرورگر
 *
 * • پروایدر از روی `modelId` (یا `model`) انتخاب می‌شود ← رجیستری `providers.json`
 * • بدنهٔ درخواست به شکل مورد انتظارِ همان آپستریم بازسازی می‌شود (buildUpstreamPayload)
 * • پاسخ آپستریم به‌صورت pipe مستقیم (بدون بافر تجمعی) رد می‌شود تا استریم SSE زنده بماند
 * • قطع کلاینت ← destroy فوری اتصال آپستریم (نشتی اتصال ممنوع)
 */
import { NextResponse } from 'next/server';
import { MAX_BODY_BYTES, UPSTREAM_TIMEOUT_MS, logReq, OPEN_CORS, openUpstreamFor } from '@/lib/upstream';
import { getProvidersConfig } from '@/lib/providers';
import { buildUpstreamPayload, resolveModel } from '@/lib/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** پاسخ OPTIONS با CORS باز */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: OPEN_CORS });
}

function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...OPEN_CORS },
  });
}

export async function POST(req: Request) {
  const started = Date.now();
  const cfg = getProvidersConfig();
  try {
    /* محدودیت حجم بدنه: ۵ مگابایت (پیش‌فرض سراسری) */
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

    /* انتخاب پروایدر بر اساس مدل + بازسازی بدنه در شکلِ همان آپستریم */
    let outBody = body;
    let resolved = resolveModel(null, cfg);
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      resolved = resolveModel(
        typeof parsed.modelId === 'string' ? parsed.modelId : typeof parsed.model === 'string' ? parsed.model : null,
        cfg
      );
      const { modelId: _m, model: _m2, ...rest } = parsed;
      outBody = JSON.stringify(
        buildUpstreamPayload(resolved.provider, {
          messages: Array.isArray(parsed.messages) ? (parsed.messages as Array<{ role: string; content: string }>) : [],
          modelId: resolved.id,
          thinking: parsed.thinking === true,
          deepSearch: parsed.deepSearch === true || parsed.deep_search === true,
          stream: typeof parsed.stream === 'boolean' ? parsed.stream : undefined,
          maxTokens: typeof parsed.max_tokens === 'number' ? parsed.max_tokens : undefined,
          system: typeof parsed.system === 'string' ? parsed.system : undefined,
          extra: rest,
        })
      );
      if (Buffer.byteLength(outBody, 'utf8') > (resolved.provider.upstream.maxBodyBytes || MAX_BODY_BYTES)) {
        logReq('yellow', `POST /api/chat → 413 (provider ${resolved.provider.id} cap)`);
        return jsonError(413, 'حجم درخواست بیش از حد مجاز این پروایدر است.');
      }
    } catch {
      /* بدنه JSON نبود — همان‌طور که هست به پروایدر پیش‌فرض پاس داده می‌شود (رفتار قدیمی) */
    }

    /* اتصال به آپستریم با هدرهای جعلیِ همان پروایدر */
    const { status, headers, res, req: upReq } = await openUpstreamFor(resolved.provider, outBody, UPSTREAM_TIMEOUT_MS);
    logReq('cyan', `POST /api/chat ← [${resolved.provider.id}/${resolved.publicId}] آپستریم پاسخ داد: ${status}`);

    /* ساخت هدرهای پاسخ — حذف access-control-* ، transfer-encoding ، content-encoding */
    const outHeaders = new Headers();
    for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase();
      if (lk.startsWith('access-control-')) continue;
      if (lk === 'transfer-encoding' || lk === 'content-encoding' || lk === 'content-length') continue;
      if (lk === 'connection' || lk === 'keep-alive') continue;
      if (v == null) continue;
      outHeaders.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    outHeaders.set('Cache-Control', 'no-cache, no-transform');
    outHeaders.set('X-Accel-Buffering', 'no');
    outHeaders.set('X-Provider', resolved.provider.id);

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
