#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  verify.mjs — صحت‌سنجی همگامیِ کد / پیکربندی / سندها (بدون وابستگی خارجی)
 * ═══════════════════════════════════════════════════════════════════════════
 *  این اسکریپت «قانون‌های ماندگار» پروژه را به‌صورت خودکار چک می‌کند تا افزودن
 *  پروایدر/مدل یا ویرایش app.js هیچ‌وقت باعث دریفت نشود:
 *
 *   1. providers.json معتبر است (ساختار، یکتایی id، گروه/لوگو/شکل درخواست)
 *   2. app.js سینتکس سالم دارد + PAGE_JS/PAGE_CSS استخراج و جداگانه چک می‌شوند
 *   3. در PAGE_JS/PAGE_CSS هیچ backtick و ${ و </script نیست (قانون طلایی)
 *   4. BUILTIN_PROVIDERS داخل app.js دقیقاً برابر providers.json است
 *   5. MODELS_FALLBACK داخل PAGE_JS برابر مدل‌های پروایدر پیش‌فرض است
 *   6. هیچ «لیست موازی» از مدل‌ها در src/ وجود ندارد (منبع واحد: providers.json)
 *   7. نسخهٔ Next کاتالوگ را از @/lib/catalog می‌خواند
 *   8. سندها (README/HANDOFF/AI-GUIDE) عقب‌تر از کد نیستند (بلوک‌های GENERATED)
 *   9. سندها سالم‌اند (بدون بایت NUL/UTF-16، پایان با خط جدید) و کپی download/ همگام است
 *
 *  اجرا:  npm run verify          (سریع — بدون نیاز به شبکه)
 *         npm run verify -- --full  (+ typecheck + lint + smoke test)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const full = args.includes('--full');

let errors = 0;
let warnings = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => {
  warnings++;
  console.log(`  ⚠ ${m}`);
};
const fail = (m) => {
  errors++;
  console.log(`  ✗ ${m}`);
};
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const exists = (p) => existsSync(join(ROOT, p));

/* ───────────────────── 1) providers.json ───────────────────── */

section('providers.json — اعتبارسنجی پیکربندی');
let cfg = null;
try {
  cfg = JSON.parse(read('providers.json'));
  ok('JSON معتبر است');
} catch (e) {
  fail(`providers.json خوانده نشد: ${e.message}`);
}

/* اعتبارسنجی با JSON Schema (اختیاری — فقط اگر ajv نصب باشد) */
if (cfg && exists('docs/providers.schema.json')) {
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const Ajv = req('ajv');
    const ajv = new Ajv({ strict: false, allErrors: true });
    const validate = ajv.compile(JSON.parse(read('docs/providers.schema.json')));
    if (validate(cfg)) ok('با docs/providers.schema.json مطابقت دارد');
    else fail('خطای اسکیمای providers.json: ' + (validate.errors || []).slice(0, 4).map((e) => `${e.instancePath || '/'} ${e.message}`).join(' · '));
  } catch (e) {
    warn(`اعتبارسنجی اسکیمای JSON انجام نشد (${e.message?.slice(0, 60)}) — ajv نصب نیست؟`);
  }
}

