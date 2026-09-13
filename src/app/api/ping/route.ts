/**
 * GET /api/ping — تست اتصال به آپستریم
 * یک درخواست سبک (stream:false، پیام "ping") می‌فرستد و {status, ms, sample} برمی‌گرداند.
 */
import { NextResponse } from 'next/server';
import { request as httpsRequest } from 'node:https';
import { UPSTREAM_URL, SPOOFED_HEADERS, logReq, OPEN_CORS } from '@/lib/upstream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: OPEN_CORS });
}

export async function GET() {
  const started = Date.now();
  const body = JSON.stringify({
    messages: [{ role: 'user', content: 'ping' }],
    modelId: 'claude-fable-5.1',
    thinking: false,
    deepSearch: false,
    stream: false,
  });

  try {
    const text = await new Promise<string>((resolve, reject) => {
      const upReq = httpsRequest(
        UPSTREAM_URL,
        {
          method: 'POST',
          headers: { ...SPOOFED_HEADERS, 'Content-Length': String(Buffer.byteLength(body, 'utf8')) },
        },
        (res) => {
          let data = '';
          res.on('data', (c: Buffer) => {
            if (data.length < 200_000) data += c.toString('utf8');
          });
          res.on('end', () => resolve(data));
          res.on('error', reject);
        }
      );
      upReq.setTimeout(20_000, () => upReq.destroy(new Error('timeout')));
      upReq.on('error', reject);
      upReq.write(body, 'utf8');
      upReq.end();
    });

    const ms = Date.now() - started;
    let sample = text.slice(0, 200);
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      if (j && typeof j === 'object' && 'error' in j) {
        const er = j.error as Record<string, unknown> | string;
        sample = typeof er === 'string' ? er : String((er as Record<string, unknown>)?.message ?? JSON.stringify(er));
      } else if (typeof j?.content === 'string') sample = j.content;
      else if (typeof j?.text === 'string') sample = j.text;
      else if (j && Array.isArray((j as Record<string, unknown>).choices)) {
        const c = (j as Record<string, any>).choices?.[0];
        if (typeof c?.message?.content === 'string') sample = c.message.content;
      }
    } catch {
      /* پاسخ JSON نبود — همان متن خام */
    }
    sample = sample.slice(0, 200);

    logReq('green', `GET /api/ping → ok (${ms}ms)`);
    return NextResponse.json({ status: 'ok', ms, sample }, { headers: OPEN_CORS });
  } catch (e) {
    const ms = Date.now() - started;
    const msg = (e as Error)?.message || String(e);
    logReq('red', `GET /api/ping → error: ${msg} (${ms}ms)`);
    return NextResponse.json({ status: 'error', ms, sample: msg.slice(0, 200) }, { headers: OPEN_CORS });
  }
}
