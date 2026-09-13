/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  رجیستری پروایدرها — نسخهٔ سمت سرور (با بارگذاری زنده از دیسک)
 * ═══════════════════════════════════════════════════════════════════════════
 *  فقط در route handlerها / کد سروری import شود (چون `node:fs` دارد).
 *  برای UI از `@/lib/catalog` استفاده کنید (ایزومورفیک، بدون fs).
 *
 *  رفتار: `providers.json` از ریشهٔ پروژه خوانده می‌شود (یا مسیر `FM_PROVIDERS_FILE`)
 *  و با تغییر فایل، بدون restart مجدد خوانده می‌شود (hot reload با throttle یک ثانیه).
 *  اگر فایل نبود/خراب بود ← نسخهٔ bundled داخل `catalog.ts` مصرف می‌شود تا اپ هرگز نخوابد.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RAW_CONFIG, defaultProvider, enabledProviders, listModels, withEnvToggles, type ProvidersConfig } from './catalog';

export * from './catalog';

const CONFIG_FILE = (process.env.FM_PROVIDERS_FILE || '').trim() || join(process.cwd(), 'providers.json');
const RELOAD_THROTTLE_MS = 1000;

interface Cache {
  cfg: ProvidersConfig;
  mtimeMs: number;
  checkedAt: number;
  source: 'file' | 'bundled';
}

let cache: Cache | null = null;
let warned = false;

function warnOnce(msg: string): void {
  if (warned) return;
  warned = true;
  console.warn('[providers] ' + msg);
}

function load(): Cache {
  let mtimeMs = 0;
  try {
    if (existsSync(CONFIG_FILE)) mtimeMs = statSync(CONFIG_FILE).mtimeMs;
  } catch {
    mtimeMs = 0;
  }

  if (!mtimeMs) {
    return { cfg: withEnvToggles(RAW_CONFIG), mtimeMs: 0, checkedAt: Date.now(), source: 'bundled' };
  }

  try {
    const parsed = withEnvToggles(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as ProvidersConfig);
    if (!parsed || !Array.isArray(parsed.providers)) throw new Error('کلید providers آرایه نیست');
    const ok = enabledProviders(parsed);
    if (!ok.length) throw new Error('هیچ پروایدر فعال/معتبری در فایل نیست');
    if (!listModels(parsed).length) throw new Error('هیچ مدلی در پروایدرهای فعال تعریف نشده');
    return { cfg: parsed, mtimeMs, checkedAt: Date.now(), source: 'file' };
  } catch (e) {
    warnOnce(`providers.json خوانده نشد (${(e as Error).message}) — از نسخهٔ داخلی استفاده می‌شود.`);
    return { cfg: withEnvToggles(RAW_CONFIG), mtimeMs, checkedAt: Date.now(), source: 'bundled' };
  }
}

/** پیکربندی فعلی پروایدرها (با hot reload) */
export function getProvidersConfig(): ProvidersConfig {
  const now = Date.now();
  if (cache && now - cache.checkedAt < RELOAD_THROTTLE_MS) return cache.cfg;

  let mtimeMs = 0;
  try {
    if (existsSync(CONFIG_FILE)) mtimeMs = statSync(CONFIG_FILE).mtimeMs;
  } catch {
    mtimeMs = 0;
  }

  if (cache && cache.mtimeMs === mtimeMs) {
    cache.checkedAt = now;
    return cache.cfg;
  }

  cache = load();
  if (cache.source === 'file') warned = false;
  return cache.cfg;
}

/** بارگذاری اجباری مجدد (برای تست/اسکریپت‌ها) */
export function reloadProviders(): ProvidersConfig {
  cache = null;
  warned = false;
  return getProvidersConfig();
}

/** مسیر فایل پیکربندی (برای لاگ و دیباگ) */
export function providersFilePath(): string {
  return CONFIG_FILE;
}

/** خلاصهٔ وضعیت برای لاگ شروع سرور */
export function providersSummary(): string {
  const cfg = getProvidersConfig();
  const ps = enabledProviders(cfg);
  const models = listModels(cfg);
  const dp = defaultProvider(cfg);
  return `${ps.length} provider (${ps.map((p) => p.id).join(', ')}) · ${models.length} model · default ${dp?.id}/${defaultProviderModel(cfg)}`;
}

function defaultProviderModel(cfg: ProvidersConfig): string {
  const dp = defaultProvider(cfg);
  return (dp?.models || []).find((m) => m.default)?.id || dp?.models?.[0]?.id || '-';
}