const SHAPES = ['freemodels', 'openai', 'anthropic', 'passthrough'];
const modelIds = [];
if (cfg) {
  if (!Array.isArray(cfg.providers) || !cfg.providers.length) fail('کلید providers آرایهٔ غیرخالی نیست');
  const ids = new Set();
  for (const p of cfg.providers || []) {
    if (!p?.id) {
      fail('پروایدری بدون id وجود دارد');
      continue;
    }
    if (ids.has(p.id)) fail(`id تکراری پروایدر: ${p.id}`);
    ids.add(p.id);
    if (!p.upstream?.url) fail(`پروایدر ${p.id}: upstream.url ندارد`);
    else if (!/^https?:\/\//i.test(p.upstream.url)) fail(`پروایدر ${p.id}: آدرس آپستریم باید http(s) باشد → ${p.upstream.url}`);
    const shape = p.request?.shape || 'freemodels';
    if (!SHAPES.includes(shape)) fail(`پروایدر ${p.id}: shape ناشناخته «${shape}» (مجاز: ${SHAPES.join(', ')})`);
    if (!Array.isArray(p.models) || !p.models.length) warn(`پروایدر ${p.id}: هیچ مدلی ندارد (در UI/API دیده نمی‌شود)`);
    const groupTitles = new Set((p.groups || []).map((g) => g?.title));
    for (const m of p.models || []) {
      if (!m?.id) {
        fail(`پروایدر ${p.id}: مدلی بدون id`);
        continue;
      }
      if (modelIds.includes(m.id)) fail(`id تکراری مدل در کل رجیستری: ${m.id}`);
      modelIds.push(m.id);
      if (m.group && groupTitles.size && !groupTitles.has(m.group)) {
        warn(`پروایدر ${p.id}: مدل ${m.id} گروه «${m.group}» دارد که در groups تعریف نشده (آیکن پیش‌فرض globe)`);
      }
      if (m.logo && m.logo.startsWith('/') && !exists(`public${m.logo}`)) {
        warn(`پروایدر ${p.id}: لوگوی ${m.logo} در public/ نیست (app.js: با npm run embed:logos جاسازی شود)`);
      }
    }
    /* جای‌گذاری‌های محیطی — فقط اطلاع‌رسانی */
    const envRefs = JSON.stringify(p).match(/\$\{([A-Z0-9_]+)(?::-[^}]*)?\}/gi) || [];
    if (envRefs.length) ok(`پروایدر ${p.id}: از env استفاده می‌کند → ${[...new Set(envRefs)].join(', ')}`);
    /* هشدار: مقدار لفظیِ شبیه کلید داخل پیکربندی (باید ${VAR} باشد) */
    const raw = JSON.stringify(p);
    if (/sk-[A-Za-z0-9_-]{20,}/.test(raw) || /Bearer\s+[A-Za-z0-9_\-\.]{20,}/i.test(raw)) {
      fail(`پروایدر ${p.id}: مقدار کلید به‌صورت لفظی در providers.json است — از \${ENV_VAR} استفاده کنید`);
    }
  }
  const enabled = (cfg.providers || []).filter((p) => p?.enabled !== false);
  if (!enabled.length) fail('هیچ پروایدر فعالی وجود ندارد');
  const enabledIds = new Set(enabled.map((p) => p.id));
  const enabledModels = enabled.flatMap((p) => (p.models || []).map((m) => m?.id));
  if (cfg.defaults?.providerId && !enabledIds.has(cfg.defaults.providerId)) {
    fail(`defaults.providerId = ${cfg.defaults.providerId} در میان پروایدرهای فعال نیست`);
  }
  if (cfg.defaults?.modelId && !enabledModels.includes(cfg.defaults.modelId)) {
    fail(`defaults.modelId = ${cfg.defaults.modelId} در میان مدل‌های فعال نیست`);
  }
  const flagged = (cfg.providers || [])
    .filter((p) => p?.enabled !== false)
    .flatMap((p) => (p.models || []).filter((m) => m?.default).map((m) => m.id));
  if (flagged.length > 1) warn(`بیش از یک مدل "default": true دارد (${flagged.join(', ')}) — فقط اولی اثر می‌کند`);
  if (!flagged.length && !cfg.defaults?.modelId) {
    warn('هیچ مدل پیش‌فرضی تعیین نشده (defaults.modelId یا مدل با "default": true)');
  }
  /* اولویت واقعی در کد: defaults.modelId ← بعد مدلِ "default": true (catalog.defaultModelId) */
  if (cfg.defaults?.modelId && flagged.length && flagged[0] !== cfg.defaults.modelId) {
    warn(`defaults.modelId = ${cfg.defaults.modelId} ولی مدل ${flagged[0]} هم "default": true دارد — در عمل ${cfg.defaults.modelId} انتخاب می‌شود؛ یکی را حذف کنید`);
  }
  ok(`${enabled.length} پروایدر فعال · ${enabledModels.length} مدل`);
}

/* ───────────────────── 2/3/4/5) app.js ───────────────────── */

