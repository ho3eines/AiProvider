/**
 * GET /api/ping — تست اتصال به آپستریم
 * یک درخواست سبک (stream:false، پیام "ping") می‌فرستد و {status, ms, sample} برمی‌گرداند.
 *
 * `GET /api/ping?model=kimi-k3` ← تست همان پروایدر/مدل (برای دیباگ چندسایتی).
 */
import { NextResponse } from 'next/server';
import { logReq, OPEN_CORS, openUpstreamRequest } from '@/lib/upstream';
import { getProvidersConfig } from '@/lib/providers';
import { buildUpstreamPayload, resolveModel } from '@/lib/catalog';
import { createSseParser } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PING_TIMEOUT_MS = 20_000;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: OPEN_CORS });
}

export async function GET(req: Request) {
  const started = Date.now();
  const cfg = getProvidersConfig();
  const wantModel = new URL(req.url).searchParams.get('model');
  const resolved = resolveModel(wantModel, cfg);
  const provider = resolved.provider;

  const body = JSON.stringify(
    buildUpstreamPayload(provider, {
      messages: [{ role: 'user', content: 'ping' }],
      modelId: resolved.id,
      thinking: false,
      deepSearch: false,
      stream: false,
    })
  );

  try {
    const up = await openUpstreamRequest({ provider, body, timeoutMs: PING_TIMEOUT_MS, label: 'GET /api/ping' });
    let data = '';
    await new Promise<void>((resolve) => {
      up.res.on('data', (c: Buffer) => {
        if (data.length < 200_000) data += c.toString('utf8');
      });
      up.res.on('end', () => resolve());
      up.res.on('error', () => resolve());
    });
    up.req.destroy();

    const ms = Date.now() - started;

    /* نمونهٔ پاسخ: ابتدا پارسر جهانی (متن/تفکر)، در نبود آن JSON خام، و در نهایت متن خام */
    let sample = '';
    const acc = { text: '', reasoning: '', error: '' };
    const parser = createSseParser({
      onEvent: (ev) => {
        acc.text += ev.text;
        acc.reasoning += ev.reasoning;
        if (ev.error && !acc.error) acc.error = ev.error;
      },
      extraTextFields: provider.response?.textFields,
      extraReasoningFields: provider.response?.reasoningFields,
      doneToken: provider.response?.doneToken,
    });
    parser.feed(data);
    parser.end();
    sample = acc.error ? '⚠️ ' + acc.error : acc.text || acc.reasoning;

    if (!sample) {
      sample = data.slice(0, 200);
      try {
        const j = JSON.parse(data) as Record<string, unknown>;
        if (j && typeof j === 'object' && 'error' in j) {
          const er = j.error as Record<string, unknown> | string;
          sample = typeof er === 'string' ? er : String((er as Record<string, unknown>)?.message ?? JSON.stringify(er));
        }
      } catch {
        /* پاسخ JSON نبود — همان متن خام */
      }
    }
    sample = sample.slice(0, 200);

    logReq('green', `GET /api/ping → ok [${provider.id}] (${ms}ms)`);
    return NextResponse.json(
      { status: 'ok', ms, sample, provider: provider.id, model: resolved.publicId },
      { headers: OPEN_CORS }
    );
  } catch (e) {
    const ms = Date.now() - started;
    const msg = (e as Error)?.message || String(e);
    logReq('red', `GET /api/ping → error [${provider.id}]: ${msg} (${ms}ms)`);
    return NextResponse.json(
      { status: 'error', ms, sample: msg.slice(0, 200), provider: provider.id, model: resolved.publicId },
      { headers: OPEN_CORS }
    );
  }
}
