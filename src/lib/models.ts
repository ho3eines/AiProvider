/**
 * لایهٔ سازگاری با کد قبلی — منبع حقیقتِ مدل‌ها اکنون `providers.json` است.
 *
 * این فایل فقط re-export است تا import های قدیمی (`@/lib/models`) کار کنند.
 * برای کار جدید از این‌ها استفاده کنید:
 *  • سرور (با hot reload):   `@/lib/providers`  → getProvidersConfig()
 *  • کلاینت/مشترک (استاتیک): `@/lib/catalog`    → listModels(), resolveModel(), publicCatalog()
 */
import { RAW_CONFIG, defaultModelId, listModels, resolveModelId } from './catalog';
import type { CatalogModel } from './catalog';

export type FmModel = CatalogModel;

export const FM_MODELS: CatalogModel[] = listModels(RAW_CONFIG);

export const DEFAULT_MODEL_ID: string = defaultModelId(RAW_CONFIG);

export { resolveModelId };

/** همهٔ مدل‌های کاتالوگ (با اطلاعات پروایدر) — از پیکربندی داده‌شده */
export const allModels = listModels;
