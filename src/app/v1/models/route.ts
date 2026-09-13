/**
 * GET /v1/models — لیست مدل‌ها به فرمت OpenAI (نیاز به کلید)
 */
import { NextRequest, NextResponse } from 'next/server';
import { FM_MODELS } from '@/lib/models';
import { bearerFrom, getApiKeys, keyIsValid } from '@/lib/apikeys';
import { V1_CORS } from '@/lib/v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CREATED = Math.floor(Date.now() / 1000);

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: V1_CORS });
}

export async function GET(req: NextRequest) {
  const keys = getApiKeys();
  const key = bearerFrom(req.headers.get('authorization')) || (req.headers.get('x-api-key') || '').trim();
  if (!keyIsValid(key, keys)) {
    return NextResponse.json(
      {
        error: {
          message: 'کلید API نامعتبر است. کلید را از بنر اجرا یا بخش ⚙️ تنظیمات بگیرید.',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_api_key',
        },
      },
      { status: 401, headers: V1_CORS },
    );
  }
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