section('app.js — نسخهٔ تک‌فایل');
let appSrc = '';
if (exists('app.js')) {
  appSrc = read('app.js');
  const r = spawnSync(process.execPath, ['--check', join(ROOT, 'app.js')], { encoding: 'utf8' });
  if (r.status === 0) ok(`node --check app.js سالم است (${appSrc.split('\n').length} خط)`);
  else fail('node --check app.js شکست خورد:\n' + (r.stderr || '').slice(0, 600));

  /* استخراج بلوک‌های template-literal */
  const extract = (name) => {
    const marker = `const ${name} = String.raw\``;
    const i = appSrc.indexOf(marker);
    if (i < 0) return null;
    const start = i + marker.length;
    const end = appSrc.indexOf('`', start); // طبق قانون طلایی، backtick دیگری داخلش نیست
    return end > start ? appSrc.slice(start, end) : null;
  };
  const pageJs = extract('PAGE_JS');
  const pageCss = extract('PAGE_CSS');

  if (!pageJs) fail('بلوک PAGE_JS پیدا نشد (یا backtick اضافی دارد)');
  else {
    /* استخراج در فایل موقت و node --check جداگانه (چون داخل template literal است) */
    const tmp = join(ROOT, '.tmp-pagejs-check.cjs');
    try {
      writeFileSync(tmp, pageJs);
      const r3 = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
      if (r3.status === 0) ok(`PAGE_JS استخراج و جداگانه چک شد (${pageJs.split('\n').length} خط)`);
      else fail('PAGE_JS سینتکس نامعتبر دارد:\n' + (r3.stderr || '').slice(0, 600));
    } catch (e) {
      fail('بررسی PAGE_JS ممکن نشد: ' + e.message);
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        /* noop */
      }
    }

    /* قانون طلایی: ممنوعیت backtick / ${ / </script در PAGE_JS و PAGE_CSS */
    for (const [name, src] of [
      ['PAGE_JS', pageJs],
      ['PAGE_CSS', pageCss || ''],
    ]) {
      const bt = src.indexOf('`');
      const interp = src.indexOf('${');
      const script = src.toLowerCase().indexOf('</script');
      const problems = [];
      if (bt >= 0) problems.push(`backtick در کاراکتر ${bt}`);
      if (interp >= 0) problems.push('`${` در کاراکتر ' + interp);
      if (script >= 0) problems.push('`</script` در کاراکتر ' + script);
      if (problems.length) fail(`${name}: ${problems.join(' · ')} — فایل را خراب می‌کند`);
      else ok(`${name}: بدون backtick / \${ / </script ✓`);
      const backslashTick = (src.match(/\\x60/g) || []).length;
      if (backslashTick) ok(`${name}: ${backslashTick} backtick با \\x60 ساخته شده (روش مجاز)`);
    }
  }

  /* BUILTIN_PROVIDERS باید دقیقاً برابر providers.json باشد */
  /* آبجکت با `\n};` در ستون صفر تمام می‌شود (داخلش همهٔ خطوط تورفته‌اند) */
  const bi = /const BUILTIN_PROVIDERS = (\{[\s\S]*?\n[ \t]*\};)\n/.exec(appSrc);
  if (bi) bi[1] = bi[1].slice(0, -1); // حذف `;` انتهایی برای JSON.parse
  if (!bi) fail('BUILTIN_PROVIDERS در app.js پیدا نشد');
  else if (!cfg) warn('مقایسهٔ BUILTIN_PROVIDERS ممکن نیست (providers.json خوانده نشد)');
  else {
    try {
      const embedded = JSON.parse(bi[1]);
      const ref = JSON.parse(JSON.stringify(cfg));
      delete ref.$schema;
      const a = JSON.stringify(embedded);
      const b = JSON.stringify(ref);
      if (a === b) ok('BUILTIN_PROVIDERS === providers.json (کپی داخلی همگام است)');
      else {
        fail('BUILTIN_PROVIDERS با providers.json فرق دارد — app.js را به‌روز کنید');
        const firstDiff = [...a].findIndex((ch, i) => ch !== b[i]);
        console.log(`     اولین تفاوت در کاراکتر ${firstDiff}: app.js=…${a.slice(Math.max(0, firstDiff - 40), firstDiff + 40)}…`);
        console.log(`                                              file  =…${b.slice(Math.max(0, firstDiff - 40), firstDiff + 40)}…`);
      }
    } catch (e) {
      fail('BUILTIN_PROVIDERS پارس نشد: ' + e.message);
    }
  }

  /* MODELS_FALLBACK (کلاینت) باید با مدل‌های پروایدر پیش‌فرض یکی باشد */
  const fb = /var MODELS_FALLBACK = (\[[\s\S]*?\n\]);/.exec(appSrc);
  if (!fb) fail('MODELS_FALLBACK در PAGE_JS پیدا نشد');
  else if (cfg) {
    try {
      /* پارس بدون eval — فقط فیلدهای ثابت هر ردیف */
      const list = [...fb[1].matchAll(/id:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'\s*,\s*vendor:\s*'([^']+)'\s*,\s*group:\s*'([^']+)'\s*,\s*logo:\s*'([^']+)'/g)].map(
        (m) => ({ id: m[1], name: m[2], vendor: m[3], group: m[4], logo: m[5] })
      );
      const dpId = cfg.defaults?.providerId || cfg.providers.find((p) => p.enabled !== false)?.id;
      const dp = cfg.providers.find((p) => p.id === dpId);
      const want = (dp?.models || []).map((m) => `${m.id}|${m.name}|${m.vendor}|${m.group}|${m.logo}`);
      const got = list.map((m) => `${m.id}|${m.name}|${m.vendor}|${m.group}|${m.logo}`);
      if (JSON.stringify(want) === JSON.stringify(got)) ok(`MODELS_FALLBACK === مدل‌های پروایدر پیش‌فرض (${got.length} مدل)`);
      else {
        warn('MODELS_FALLBACK با مدل‌های پروایدر پیش‌فرض فرق دارد (فقط در نبود تزریق سرور استفاده می‌شود)');
        console.log(`     فایل: ${want.join(' , ').slice(0, 200)}`);
        console.log(`     کد  : ${got.join(' , ').slice(0, 200)}`);
      }
    } catch (e) {
      warn('مقایسهٔ MODELS_FALLBACK ممکن نشد: ' + e.message);
    }
  }

  /* روتر app.js باید هر ۶ مسیر را داشته باشد */
  for (const route of ['/', '/api/chat', '/api/ping', '/v1/models', '/v1/chat/completions', '/v1/messages']) {
    const needle = route === '/' ? "path === '/'" : `path === '${route}'`;
    if (appSrc.includes(needle)) ok(`روتر app.js: ${route} ✓`);
    else fail(`روتر app.js: مسیر ${route} پیدا نشد`);
  }
} else fail('app.js وجود ندارد');

/* ───────────────────── 6/7) src/ — منبع واحد ───────────────────── */

/* برابری نام آیکن‌های گروه در دو نسخه (GROUP_ICONS ↔ MP_ICON_SVG) */
section('آیکن‌های گروه — برابری دو نسخه');
{
  const nextIcons = [...read('src/app/page.tsx').matchAll(/^\s{2}([a-z]+):\s+[A-Z][A-Za-z]+,/gm)].map((m) => m[1]);
  const appIcons = [...appSrc.matchAll(/^\s{2}([a-z]+):\s*(?:MP_GROUP_ICONS|'<svg)/gm)].map((m) => m[1]);
  const uniq = (a) => [...new Set(a)];
  const onlyNext = uniq(nextIcons).filter((x) => !appIcons.includes(x));
  const onlyApp = uniq(appIcons).filter((x) => !nextIcons.includes(x));
  if (!nextIcons.length || !appIcons.length) warn('استخراج نام آیکن‌ها ممکن نشد (ساختار عوض شده؟)');
  else if (onlyNext.length || onlyApp.length) {
    fail(`نام آیکن‌ها در دو نسخه یکی نیست — فقط در Next: ${onlyNext.join(', ') || '—'} · فقط در app.js: ${onlyApp.join(', ') || '—'}`);
  } else ok(`نام آیکن‌ها یکسان است (${uniq(nextIcons).join(', ')})`);
}

section('src/ — نبودِ لیست موازی مدل‌ها');
const sampleIds = cfg ? (cfg.providers[0]?.models || []).slice(0, 3).map((m) => m.id) : [];
const allowedFiles = ['src/lib/catalog.ts']; // فقط جای مجاز (آن هم از JSON می‌خواند)
function walkTs(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
if (exists('src') && sampleIds.length) {
  const offenders = [];
  for (const f of walkTs(join(ROOT, 'src'))) {
    const rel = relative(ROOT, f);
    if (allowedFiles.includes(rel)) continue;
    const src = readFileSync(f, 'utf8');
    const hits = sampleIds.filter((id) => src.includes(`'${id}'`) || src.includes(`"${id}"`));
    if (hits.length) offenders.push(`${rel} → ${hits.join(', ')}`);
  }
  if (offenders.length) {
    fail('id مدل‌ها مستقیم در کد src/ سخت‌کد شده (منبع باید providers.json باشد):\n     ' + offenders.join('\n     '));
  } else ok(`هیچ فایلی در src/ (جز ${allowedFiles.join(', ')}) id مدل‌ها را سخت‌کد نکرده`);
}
if (exists('src/app/page.tsx')) {
  const s = read('src/app/page.tsx');
  if (/@\/lib\/catalog/.test(s)) ok('page.tsx کاتالوگ را از @/lib/catalog می‌خواند');
  else fail('page.tsx باید کاتالوگ مدل‌ها را از @/lib/catalog بخواند (لیست دستی = دریفت)');
}
if (exists('src/lib/models.ts')) {
  const s = read('src/lib/models.ts');
  if (/from '\.\/catalog'/.test(s)) ok('models.ts فقط لایهٔ سازگاری با catalog.ts است');
  else warn('models.ts دیگر از catalog.ts نمی‌خواند — منبع واحد شکسته است');
}

/* ───────────────────── 8/9) سندها ───────────────────── */

/* ───────────── 4.5) سلامت ارجاع‌های داخل مستندات/مهارت‌ها ───────────── */

section('ارجاع‌های مستندات — مسیرها، اسکریپت‌های npm، پیوندها');
{
  const pkg = JSON.parse(read('package.json'));
  const scriptNames = Object.keys(pkg.scripts || {});
  const docFiles = ['README.md', 'HANDOFF.md', 'AI-GUIDE.md', 'skills/README.md'];
  const skillsDir = join(ROOT, 'skills');
  if (existsSync(skillsDir)) {
    for (const d of readdirSync(skillsDir)) {
      const f = `skills/${d}/SKILL.md`;
      if (existsSync(f)) docFiles.push(f);
    }
  }

  const PATH_RE = /`([A-Za-z0-9._\/-]+\.(?:ts|tsx|js|mjs|cjs|json|md|svg|webp|png|txt))`/g;
  const NPM_RE = /npm run ([a-z0-9:_-]+)/g;
  let badPaths = 0;
  let badScripts = 0;
  let badLinks = 0;
  const seenScripts = new Set();

  for (const doc of docFiles) {
    if (!exists(doc)) {
      if (doc !== 'skills/README.md') warn(`${doc} وجود ندارد`);
      continue;
    }
    const text = read(doc);
    const baseDir = dirname(join(ROOT, doc));

    /* مسیرهای فایل داخل backtick — فقط اگر «شبیه مسیر» باشند (دارای /) */
    for (const m of text.matchAll(PATH_RE)) {
      const t = m[1];
      if (!t.includes('/') || t.includes('*')) continue;
      if (/(foo|example|vendor-logo|your-|sample|placeholder)/i.test(t)) continue; // نمونهٔ آموزشی
      const okPath = t.startsWith('/')
        ? existsSync(join(ROOT, 'public', t)) || existsSync(join(ROOT, 'download', t)) // دارایی عمومی
        : existsSync(join(ROOT, t)) || existsSync(join(baseDir, t));
      if (!okPath) {
        fail(`${doc}: مسیر «${t}» وجود ندارد`);
        badPaths++;
      }
    }

    /* فرمان‌های npm run */
    for (const m of text.matchAll(NPM_RE)) {
      seenScripts.add(m[1]);
      if (!scriptNames.includes(m[1])) {
        fail(`${doc}: اسکریپت «npm run ${m[1]}» در package.json نیست`);
        badScripts++;
      }
    }

    /* پیوندهای نسیمیِ markdown */
    for (const m of text.matchAll(/\]\((?!https?:|#|mailto:)([^)]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target) continue;
      if (!existsSync(join(baseDir, decodeURIComponent(target)))) {
        fail(`${doc}: پیوند «${m[1]}» به فایل ناموجود اشاره می‌کند`);
        badLinks++;
      }
    }
  }

  if (!badPaths && !badScripts && !badLinks) {
    ok(`${docFiles.filter((d) => exists(d)).length} سند: همهٔ مسیرها/فرمان‌ها/پیوندها معتبرند`);
  }
  const unused = scriptNames.filter((n) => !seenScripts.has(n) && !['dev', 'build', 'start', 'lint'].includes(n));
  if (unused.length) warn(`اسکریپت‌هایی که در هیچ سندی معرفی نشده‌اند: ${unused.join(', ')}`);
}

section('سندها — همگامی و سلامت');
const DOCS = ['README.md', 'HANDOFF.md', 'AI-GUIDE.md'];
for (const d of DOCS) {
  if (!exists(d)) {
    warn(`${d} وجود ندارد`);
    continue;
  }
  const buf = readFileSync(join(ROOT, d));
  const txt = buf.toString('utf8');
  if (buf.includes(0)) fail(`${d}: بایت NUL دارد (احتمالاً الحاق UTF-16 — باید پاک شود)`);
  else ok(`${d}: بدون بایت NUL ✓`);
  if (!txt.endsWith('\n')) fail(`${d}: با خط جدید تمام نمی‌شود`);
  if (/\ufffd/.test(txt)) fail(`${d}: نویسهٔ جایگزین (U+FFFD) دارد — انکدینگ خراب`);
  const blocks = (txt.match(/<!-- GENERATED:([a-z0-9-]+) -->/g) || []).length;
  const closes = (txt.match(/<!-- \/GENERATED:([a-z0-9-]+) -->/g) || []).length;
  if (blocks !== closes) fail(`${d}: ${blocks} نشان آغاز و ${closes} نشان پایان GENERATED`);
  else if (blocks) ok(`${d}: ${blocks} بلوک تولیدی دارد`);
  /* کپی download */
  const dl = join('download', d);
  if (exists(dl)) {
    const same = readFileSync(join(ROOT, dl)).equals(buf);
    if (same) ok(`download/${d} با نسخهٔ ریشه همگام است`);
    else warn(`download/${d} با نسخهٔ ریشه فرق دارد → npm run docs:sync`);
  }
}

const r = spawnSync(process.execPath, [join(ROOT, 'scripts/docs-sync.mjs'), '--check', '--no-copy'], { encoding: 'utf8' });
if (r.status === 0) ok('بلوک‌های GENERATED در همهٔ سندها به‌روزند');
else fail('بلوک‌های GENERATED عقب‌تر از کد/پیکربندی‌اند → npm run docs:sync\n' + (r.stdout || '').slice(-500));

/* ───────────────────── اختیاری: --full ───────────────────── */

if (full) {
  section('بررسی کامل (typecheck + lint + smoke)');
  const tsc = spawnSync('npx', ['tsc', '--noEmit'], { encoding: 'utf8', cwd: ROOT });
  if (tsc.status === 0) ok('tsc --noEmit بدون خطا');
  else fail('tsc --noEmit:\n' + (tsc.stdout || tsc.stderr || '').slice(0, 800));

  const lint = spawnSync('npx', ['eslint', '.'], { encoding: 'utf8', cwd: ROOT });
  const lintOut = (lint.stdout || '') + (lint.stderr || '');
  if (lint.status === 0) ok(`eslint بدون خطا (${/(\d+) warning/.exec(lintOut)?.[1] || 0} هشدار)`);
  else fail('eslint خطا داد:\n' + lintOut.slice(-800));

  const smoke = spawnSync(process.execPath, [join(ROOT, 'scripts/smoke.mjs')], { encoding: 'utf8', cwd: ROOT });
  const summary = /(\d+)\/(\d+) آزمون پاس شد/.exec(smoke.stdout || '')?.[0] || '';
  if (smoke.status === 0) ok(`smoke test: ${summary}`);
  else fail(`smoke test: ${summary}\n` + (smoke.stdout || '').slice(-1200));
}

/* ───────────────────── جمع‌بندی ───────────────────── */

console.log('\n═══════════════════════ خلاصه ═══════════════════════');
console.log(`  خطا: ${errors} · هشدار: ${warnings}`);
console.log('═════════════════════════════════════════════════════\n');
process.exit(errors ? 1 : 0);
