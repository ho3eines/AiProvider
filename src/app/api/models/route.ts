/**
 * GET /api/models — کاتالوگ زندهٔ مدل‌ها/گروه‌ها برای UI (بدون احراز هویت)
 *
 * فقط دادهٔ عمومی برمی‌گردد (id/name/vendor/group/logo/providerId) — هیچ اطلاعاتی
 * از URL، هدرها یا احراز هویت آپستریم نشت نمی‌کند.
 * منبع: رجیستری `providers.json` (با hot reload و کلیدهای محیطی FM_ENABLE_PROVIDERS).
 * معادل در نسخهٔ تک‌فایل: `handleCatalog` در app.js.
 */
import { NextResponse } from 'next/server';
import { getProvidersConfig } from '@/lib/providers';
import { publicCatalog } from '@/lib/catalog';
import { OPEN_CORS } from '@/lib/upstream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: OPEN_CORS });
}

export async function GET() {
  return NextResponse.json(publicCatalog(getProvidersConfig()), {
    headers: { ...OPEN_CORS, 'Cache-Control': 'no-store' },
  });
}
