/**
 * مدل‌های سرویس freemodels (ID های واقعی استخراج‌شده از باندل رسمی سایت) + تطبیق نرم نام مدل
 * این لیست هم در UI (پیکر مدل) و هم در اندپوینت‌های /v1 استفاده می‌شود.
 * ⚠️ ID واقعی مدل‌های GPT فقط «sol» و «terra» است (نه gpt-5.6-sol/gpt-5.6-terra) —
 * اگر ID ناشناس بفرستیم آپستریم بی‌سروصدا به مدل پیش‌فرض (Claude) fallback می‌کند.
 */
export interface FmModel {
  id: string;
  name: string;
  vendor: string;
  group: 'Claude Pro' | 'ChatGPT Pro' | 'Other Pro Models';
}

export const FM_MODELS: FmModel[] = [
  { id: 'claude-sonnet-5',  name: 'Claude Sonnet 5',  vendor: 'Anthropic',   group: 'Claude Pro' },
  { id: 'claude-fable-5',   name: 'Claude Fable 5',   vendor: 'Anthropic',   group: 'Claude Pro' },
  { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', vendor: 'Anthropic',   group: 'Claude Pro' },
  { id: 'sol',              name: 'GPT 5.6 Sol',      vendor: 'OpenAI',      group: 'ChatGPT Pro' },
  { id: 'terra',            name: 'GPT 5.6 Terra',    vendor: 'OpenAI',      group: 'ChatGPT Pro' },
  { id: 'glm-5.2',          name: 'GLM 5.2',          vendor: 'Z.AI',        group: 'Other Pro Models' },
  { id: 'kimi-k3',          name: 'Kimi K3',          vendor: 'Moonshot AI', group: 'Other Pro Models' },
];

export const DEFAULT_MODEL_ID = 'claude-fable-5.1'; // مدل پیش‌فرض (انتخاب‌شده در سایت)

/** IDهای قدیمی اشتباه (قبل از کشف ID واقعی سایت) → ID درست — برای سازگاری با کلاینت‌های موجود */
const LEGACY_ALIASES: Record<string, string> = {
  'gpt-5.6-sol': 'sol',
  'gpt-5.6-terra': 'terra',
};

/** تطبیق نرم نام مدل: «GPT 5.6 Sol»، «gpt_5.6 sol» یا ID قدیمی «gpt-5.6-sol» هم پذیرفته می‌شود */
export function resolveModelId(input?: string | null): string {
  if (!input || typeof input !== 'string') return DEFAULT_MODEL_ID;
  const t = input.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const canonical = LEGACY_ALIASES[t] || t;
  const hit = FM_MODELS.find(
    (m) => m.id === canonical || m.name.toLowerCase() === input.trim().toLowerCase(),
  );
  return hit ? hit.id : canonical || DEFAULT_MODEL_ID;
}
