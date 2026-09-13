/**
 * مدل‌های سرویس freemodels (طبق سایت) + تطبیق نرم نام مدل
 * این لیست هم در UI (datalist) و هم در اندپوینت‌های /v1 استفاده می‌شود.
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
  { id: 'gpt-5.6-sol',      name: 'GPT 5.6 Sol',      vendor: 'OpenAI',      group: 'ChatGPT Pro' },
  { id: 'gpt-5.6-terra',    name: 'GPT 5.6 Terra',    vendor: 'OpenAI',      group: 'ChatGPT Pro' },
  { id: 'glm-5.2',          name: 'GLM 5.2',          vendor: 'Z.AI',        group: 'Other Pro Models' },
  { id: 'kimi-k3',          name: 'Kimi K3',          vendor: 'Moonshot AI', group: 'Other Pro Models' },
];

export const DEFAULT_MODEL_ID = 'claude-fable-5.1'; // مدل پیش‌فرض (انتخاب‌شده در سایت)

/** تطبیق نرم نام مدل: «Claude Fable 5.1» یا «claude_fable 5.1» هم پذیرفته می‌شود */
export function resolveModelId(input?: string | null): string {
  if (!input || typeof input !== 'string') return DEFAULT_MODEL_ID;
  const t = input.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const hit = FM_MODELS.find((m) => m.id === t || m.name.toLowerCase() === input.trim().toLowerCase());
  return hit ? hit.id : t || DEFAULT_MODEL_ID;
}
