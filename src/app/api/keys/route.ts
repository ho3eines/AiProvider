/**
 * GET /api/keys — کلیدهای API برای نمایش در مودال ⚙️ تنظیمات
 * (اپ محلی است؛ همان کلیدهایی که در بنر app.js و فایل api-keys.json هستند)
 */
import { NextResponse } from 'next/server';
import { getApiKeys } from '@/lib/apikeys';
import { V1_CORS } from '@/lib/v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: V1_CORS });
}

export async function GET() {
  const k = getApiKeys();
  return NextResponse.json({ openai: k.openai, anthropic: k.anthropic }, { headers: V1_CORS });
}
