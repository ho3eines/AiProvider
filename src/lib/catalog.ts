/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  کاتالوگ پروایدرها و مدل‌ها — لایهٔ ایزومورفیک (سرور + کلاینت)
 * ═══════════════════════════════════════════════════════════════════════════
 *  منبع حقیقت: `providers.json` در ریشهٔ پروژه.
 *  این فایل هیچ API سمت Node (مثل fs) استفاده نمی‌کند، پس هم در route handlerها
 *  و هم داخل client component (page.tsx) قابل import است.
 *
 *  برای افزودن مدل/پروایدر/سایت جدید هیچ کدی لازم نیست تغییر کند:
 *  فقط `providers.json` را ویرایش کنید (skills/add-model · skills/add-provider).
 *
 *  نسخهٔ سروری با reload زنده: `src/lib/providers.ts`
 *  نسخهٔ تک‌فایل app.js: `PROVIDERS` / `CATALOG` در app.js
 */
import rawConfig from '../../providers.json';

/* ───────────────────────────── انواع داده ───────────────────────────── */

/** شکل بدنهٔ درخواست آپستریم */
export type RequestShape = 'freemodels' | 'openai' | 'anthropic' | 'passthrough';

export interface ProviderModel {
  /** شناسهٔ عمومی (همین مقدار در /v1/models و UI نشان داده می‌شود) */
  id: string;
  /** نام نمایشی در پیکر مدل */
  name: string;
  /** سازنده (برای owned_by و زیرنویس UI) */
  vendor?: string;
  /** عنوان گروه در پیکر مدل */
  group?: string;
  /** مسیر/URL لوگو — `/foo.webp` از public (یا EMBEDDED_LOGOS در app.js) یا https://… */
  logo?: string;
  /** اگر آپستریم مدل را با نام دیگری می‌شناسد (پیش‌فرض: همان id) */
  upstreamId?: string;
  /** نام‌های جایگزین که resolveModel می‌پذیرد */
  aliases?: string[];
  /** مدل پیش‌فرض همین پروایدر */
  default?: boolean;
  /** توضیح کوتاه (اختیاری — فعلاً فقط مستندات) */
  description?: string;
}

export interface ProviderGroup {
  title: string;
  /** نام آیکن: sparkles | zap | globe | flask | bot (ناشناخته ← globe/فلز) */
  icon?: string;
}

export interface ProviderAuth {
  /** نام هدر احراز هویت آپستریم، مثلاً Authorization یا x-api-key */
  header?: string;
  /** مقدار هدر؛ از `${VAR}` و `${VAR:-default}` برای خواندن از env استفاده کنید */
  value?: string;
  /** میان‌بر: نام متغیر محیطی + هدر (معادل header + value: "Bearer ${env}") */
  env?: string;
  /** پیشوند مقدار (پیش‌فرض در حالت env: `Bearer `) */
  prefix?: string;
}

export interface ProviderUpstream {
  url: string;
  method?: string;
  timeoutMs?: number;
  maxBodyBytes?: number;
  headers?: Record<string, string>;
  auth?: ProviderAuth | null;
}

export interface ProviderRequest {
  shape?: RequestShape;
  /** کلیدهای ناشناختهٔ بدنهٔ ورودی هم به آپستریم پاس داده شوند (پیش‌فرض: false) */
  passthrough?: boolean;
  /** نگاشت نام فیلدهای نرمال‌شده به نام فیلدهای آپستریم */
  fields?: Partial<Record<'model' | 'messages' | 'stream' | 'thinking' | 'deepSearch' | 'maxTokens' | 'system', string>>;
  /** فیلدهای ثابتی که همیشه به بدنه اضافه می‌شوند */
  constants?: Record<string, unknown>;
}

