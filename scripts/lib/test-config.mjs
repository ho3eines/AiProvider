/**
 * پیکربندی پروایدرهای «آزمایشی» — مشترک بین smoke test و dev:mock
 *
 * این پروایدرها همه به یک آپستریم ساختگی (scripts/mock-upstream.mjs) وصل‌اند و
 * هرکدام یک قابلیت از رجیستری را آزمودنی می‌کنند:
 *
 *   mock         شکل openai        → ساده‌ترین حالت
 *   mockfm       شکل freemodels    → نگاشت modelId/thinking/deepSearch + passthrough
 *   mockcustom   فیلدهای سفارشی    → response.textFields/reasoningFields
 *   mockclaude   پاسخ سبک Claude   → پارسر جهانی
 *   mockerr      خطای 429          → نگاشت کد/فرمت خطا
 *   mockalias    upstreamId+aliases → تطبیق نرم نام و نگاشت id
 *
 * پروایدر واقعی freemodels دست‌نخورده می‌ماند (تا رفتار پیش‌فرض هم آزموده شود).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const MOCK_GROUP = { title: 'Local Mock', icon: 'flask' };

export const MOCK_MODELS = ['mock-echo', 'mock-fm', 'mock-custom', 'mock-claude', 'mock-429', 'mock-alias', 'mock-hot'];

export function readRepoConfig() {
  return JSON.parse(readFileSync(join(ROOT, 'providers.json'), 'utf8'));
}

/** ساخت پیکربندی کامل تست (پروایدرهای ریپو + پروایدرهای آزمایشی) */
export function buildTestConfig(mockUrl, repoCfg = readRepoConfig()) {
  const mk = (id, name, models, extra = {}) => ({
    id,
    name,
    site: mockUrl,
    enabled: true,
    ownedByPrefix: id,
    upstream: {
      url: mockUrl,
      method: 'POST',
      timeoutMs: 15000,
      maxBodyBytes: 5 * 1024 * 1024,
      headers: { 'Content-Type': 'application/json', Accept: '*/*' },
      auth: null,
    },
    request: {
      shape: 'openai',
      passthrough: false,
      fields: { model: 'model', messages: 'messages', stream: 'stream' },
      constants: {},
    },
    response: { profile: 'universal' },
    groups: [MOCK_GROUP],
    models,
    ...extra,
  });

  const m = (id, name, extra = {}) => ({ id, name, vendor: 'Local', group: MOCK_GROUP.title, logo: '/logo.svg', ...extra });

  return {
    version: 1,
    defaults: { providerId: 'freemodels', modelId: 'claude-fable-5.1', timeoutMs: 15000, maxBodyBytes: 5 * 1024 * 1024 },
    providers: [
      /* پروایدرهای واقعی ریپو — mock روی پورت واقعیِ آپستریم ساختگی فعال می‌شود */
      ...(repoCfg.providers || []).map((p) =>
        p.id === 'mock' ? { ...p, enabled: true, upstream: { ...p.upstream, url: mockUrl } } : p
      ),
      mk('mockfm', 'Mock (freemodels shape)', [m('mock-fm', 'Mock FM Shape')], {
        request: {
          shape: 'freemodels',
          passthrough: true,
          fields: { model: 'modelId', messages: 'messages', stream: 'stream', thinking: 'thinking', deepSearch: 'deepSearch' },
          constants: {},
        },
      }),
      mk('mockcustom', 'Mock (custom fields)', [m('mock-custom', 'Mock Custom')], {
        request: {
          shape: 'openai',
          fields: { model: 'model', messages: 'messages', stream: 'stream' },
          constants: { mock_shape: 'custom' },
        },
        response: { profile: 'universal', textFields: ['output'], reasoningFields: ['thought'] },
      }),
      mk('mockclaude', 'Mock (claude shape)', [m('mock-claude', 'Mock Claude')], {
        request: {
          shape: 'openai',
          fields: { model: 'model', messages: 'messages', stream: 'stream' },
          constants: { mock_shape: 'claude' },
        },
      }),
      mk('mockerr', 'Mock (HTTP 429)', [m('mock-429', 'Mock 429')], {
        request: {
          shape: 'openai',
          fields: { model: 'model', messages: 'messages', stream: 'stream' },
          constants: { mock_error: 429 },
        },
      }),
      mk('mockalias', 'Mock (alias/upstreamId)', [
        m('mock-alias', 'Mock Alias', { upstreamId: 'mock-echo', aliases: ['Mock Alias', 'mock_alias'] }),
      ]),
    ],
  };
}
