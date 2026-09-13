/**
 * GET /v1/models — لیست مدل‌ها به فرمت OpenAI (عمومی — بدون کلید)
 * برخی کلاینت‌ها هنگام Model Discovery (تست اتصال) کلید نمی‌فرستند؛
 * بنابراین این اندپوینت عمداً باز است — لیست مدل‌ها اطلاعات حساسی ندارد.
 * اندپوینت‌های چت (/v1/chat/completions و /v1/messages) همچنان کلید می‌خواهند.
 */
import { NextResponse } from 'next/server';
import { FM_MODELS } from '@/lib/models';
import { V1_CORS } from '@/lib/v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CREATED = Math.floor(Date.now() / 1000);

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: V1_CORS });
}

export async function GET() {
  return NextResponse.json(
    {
      object: 'list',
      data: FM_MODELS.map((m) => ({
        id: m.id,
        object: 'model',
        created: CREATED,
        owned_by: 'freemodels-' + m.vendor.toLowerCase().replace(/\s+/g, '-'),
      })),
    },
    { headers: V1_CORS },
  );
}