export interface ProviderResponse {
  /** فعلاً فقط `universal` (پارسر sse.ts همهٔ فرمت‌های رایج را می‌فهمد) */
  profile?: 'universal';
  /** نام فیلدهای متنیِ اضافیِ مخصوص این آپستریم */
  textFields?: string[];
  /** نام فیلدهای «تفکر» اضافیِ مخصوص این آپستریم */
  reasoningFields?: string[];
  /** نشانهٔ پایان استریم (پیش‌فرض `[DONE]`) */
  doneToken?: string;
}

export interface Provider {
  id: string;
  name?: string;
  site?: string;
  enabled?: boolean;
  /** پیشوند owned_by در /v1/models (پیش‌فرض: id پروایدر) */
  ownedByPrefix?: string;
  upstream: ProviderUpstream;
  request?: ProviderRequest;
  response?: ProviderResponse;
  groups?: ProviderGroup[];
  models: ProviderModel[];
}

export interface ProvidersDefaults {
  providerId?: string;
  modelId?: string;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

export interface ProvidersConfig {
  version?: number;
  defaults?: ProvidersDefaults;
  providers: Provider[];
}

/** مدلِ آمادهٔ مصرف در UI (مدل + اطلاعات پروایدرش) */
export interface CatalogModel extends ProviderModel {
  providerId: string;
  providerName: string;
  group: string;
  vendor: string;
  logo: string;
}

/** بدنهٔ نرمال‌شدهٔ درخواست چت (ورودی buildUpstreamPayload) */
export interface NormalChatRequest {
  messages: Array<{ role: string; content: string }>;
  modelId: string;
  thinking?: boolean;
  deepSearch?: boolean;
  stream?: boolean;
  maxTokens?: number;
  system?: string;
  /** کلیدهای اضافی کلاینت (برای passthrough) */
  extra?: Record<string, unknown>;
}

/* ───────────────────────────── پیکربندی پایه ───────────────────────────── */

export const RAW_CONFIG = rawConfig as unknown as ProvidersConfig;

export const DEFAULT_TIMEOUT_MS = 180_000;
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

const DEFAULT_FIELDS: Record<RequestShape, NonNullable<ProviderRequest['fields']>> = {
  freemodels: { model: 'modelId', messages: 'messages', stream: 'stream', thinking: 'thinking', deepSearch: 'deepSearch' },
  openai: { model: 'model', messages: 'messages', stream: 'stream' },
  anthropic: { model: 'model', messages: 'messages', stream: 'stream', system: 'system', maxTokens: 'max_tokens' },
  passthrough: { model: 'model', messages: 'messages', stream: 'stream' },
};

/* ───────────────────────── ابزارهای کوچک ───────────────────────── */

/** جای‌گذاری `${VAR}` و `${VAR:-default}` با مقادیر محیطی */
export function expandVars(input: string, env: Record<string, string | undefined> = {}): string {
  const source = { ...(typeof process !== 'undefined' && process.env ? process.env : {}), ...env } as Record<
    string,
    string | undefined
  >;
  return String(input).replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/gi, (_m, name: string, fallback?: string) => {
    const v = source[name];
    return v == null || v === '' ? (fallback ?? '') : v;
  });
}

function normId(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

/** slug سازنده برای owned_by: «Moonshot AI» ← «moonshot-ai» */
export function vendorSlug(vendor: string): string {
  return String(vendor || 'unknown')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '');
}

/* ───────────────────────── خواندن کاتالوگ ───────────────────────── */

export function isProviderEnabled(p: Provider): boolean {
  return p?.enabled !== false;
}

/** همهٔ پروایدرهای معتبر و فعال */
export function enabledProviders(cfg: ProvidersConfig = RAW_CONFIG): Provider[] {
  return (cfg?.providers || []).filter((p) => p && typeof p.id === 'string' && p.upstream?.url && isProviderEnabled(p));
}

/** پروایدر پیش‌فرض (defaults.providerId یا اولین پروایدر فعال) */
export function defaultProvider(cfg: ProvidersConfig = RAW_CONFIG): Provider {
  const list = enabledProviders(cfg);
  const want = cfg?.defaults?.providerId;
  return (want && list.find((p) => p.id === want)) || list[0] || (cfg?.providers || [])[0];
}

