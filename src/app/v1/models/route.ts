/**
 * GET /v1/models — لیست مدل‌ها به فرمت OpenAI (نیاز به کلید)
 *
 * • لیست از رجیستری `providers.json` می‌آید (همهٔ پروایدرهای فعال)
 * • `owned_by = <ownedByPrefix>-<vendor>` (مثلاً freemodels-anthropic)
 * • `GET /v1/models?extra=1` ← فیلدهای غیراستاندارد group/vendor/logo/provider هم برمی‌گردد
 */
import { NextRequest, NextResponse } from 'next/server';
import { bearerFrom, getApiKeys, keyIsValid } from '@/lib/apikeys';
import { getProvidersConfig } from '@/lib/providers';
import { listModels, ownedBy } from '@/lib/catalog';
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

  const cfg = getProvidersConfig();
  const extra = req.nextUrl.searchParams.get('extra') === '1';

  return NextResponse.json(
    {
      object: 'list',
      data: listModels(cfg).map((m) => ({
        id: m.id,
        object: 'model',
        created: CREATED,
        owned_by: ownedBy(m, cfg),
        ...(extra ? { group: m.group, vendor: m.vendor, logo: m.logo, provider: m.providerId } : {}),
      })),
    },
    { headers: V1_CORS },
  );
}
