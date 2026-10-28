/**
 * GET /api/keys — کلیدهای API برای نمایش در مودال ⚙️ تنظیمات
 *
 * ⚠️ امنیت: این اندپوینت بدون احراز هویت است (اپ محلی این‌طور طراحی شده).
 * در استقرار عمومی (Railway/Docker روی اینترنت) حتماً `EXPOSE_KEYS=false` را ست کنید
 * تا کلیدها ماسک شوند؛ آن‌گاه کلیدهای واقعی فقط از راه متغیرهای محیطی قابل استفاده‌اند.
 */
import { NextResponse } from 'next/server';
import { getApiKeys, keysExposed, maskKey } from '@/lib/apikeys';
import { V1_CORS } from '@/lib/v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: V1_CORS });
}

export async function GET() {
  const k = getApiKeys();
  const exposed = keysExposed();
  return NextResponse.json(
    exposed
      ? { openai: k.openai, anthropic: k.anthropic, exposed: true }
      : {
          openai: maskKey(k.openai),
          anthropic: maskKey(k.anthropic),
          exposed: false,
          hint: 'کلیدها در این استقرار مخفی‌اند (EXPOSE_KEYS=false). مقدار واقعی را از متغیرهای محیطی Railway بخوانید.',
        },
    { headers: V1_CORS },
  );
}