/** لیست مسطح مدل‌های همهٔ پروایدرهای فعال (به‌همراه لوگو/گروه/پروایدر) */
export function listModels(cfg: ProvidersConfig = RAW_CONFIG): CatalogModel[] {
  const out: CatalogModel[] = [];
  for (const p of enabledProviders(cfg)) {
    for (const m of p.models || []) {
      if (!m || typeof m.id !== 'string') continue;
      out.push({
        ...m,
        id: m.id,
        name: m.name || m.id,
        vendor: m.vendor || p.name || p.id,
        group: m.group || p.name || p.id,
        logo: m.logo || '/logo.svg',
        providerId: p.id,
        providerName: p.name || p.id,
      });
    }
  }
  return out;
}

/** گروه‌ها به‌ترتیب تعریف (برای پیکر مدل) */
export function listGroups(cfg: ProvidersConfig = RAW_CONFIG): ProviderGroup[] {
  const seen = new Map<string, ProviderGroup>();
  for (const p of enabledProviders(cfg)) {
    for (const g of p.groups || []) {
      if (!g?.title) continue;
      if (!seen.has(g.title)) seen.set(g.title, { title: g.title, icon: g.icon || 'globe' });
    }
    /* اگر پروایدری گروه تعریف نکرده بود، گروه مدل‌هایش را از روی خود مدل‌ها بساز */
    for (const m of p.models || []) {
      const title = m?.group;
      if (title && !seen.has(title)) seen.set(title, { title, icon: 'globe' });
    }
  }
  return [...seen.values()];
}

/** مدل پیش‌فرض کل سیستم */
export function defaultModelId(cfg: ProvidersConfig = RAW_CONFIG): string {
  const models = listModels(cfg);
  const fromDefaults = cfg?.defaults?.modelId;
  if (fromDefaults && models.some((m) => m.id === fromDefaults)) return fromDefaults;
  const flagged = models.find((m) => m.default);
  if (flagged) return flagged.id;
  const dp = defaultProvider(cfg);
  const dpDefault = (dp?.models || []).find((m) => m.default);
  return dpDefault?.id || models[0]?.id || fromDefaults || '';
}

export interface ResolvedModel {
  /** id نرمال‌شده‌ای که باید به آپستریم برود (اگر ناشناخته باشد، همان ورودی نرمال‌شده) */
  id: string;
  /** id عمومی (همان چیزی که در پاسخ API برمی‌گردد) */
  publicId: string;
  model: CatalogModel | null;
  provider: Provider;
  known: boolean;
}

/**
 * تطبیق نرم نام مدل: «Claude Fable 5.1» / «claude_fable 5.1» / «claude-fable-5.1» همه یکی‌اند.
 * ورودی خالی ← مدل پیش‌فرض؛ ورودی ناشناخته ← دست‌نخورده (با پروایدر پیش‌فرض) عبور می‌کند.
 */
export function resolveModel(input?: string | null, cfg: ProvidersConfig = RAW_CONFIG): ResolvedModel {
  const models = listModels(cfg);
  const dp = defaultProvider(cfg);
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) {
    const id = defaultModelId(cfg);
    const m = models.find((x) => x.id === id) || null;
    return { id: m?.upstreamId || id, publicId: id, model: m, provider: m ? providerOf(m.providerId, cfg) || dp : dp, known: !!m };
  }
  const t = normId(raw);
  const tl = raw.toLowerCase();
  const hit =
    models.find((m) => m.id === t || m.id === tl || (m.name || '').toLowerCase() === tl) ||
    models.find((m) => (m.aliases || []).some((a) => normId(a) === t || String(a).toLowerCase() === tl));
  if (hit) {
    const provider = providerOf(hit.providerId, cfg) || dp;
    return { id: hit.upstreamId || hit.id, publicId: hit.id, model: hit, provider, known: true };
  }
  return { id: t, publicId: t, model: null, provider: dp, known: false };
}

