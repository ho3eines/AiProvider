#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  dev-mock.mjs — محیط توسعهٔ آفلاین (آپستریم ساختگی + سرور اپ)
 * ═══════════════════════════════════════════════════════════════════════════
 *  وقتی آپستریم واقعی در دسترس نیست (سندباکس بدون اینترنت، 429 موقت، یا می‌خواهید
 *  پروایدر جدید را قبل از اتصال واقعی آزمودن کنید) این اسکریپت:
 *
 *    1. `scripts/mock-upstream.mjs` را روی پورت MOCK_PORT (پیش‌فرض 4100) بالا می‌آورد
 *    2. یک پیکربندی پروایدر آزمایشی در `.tmp/providers.mock.json` می‌سازد
 *       (پروایدرهای واقعی + شش پروایدر ساختگی برای هر قابلیت رجیستری)
 *    3. سرور اپ را با همان پیکربندی اجرا می‌کند:
 *         npm run dev:mock              → نسخهٔ Next.js روی پورت 3000
 *         npm run dev:mock -- --appjs   → نسخهٔ تک‌فایل app.js روی پورت 3000
 *
 *  گزینه‌ها:  --port 3000   --mock-port 4100   --appjs   --host 0.0.0.0
 *
 *  بعد از بالا آمدن، تست کامل را با این فرمان اجرا کنید:
 *      npm run smoke -- --base http://127.0.0.1:3000
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTestConfig } from './lib/test-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const useAppJs = argv.includes('--appjs');
const PORT = opt('port', '3000');
const MOCK_PORT = opt('mock-port', '4100');
const HOST = opt('host', '0.0.0.0');
const mockUrl = `http://127.0.0.1:${MOCK_PORT}/chat`;

mkdirSync(join(ROOT, '.tmp'), { recursive: true });
const cfgPath = join(ROOT, '.tmp/providers.mock.json');
writeFileSync(cfgPath, JSON.stringify(buildTestConfig(mockUrl), null, 2));

const kids = [];
function start(cmd, args, env, label, color) {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env } });
  p.stdout?.on('data', (d) => process.stdout.write(color + `[${label}] ` + d.toString().replace(/\n/g, `\n${color}[${label}] `).replace(/\x1b\[0m/g, '\x1b[0m' + color) + '\x1b[0m'));
  p.stderr?.on('data', (d) => process.stderr.write(color + `[${label}] ` + d.toString() + '\x1b[0m'));
  p.on('exit', (code) => {
    console.log(`\n[${label}] خروج با کد ${code}`);
    shutdown(code || 0);
  });
  kids.push(p);
  return p;
}

let done = false;
function shutdown(code = 0) {
  if (done) return;
  done = true;
  for (const k of kids) {
    try {
      k.kill('SIGTERM');
    } catch {
      /* noop */
    }
  }
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('');
console.log('🧪 محیط توسعهٔ آفلاین (mock) — AiProvider');
console.log(`   پیکربندی پروایدرها : ${cfgPath}`);
console.log(`   آپستریم ساختگی     : ${mockUrl}`);
console.log(`   سرور اپ            : http://127.0.0.1:${PORT} (${useAppJs ? 'app.js' : 'Next.js dev'})`);
console.log(`   تست کامل           : npm run smoke -- --base http://127.0.0.1:${PORT}`);
console.log('');

start(process.execPath, [join(ROOT, 'scripts/mock-upstream.mjs')], { MOCK_PORT, MOCK_HOST: '127.0.0.1' }, 'mock', '\x1b[35m');

if (useAppJs) {
  start(process.execPath, [join(ROOT, 'app.js')], { PORT, HOST, FM_PROVIDERS_FILE: cfgPath }, 'app.js', '\x1b[36m');
} else {
  start('npx', ['next', 'dev', '-H', HOST, '-p', PORT], { FM_PROVIDERS_FILE: cfgPath, MOCK_PORT }, 'next', '\x1b[32m');
}
