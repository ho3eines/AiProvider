#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  docs-sync.mjs — همگام‌سازی بلوک‌های «تولیدی» داخل سندها با واقعیتِ کد
 * ═══════════════════════════════════════════════════════════════════════════
 *  هر جا در README.md / HANDOFF.md / AI-GUIDE.md این نشان‌ها را دیدید:
 *
 *      <!-- GENERATED:models -->  …  <!-- /GENERATED:models -->
 *
 *  محتوای بینشان توسط همین اسکریپت از روی `providers.json`، `api-keys.json`،
 *  روت‌های `src/app` و روتر `app.js` تولید می‌شود. پس برای افزودن مدل/پروایدر
 *  کافی است providers.json را عوض کنید و بزنید:  npm run docs:sync
 *
 *  حالت‌ها:
 *    node scripts/docs-sync.mjs            → بازنویسی بلوک‌ها (+ کپی در download/)
 *    node scripts/docs-sync.mjs --check    → فقط بررسی (exit 1 اگر سند عقب باشد)
 *    node scripts/docs-sync.mjs --no-copy  → کپی download/ انجام نشود
 *    node scripts/docs-sync.mjs --print models,endpoints
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = ['README.md', 'HANDOFF.md', 'AI-GUIDE.md'];
const DOWNLOAD_DIR = join(ROOT, 'download');

/* ───────────────────────── خواندن منابع حقیقت ───────────────────────── */

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
  } catch {
    return fallback;
  }
}

const providersCfg = readJson('providers.json', { providers: [] });
const apiKeys = readJson('api-keys.json', {});

const enabled = (providersCfg.providers || []).filter((p) => p && p.enabled !== false && p.upstream?.url);
const allModels = enabled.flatMap((p) =>
  (p.models || []).map((m) => ({
    ...m,
    name: m.name || m.id,
    vendor: m.vendor || p.name || p.id,
    group: m.group || p.name || p.id,
    logo: m.logo || '/logo.svg',
    providerId: p.id,
  }))
);
const defaultModel =
  (providersCfg.defaults?.modelId && allModels.some((m) => m.id === providersCfg.defaults.modelId)
    ? providersCfg.defaults.modelId
    : allModels.find((m) => m.default)?.id) || allModels[0]?.id || '';
const vendorSlug = (v) => String(v || 'unknown').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
const ownedBy = (m) => {
  const p = (providersCfg.providers || []).find((x) => x?.id === m.providerId);
  return `${p?.ownedByPrefix || p?.id || 'provider'}-${vendorSlug(m.vendor)}`;
};

/* ───────────────────────── ابزارهای کوچک ───────────────────────── */

const maskKey = (k) => (typeof k === 'string' && k.length > 12 ? `${k.slice(0, 8)}…${k.slice(-4)}` : k || '—');
const lines = (p) => {
  try {
    return readFileSync(join(ROOT, p), 'utf8').split('\n').length;
  } catch {
    return 0;
  }
};
const sizeKb = (p) => {
  try {
    return Math.max(1, Math.round(statSync(join(ROOT, p)).size / 1024));
  } catch {
    return 0;
  }
};