export function providerOf(id: string, cfg: ProvidersConfig = RAW_CONFIG): Provider | undefined {
  return (cfg?.providers || []).find((p) => p?.id === id);
}

/** سازگار با کد قبلی: فقط id نرمال‌شده */
export function resolveModelId(input?: string | null, cfg: ProvidersConfig = RAW_CONFIG): string {
  return resolveModel(input, cfg).publicId;
}

/** owned_by برای /v1/models — دقیقاً مثل قبل: `freemodels-anthropic` */
export function ownedBy(model: CatalogModel, cfg: ProvidersConfig = RAW_CONFIG): string {
  const p = providerOf(model.providerId, cfg);
  const prefix = p?.ownedByPrefix || p?.id || 'provider';
  return prefix + '-' + vendorSlug(model.vendor);
}

/* ───────────────────── ساخت بدنهٔ درخواست آپستریم ───────────────────── */

/**
 * بدنهٔ نرمال چت را به شکل مورد انتظار آپستریمِ همان پروایدر تبدیل می‌کند.
 * با `shape: "freemodels"` خروجی دقیقاً همان JSON قبلی پروژه است.
 */
export function buildUpstreamPayload(provider: Provider, req: NormalChatRequest): Record<string, unknown> {
  const shape: RequestShape = provider?.request?.shape || 'freemodels';
  if (shape === 'passthrough' && req.extra) return { ...req.extra };

  const fields = { ...DEFAULT_FIELDS[shape], ...(provider?.request?.fields || {}) };
  const out: Record<string, unknown> = {};
  const put = (key: string | undefined, value: unknown) => {
    if (key) out[key] = value;
  };

  if (req.extra && provider?.request?.passthrough) Object.assign(out, req.extra);

  put(fields.messages, req.messages);
  put(fields.model, req.modelId);
  /* اگر caller مقدار stream را تعیین نکرده (undefined) هیچ ست نمی‌شود تا رفتار آپستریم دست‌نخورده بماند */
  if (req.stream !== undefined) put(fields.stream, req.stream === true);
  if (fields.thinking) put(fields.thinking, req.thinking === true);
  if (fields.deepSearch) put(fields.deepSearch, req.deepSearch === true);
  if (fields.maxTokens && req.maxTokens != null) put(fields.maxTokens, req.maxTokens);

  /* سبک anthropic: system به‌عنوان فیلد جدا (نه پیام) */
  if (req.system && req.system.trim()) {
    if (fields.system) put(fields.system, req.system.trim());
    else if (fields.messages) out[fields.messages] = [{ role: 'system', content: req.system.trim() }, ...req.messages];
  }
  /* سبک freemodels: system به‌عنوان اولین پیام */
  if (shape === 'freemodels' && req.system && req.system.trim() && fields.messages) {
    const list = out[fields.messages] as Array<{ role: string; content: string }>;
    if (Array.isArray(list) && list[0]?.content !== req.system.trim()) {
      out[fields.messages] = [{ role: 'system', content: req.system.trim() }, ...list];
    }
  }

  if (provider?.request?.constants) Object.assign(out, provider.request.constants);
  return out;
}

/* ───────────────────────── هدرهای آپستریم ───────────────────────── */

export interface UpstreamRequestOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxBodyBytes: number;
  /** متغیرهای محیطیِ جای‌گذاری‌نشده (برای لاگ/دیباگ) */
  missingEnv: string[];
}

