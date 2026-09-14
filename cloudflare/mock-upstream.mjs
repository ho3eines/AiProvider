/**
 * cloudflare/mock-upstream.mjs — ماکِ آپستریم freemodels (فقط برای توسعه/تست)
 *
 * چرا؟ چون `wrangler dev` باید جایی برای پروکسی‌کردن داشته باشد و همیشه نمی‌توان
 * به آپستریم واقعی رسید (مثلاً پشت فایروال یا وقتی سرویس 429 می‌دهد). این ماک همان
 * شکل پاسخ را تولید می‌کند: SSE با فیلدهای content / reasoning_content و [DONE].
 *
 * اجرا:
 *   npm run cf:mock                     → http://127.0.0.1:9912
 *   PORT=9999 node cloudflare/mock-upstream.mjs
 *
 * وصل‌کردن Worker به ماک:
 *   npm run cf:dev  (با cloudflare/.dev.vars → UPSTREAM_URL=http://127.0.0.1:9912/)
 *   یا: npx wrangler dev --config cloudflare/wrangler.jsonc --var UPSTREAM_URL:http://127.0.0.1:9912/
 *
 * رفتارهای ویژه برای تست مسیرهای خطا (در متن آخرین پیام user):
 *   @error   → پاسخ 500 با بدنهٔ JSON خطا
 *   @empty   → استریم خالی (بدون هیچ محتوا)
 *   @slow    → هر تکه با ۴۰۰ms تأخیر (تست زنده‌بودن استریم)
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 9912);
const HOST = process.env.HOST || '127.0.0.1';

function log(msg) {
  console.log('[mock-upstream] ' + msg);
}

function lastUserText(payload) {
  const msgs = Array.isArray(payload && payload.messages) ? payload.messages : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.role === 'user' && typeof m.content === 'string') return m.content;
  }
  return '';
}

const server = createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'only POST' } }));
    return;
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    let payload = {};
    try {
      payload = JSON.parse(raw || '{}');
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'bad json' } }));
      return;
    }

    const text = lastUserText(payload);
    const wantStream = !!payload.stream;
    const model = String(payload.modelId || 'mock-model');
    log(
      `${req.method} ${req.url} model=${model} stream=${wantStream} origin=${req.headers['origin'] || '-'} ua=${String(
        req.headers['user-agent'] || '-'
      ).slice(0, 30)}`
    );

    if (/@error/.test(text)) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'mock upstream failure (@error)' } }));
      return;
    }

    const answer = `پاسخ ماک برای مدل ${model}: سلام! این یک پاسخ آزمایشی است.`;
    const tokens = answer.split(/(\s+)/).filter(Boolean);
    const delayMs = /@slow/.test(text) ? 400 : 25;

    if (!wantStream) {
      const body = JSON.stringify({
        content: /@empty/.test(text) ? '' : answer,
        modelId: model,
        stopReason: 'end_turn',
        echo: {
          origin: req.headers['origin'] || null,
          referer: req.headers['referer'] || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    /* ── استریم SSE ── */
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    });
    /* نکته: `req.on('close')` در Node به‌محض «تمام‌شدن بدنهٔ درخواست» هم شلیک می‌شود،
       پس برای تشخیص قطعِ کلاینت باید `res.on('close')` را با writableFinished چک کرد. */
    let cancelled = false;
    res.on('close', () => {
      if (!res.writableFinished) {
        cancelled = true;
        log('⏹ کلاینت قطع شد (استریم متوقف)');
      }
    });

    const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    (async () => {
      if (payload.thinking) {
        send({ reasoning_content: 'در حال بررسی درخواست… ' });
        await wait(delayMs);
        if (cancelled) return res.end();
        send({ reasoning_content: 'حالا پاسخ را می‌نویسم. ' });
        await wait(delayMs);
      }
      if (!/@empty/.test(text)) {
        for (const t of tokens) {
          if (cancelled) return res.end();
          send({ content: t });
          await wait(delayMs);
        }
      }
      if (cancelled) return res.end();
      res.write('data: [DONE]\n\n');
      res.end();
    })();
  });
});

server.listen(PORT, HOST, () => {
  console.log('');
  log(`ماک آپستریم آماده است → http://${HOST}:${PORT}/`);
  log('UPSTREAM_URL=http://' + HOST + ':' + PORT + '/  را به Worker بدهید.');
  log('کلیدواژه‌های تست: @error (خطای ۵۰۰) · @empty (پاسخ خالی) · @slow (تأخیر هر تکه)');
  console.log('');
});