/** پیمایش route.ts های Next.js → { path, methods[] } */
function nextRoutes() {
  const out = [];
  const walk = (dir, urlBase) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(join(dir, e.name), e.name === 'route.ts' ? urlBase : `${urlBase}/${e.name}`);
      else if (e.name === 'route.ts') {
        const src = readFileSync(join(dir, e.name), 'utf8');
        const methods = [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)].map(
          (m) => m[1]
        );
        const rel = relative(join(ROOT, 'src/app'), dir).split(/[\\/]/).filter(Boolean);
        const url = '/' + rel.join('/').replace(/\/route$/, '');
        out.push({ path: url === '/' ? '/api (root)' : url, file: `src/app/${rel.join('/')}/route.ts`, methods });
      }
    }
  };
  walk(join(ROOT, 'src/app'), '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** روتر app.js → { path, methods[] } */
function appJsRoutes() {
  const src = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const out = [];
  const re = /req\.method === '(\w+)'(?:\s*&&\s*\(?\s*path === '([^']+)'|\s*&&\s*path === '([^']+)')?/g;
  for (const m of src.matchAll(re)) {
    const method = m[1];
    const path = m[2] || m[3];
    if (!path) continue;
    const found = out.find((r) => r.path === path);
    if (found) {
      if (!found.methods.includes(method)) found.methods.push(method);
    } else out.push({ path, methods: [method] });
  }
  /* لوگوهای embed شده */
  if (/EMBEDDED_LOGOS\[path\]/.test(src)) out.push({ path: '/<logo files>', methods: ['GET'] });
  return out;
}

/** متغیرهای محیطی استفاده‌شده در کد */
function envVars() {
  const files = [
    'app.js',
    'src/lib/providers.ts',
    'src/lib/apikeys.ts',
    'src/lib/upstream.ts',
    'src/lib/catalog.ts',
    'scripts/mock-upstream.mjs',
    'scripts/dev-mock.mjs',
  ];
  const found = new Set();
  for (const f of files) {
    let src = '';
    try {
      src = readFileSync(join(ROOT, f), 'utf8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) found.add(m[1]);
    for (const m of src.matchAll(/process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) found.add(m[1]);
  }
  for (const m of JSON.stringify(providersCfg).matchAll(/\$\{([A-Z0-9_]+)(?::-[^}]*)?\}/g)) found.add(m[1]);
  /* متغیرهایی که فقط در ابزارها/.env/package.json دیده می‌شوند ولی مستندند */
  for (const v of Object.keys(ENV_DOCS)) found.add(v);
  return [...found].sort();
}

const ENV_DOCS = {
  PORT: 'پورت سرور نسخهٔ تک‌فایل (`app.js`) — پیش‌فرض `3000`',
  HOST: 'آدرس bind نسخهٔ تک‌فایل — پیش‌فرض `127.0.0.1` (فقط محلی)؛ برای دسترسی بیرونی `0.0.0.0`',
  OPENAI_API_KEY: 'override کلید سبک OpenAI (به‌جای مقدار `api-keys.json`)',
  ANTHROPIC_API_KEY: 'override کلید سبک Anthropic (به‌جای مقدار `api-keys.json`)',
  FM_PROVIDERS_FILE: 'مسیر جایگزین برای `providers.json` (پیش‌فرض: ریشهٔ پروژه)',
  NODE_ENV: 'حالت اجرای Next.js (`production` برای `bun run start`)',
  DATABASE_URL: 'فقط برای قالب Prisma (استفاده‌نشده در منطق چت)',
  MOCK_PORT: 'پورت آپستریم ساختگی — `scripts/mock-upstream.mjs` (پیش‌فرض `4100`)',
  MOCK_HOST: 'آدرس bind آپستریم ساختگی (پیش‌فرض `0.0.0.0`)',
  FM_ENABLE_PROVIDERS: 'فهرست پروایدرهایی که اجباراً فعال شوند (جدا با کاما) — برای تست آفلاین؛ در UI هم اثر می‌کند',
  FM_DISABLE_PROVIDERS: 'فهرست پروایدرهایی که اجباراً خاموش شوند (جدا با کاما)',
};

/* ───────────────────────── تولیدکنندهٔ بلوک‌ها ───────────────────────── */

const generators = {
  /** جدول مدل‌ها (فارسی) */
  models() {
    const head = '| Model ID | نام نمایشی | سازنده | گروه | پروایدر | `owned_by` | لوگو |\n|---|---|---|---|---|---|---|';
    const rows = allModels.map((m) => {
      const star = m.id === defaultModel ? ' ⭐ **پیش‌فرض**' : '';
      return `| \`${m.id}\`${star} | ${m.name} | ${m.vendor} | ${m.group} | \`${m.providerId}\` | \`${ownedBy(m)}\` | \`${m.logo}\` |`;
    });
    return [head, ...rows].join('\n');
  },

  /** جدول مدل‌ها (انگلیسی — برای بخش‌های English) */
  'models-en'() {
    const head = '| Model ID | Display Name | Vendor | Group | Provider | `owned_by` |\n|---|---|---|---|---|---|';
    const rows = allModels.map(
      (m) =>
        `| \`${m.id}\`${m.id === defaultModel ? ' ⭐ default' : ''} | ${m.name} | ${m.vendor} | ${m.group} | \`${m.providerId}\` | \`${ownedBy(m)}\` |`
    );
    return [head, ...rows].join('\n');
  },

  /** جدول پروایدرها */
  providers() {
    const head = '| Provider | نام | سایت | آپستریم | شکل درخواست | مدل‌ها | وضعیت |\n|---|---|---|---|---|---|---|';
    const rows = (providersCfg.providers || []).map((p) => {
      const shape = p.request?.shape || 'freemodels';
      const state = p.enabled === false ? '⛔ غیرفعال' : '✅ فعال';
      return `| \`${p.id}\` | ${p.name || p.id} | ${p.site || '—'} | \`${p.upstream?.url || '—'}\` | \`${shape}\` | ${(p.models || []).length} | ${state} |`;
    });
    return [head, ...rows].join('\n');
  },

  /** جدول گروه‌های پیکر مدل */
  groups() {
    const seen = [];
    for (const p of enabled) {
      for (const g of p.groups || []) if (g?.title && !seen.some((x) => x.title === g.title)) seen.push(g);
      for (const m of p.models || []) if (m?.group && !seen.some((x) => x.title === m.group)) seen.push({ title: m.group, icon: 'globe' });
    }
    const head = '| عنوان گروه | آیکن (`groups[].icon`) | تعداد مدل |\n|---|---|---|';
    const rows = seen.map(
      (g) => `| ${g.title} | \`${g.icon || 'globe'}\` | ${allModels.filter((m) => m.group === g.title).length} |`
    );
    return [head, ...rows].join('\n');
  },

  /** اندپوینت‌ها — همگام با کد واقعی (Next + app.js) */
  endpoints() {
    const next = nextRoutes();
    const single = appJsRoutes();
    const paths = [...new Set([...next.map((r) => r.path), ...single.map((r) => r.path)])].sort();
    const head = '| مسیر | متدها (Next.js) | متدها (`app.js`) | احراز هویت | فایل (Next) |\n|---|---|---|---|---|';
    const rows = paths.map((p) => {
      const n = next.find((r) => r.path === p);
      const s = single.find((r) => r.path === p);
      const auth = p.startsWith('/v1') ? '🔑 کلید API' : p === '/<logo files>' ? '—' : 'بدون احراز هویت';
      return `| \`${p}\` | ${n ? n.methods.join(', ') : '—'} | ${s ? s.methods.join(', ') : '—'} | ${auth} | ${n ? `\`${n.file}\`` : '—'} |`;
    });
    return [head, ...rows].join('\n');
  },

  /** متغیرهای محیطی — از روی کد استخراج می‌شود */
  env() {
    const head = '| متغیر | پیش‌فرض | توضیح |\n|---|---|---|';
    const defaults = { PORT: '`3000`', HOST: '`127.0.0.1`', MOCK_PORT: '`4100`', MOCK_HOST: '`0.0.0.0`', FM_PROVIDERS_FILE: '`./providers.json`' };
    const rows = envVars().map((v) => `| \`${v}\` | ${defaults[v] || '—'} | ${ENV_DOCS[v] || '—'} |`);
    return [head, ...rows].join('\n');
  },

  /** کلیدهای API (طبق تصمیم پروژه: واقعی داخل سند) + راه چرخش */
  keys() {
    const o = apiKeys.openai || '—';
    const a = apiKeys.anthropic || '—';
    return [
      '```json',
      '{',
      `  "openai":    "${o}",`,
      `  "anthropic": "${a}"`,
      '}',
      '```',
      '',
      `> منبع: \`api-keys.json\` (ایجاد خودکار در اولین اجرا با دسترسی \`600\`) — خلاصه: OpenAI \`${maskKey(o)}\` · Anthropic \`${maskKey(a)}\``,
    ].join('\n');
  },

  /** آمار فایل‌ها — تا اعداد داخل سند هیچ‌وقت کهنه نشوند */
  stats() {
    const files = [
      ['app.js', 'نسخهٔ تک‌فایل Node (سرور + UI)'],
      ['src/app/page.tsx', 'UI چت نسخهٔ Next.js'],
      ['src/lib/catalog.ts', 'کاتالوگ ایزومورفیک پروایدرها/مدل‌ها'],
      ['src/lib/providers.ts', 'رجیستری سمت سرور (hot reload)'],
      ['src/lib/upstream.ts', 'لایهٔ انتقال به آپستریم'],
      ['src/lib/sse.ts', 'پارسر جهانی SSE'],
      ['src/lib/markdown.ts', 'رندر مارک‌داون امن'],
      ['src/app/v1/chat/completions/route.ts', 'اندپوینت سازگار OpenAI'],
      ['src/app/v1/messages/route.ts', 'اندپوینت سازگار Anthropic'],
      ['providers.json', 'رجیستری پروایدرها/مدل‌ها (منبع حقیقت)'],
    ];
    const head = '| فایل | نقش | خط | حجم |\n|---|---|---|---|';
    const rows = files.map(([f, role]) => `| \`${f}\` | ${role} | ${lines(f)} | ${sizeKb(f)} KB |`);
    return [head, ...rows].join('\n');
  },

  /** نسخهٔ خلاصهٔ سند (تعداد مدل/پروایدر/اندپوینت) */
  counts() {
    const n = nextRoutes().length;
    const s = appJsRoutes().length;
    return [
      `**پروایدرهای فعال:** ${enabled.length} · **مدل‌ها:** ${allModels.length} · **گروه‌های پیکر:** ${generators.groups().split('\n').length - 2} · **روت‌های Next:** ${n} · **روت‌های app.js:** ${s} · **مدل پیش‌فرض:** \`${defaultModel}\``,
    ].join('\n');
  },

  /** فهرست اسکریپت‌های npm */
  scripts() {
    const pkg = readJson('package.json', { scripts: {} });
    const head = '| دستور | چه کار می‌کند |\n|---|---|';
    const docs = {
      dev: 'اجرای محیط توسعهٔ Next.js روی پورت 3000 (لاگ در `dev.log`)',
      build: 'بیلد پروداکشن standalone',
      start: 'اجرای نسخهٔ پروداکشن با bun',
      standalone: 'اجرای نسخهٔ تک‌فایل بدون وابستگی (`node app.js`)',
      'dev:mock': 'محیط توسعهٔ آفلاین: آپستریم ساختگی + Next با پروایدرهای آزمایشی',
      'dev:mock:appjs': 'همان `dev:mock` ولی با نسخهٔ تک‌فایل `app.js`',
      'sync:builtin': 'بازسازی کپی `providers.json` داخل `app.js` (`BUILTIN_PROVIDERS`)',
      'verify:full': 'همهٔ بررسی‌های `verify` + `tsc` + `eslint` + smoke',
      lint: 'eslint روی کل پروژه',
      typecheck: 'بررسی انواع TypeScript بدون خروجی',
      verify: 'صحت‌سنجی همگامی کد/پیکربندی/سندها (`scripts/verify.mjs`)',
      smoke: 'تست دود end-to-end با آپستریم ساختگی (`scripts/smoke.mjs`)',
      mock: 'اجرای آپستریم ساختگی روی پورت 4100 (`scripts/mock-upstream.mjs`)',
      'docs:sync': 'به‌روزرسانی بلوک‌های تولیدی سندها (`scripts/docs-sync.mjs`)',
      'docs:check': 'بررسی عقب‌بودن سندها (بدون نوشتن)',
      'embed:logos': 'بازتولید لوگوهای base64 داخل `app.js` (`scripts/embed-logos.mjs`)',
      'check:appjs': 'بررسی سینتکس `app.js`',
      'db:push': 'Prisma — قالب باقی‌مانده (منطق چت استفاده نمی‌کند)',
      'db:generate': 'Prisma — تولید کلاینت',
      'db:migrate': 'Prisma — مایگریشن',
      'db:reset': 'Prisma — ریست دیتابیس',
    };
    const rows = Object.entries(pkg.scripts || {}).map(([k, v]) => `| \`npm run ${k}\` | ${docs[k] || `\`${v}\``} |`);
    return [head, ...rows].join('\n');
  },

  /** درخت مهارت‌ها (skills) — از روی خود فولدر */
  skills() {
    const dir = join(ROOT, 'skills');
    if (!existsSync(dir)) return '_(فولدر skills وجود ندارد)_';
    const rows = [];
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory()) continue;
      const f = join(dir, e.name, 'SKILL.md');
      if (!existsSync(f)) continue;
      const src = readFileSync(f, 'utf8');
      const desc = /^description:\s*(.+)$/m.exec(src)?.[1]?.trim() || '';
      rows.push(`| \`skills/${e.name}/\` | ${desc.replace(/^["']|["']$/g, '')} |`);
    }
    return ['| مهارت | چه کاری را آسان می‌کند |', '|---|---|', ...rows].join('\n');
  },
};

/* ───────────────────────── اعمال روی سندها ───────────────────────── */

function syncFile(path, { check }) {
  if (!existsSync(path)) return { path, changed: false, missing: true, blocks: 0 };
  const src = readFileSync(path, 'utf8');
  let out = src;
  let blocks = 0;
  const re = /<!-- GENERATED:([a-z0-9-]+) -->([\s\S]*?)<!-- \/GENERATED:\1 -->/g;
  out = out.replace(re, (_all, id, body) => {
    const gen = generators[id];
    if (!gen) {
      console.warn(`  ⚠ تولیدکنندهٔ ناشناخته: ${id} (در ${relative(ROOT, path)})`);
      return _all;
    }
    blocks++;
    return `<!-- GENERATED:${id} -->\n${gen()}\n<!-- /GENERATED:${id} -->`;
  });
  const changed = out !== src;
  if (changed && !check) writeFileSync(path, out, 'utf8');
  return { path, changed, blocks };
}

/* ───────────────────────── CLI ───────────────────────── */

const args = process.argv.slice(2);
const check = args.includes('--check');
const noCopy = args.includes('--no-copy');
const printIdx = args.indexOf('--print');

if (printIdx >= 0) {
  const ids = (args[printIdx + 1] || '').split(',').filter(Boolean);
  for (const id of ids) {
    if (!generators[id]) {
      console.error(`ناشناخته: ${id} — موجود: ${Object.keys(generators).join(', ')}`);
      process.exit(2);
    }
    console.log(`\n───── ${id} ─────\n${generators[id]()}`);
  }
  process.exit(0);
}

let stale = 0;
console.log(`${check ? 'بررسی' : 'همگام‌سازی'} بلوک‌های تولیدی سندها…`);
for (const d of DOCS) {
  const r = syncFile(join(ROOT, d), { check });
  if (r.missing) {
    console.log(`  • ${d} — وجود ندارد (رد شد)`);
    continue;
  }
  console.log(`  • ${d}: ${r.blocks} بلوک${r.changed ? (check ? ' ← ⚠ عقب است' : ' ← به‌روز شد') : ' ← همگام ✓'}`);
  if (check && r.changed) stale++;
}

if (!check && !noCopy && existsSync(DOWNLOAD_DIR)) {
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
  for (const d of DOCS) {
    const src = join(ROOT, d);
    if (existsSync(src)) {
      copyFileSync(src, join(DOWNLOAD_DIR, d));
      console.log(`  ↳ کپی شد: download/${d}`);
    }
  }
}

if (check && stale) {
  console.error(`\n✖ ${stale} سند عقب‌تر از کد/پیکربندی است → \`npm run docs:sync\` را اجرا کنید.`);
  process.exit(1);
}
if (!check) console.log('\n✓ انجام شد.');