/** URL + هدرهای نهایی یک پروایدر (با جای‌گذاری `${VAR}` از env) */
export function upstreamOptions(provider: Provider, cfg: ProvidersConfig = RAW_CONFIG): UpstreamRequestOptions {
  const env = typeof process !== 'undefined' && process.env ? (process.env as Record<string, string | undefined>) : {};
  const missing: string[] = [];
  const expand = (v: string): string =>
    String(v).replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/gi, (_m, name: string, fallback?: string) => {
      const got = env[name];
      if ((got == null || got === '') && fallback == null) missing.push(name);
      return got == null || got === '' ? (fallback ?? '') : got;
    });

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(provider?.upstream?.headers || {})) headers[k] = expand(String(v));

  const auth = provider?.upstream?.auth;
  if (auth && (auth.header || auth.env)) {
    const header = auth.header || 'Authorization';
    let value = '';
    if (auth.value) value = expand(auth.value);
    else if (auth.env) {
      const got = env[auth.env];
      if (got) value = (auth.prefix ?? 'Bearer ') + got;
      else missing.push(auth.env);
    }
    if (value) headers[header] = value;
  }

  return {
    url: expand(provider.upstream.url),
    method: (provider.upstream.method || 'POST').toUpperCase(),
    headers,
    timeoutMs: provider.upstream.timeoutMs ?? cfg?.defaults?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBodyBytes: provider.upstream.maxBodyBytes ?? cfg?.defaults?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    missingEnv: missing,
  };
}

/* ───────────────────── نسخهٔ عمومی (برای کلاینت) ───────────────────── */

export interface PublicCatalog {
  defaultModel: string;
  groups: ProviderGroup[];
  models: Array<Pick<CatalogModel, 'id' | 'name' | 'vendor' | 'group' | 'logo' | 'providerId' | 'default'>>;
}

/**
 * فقط آن‌چه UI لازم دارد (بدون URL/هدر/احراز هویت آپستریم).
 * در app.js همین آبجکت داخل `window.__FM__` تزریق می‌شود.
 */
export function publicCatalog(cfg: ProvidersConfig = RAW_CONFIG): PublicCatalog {
  return {
    defaultModel: defaultModelId(cfg),
    groups: listGroups(cfg),
    models: listModels(cfg).map((m) => ({
      id: m.id,
      name: m.name,
      vendor: m.vendor,
      group: m.group,
      logo: m.logo,
      providerId: m.providerId,
      default: m.default === true,
    })),
  };
}

/** کاتالوگ پیش‌فرض (از providers.json بسته‌بندی‌شده) */
export const CATALOG: PublicCatalog = publicCatalog(RAW_CONFIG);

/** لیست سازگار با کد قبلی: FM_MODELS */
export const FM_MODELS: CatalogModel[] = listModels(RAW_CONFIG);

/** سازگار با کد قبلی */
export const DEFAULT_MODEL_ID: string = defaultModelId(RAW_CONFIG);

/* ───────────────────────── کلیدهای محیطی رجیستری ───────────────────────── */

/**
 * فعال/غیرفعال‌کردن پروایدرها با متغیر محیطی (بدون ویرایش providers.json):
 *   FM_ENABLE_PROVIDERS="mock,mockfm"   → فقط این‌ها (به‌علاوه فعال‌های فعلی) روشن می‌شوند
 *   FM_DISABLE_PROVIDERS="freemodels"   → این‌ها خاموش می‌شوند
 * برای توسعهٔ آفلاین/تست دود استفاده می‌شود (skills/add-provider § تست).
 */
export function withEnvToggles(cfg: ProvidersConfig, env: Record<string, string | undefined> = {}): ProvidersConfig {
  const source = { ...(typeof process !== 'undefined' && process.env ? process.env : {}), ...env } as Record<
    string,
    string | undefined
  >;
  const enable = (source.FM_ENABLE_PROVIDERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const disable = (source.FM_DISABLE_PROVIDERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!enable.length && !disable.length) return cfg;

  return {
    ...cfg,
    providers: (cfg.providers || []).map((p) => {
      if (!p?.id) return p;
      if (disable.includes(p.id)) return { ...p, enabled: false };
      if (enable.includes(p.id)) return { ...p, enabled: true };
      return p;
    }),
  };
}
