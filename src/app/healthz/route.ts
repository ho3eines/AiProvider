/**
 * GET /healthz — بررسی سلامت سبک (مخصوص Docker / Railway / هر ارکستراتوری)
 *
 * چرا یک اندپوینت جدا از `/api/ping`؟
 * `/api/ping` واقعاً به آپستریم (freemodels) درخواست می‌دهد؛ اگر آپستریم 429 یا
 * قطعی موقت داشته باشد، health check شکست می‌خورد و Railway کانتینرِ سالم را
 * ری‌استارت می‌کند. `/healthz` فقط خودِ سرور را بررسی می‌کند (بدون شبکه) و
 * همیشه سریع (<۵ms) پاسخ 200 می‌دهد.
 */
import { NextResponse } from 'next/server';
import { UPSTREAM_URL } from '@/lib/upstream';
import { FM_MODELS, DEFAULT_MODEL_ID } from '@/lib/models';
import { keysExposed } from '@/lib/apikeys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STARTED_AT = Date.now();

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'smart-chat',
      runtime: 'next-standalone',
      uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
      node: process.version,
      models: FM_MODELS.length,
      defaultModel: DEFAULT_MODEL_ID,
      upstream: UPSTREAM_URL,
      keysExposed: keysExposed(),
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}

export async function HEAD() {
  return new NextResponse(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
