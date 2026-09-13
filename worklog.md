# Worklog — پروژه چت هوشمند (Next.js + نسخه تک‌فایل Node)

---
Task ID: 1
Agent: main (Z.ai Code)
Task: ساخت بک‌اند پروکسی چت (/api/chat) و تست اتصال (/api/ping) + کتابخانه‌های مشترک

Work Log:
- بررسی ساختار پروژه (Next.js 16 + Tailwind 4 + shadcn موجود)
- تست دسترسی آپستریم از سندباکس: در دسترس است (در لحظه سهمیه موقتاً تمام شده و JSON خطا برمی‌گرداند)
- ساخت `src/lib/upstream.ts`: ثابت‌های آپستریم، هدرهای جعلی مرورگر (Origin/Referer/UA/sec-ch-*/sec-fetch-*)، `openUpstream` با node:https، تایم‌اوت ۱۸۰ ثانیه، لاگ رنگی ANSI، هدرهای CORS باز
- ساخت `src/app/api/chat/route.ts`: POST پروکسی با محدودیت 5MB (413)، pipe مستقیم استریم بدون بافر، حذف access-control-*/transfer-encoding/content-encoding، abort کلاینت → destroy آپستریم، خطا → 502/504 JSON، OPTIONS → 204 CORS
- ساخت `src/app/api/ping/route.ts`: درخواست سبک stream:false با پیام ping، خروجی {status, ms, sample}
- ساخت `src/lib/sse.ts`: پارسر جهانی SSE (سبک OpenAI delta، فیلد مستقیم content/text، آبجکت بدون data:، رشته خام، [DONE]، فیلدهای reasoning_content/reasoning/thinking/delta.thinking، خطای داخل استریم) — خط‌به‌خط با تجميع JSON چندخطی ناقص
- ساخت `src/lib/markdown.ts`: رندر مارک‌داون امن بدون کتابخانه — escape کامل قبل از درج، استخراج بلوک کد با placeholder، هایلایت سینتکس ساده (کلیدواژه/رشته/عدد/کامنت)، هدر بلوک کد + دکمه کپی، کد اینلاین/بولد/ایتالیک/خط‌خورده/لینک(target=_blank)/هدینگ/لیست/نقل‌قول/خط افقی، کرسر چشمک‌زن استریم

Stage Summary:
- بک‌اند کامل و تست‌شده با curl: OPTIONS 204، ping 200 (ms=2635)، chat پاسخ آپستریم را با هدرهای تمیز عبور می‌دهد
- آپستریم در لحظه تست خطای موقت سهمیه (429 + error JSON) می‌داد — فرانت باید این را به حباب قرمز تبدیل کند
- تصمیم: به جای fetch از node:https استفاده شد تا هدرهای Origin/Referer (که در fetch ممنوع هستند) واقعاً ارسال شوند

---
Task ID: 2
Agent: main (Z.ai Code)
Task: فرانت‌اند کامل چت (RTL فارسی، تم تاریک) در src/app/page.tsx

Work Log:
- `layout.tsx`: lang=fa، dir=rtl، فونت Vazirmatn از Google Fonts (لینک مستقیم — مقاوم به قطعی شبکه)، متادیتای فارسی، viewport themeColor
- `globals.css`: استایل‌های اختصاصی — اسکرول‌بار سفارشی، کرسر چشمک‌زن @keyframes fm-blink، توکن‌های هایلایت کد، استایل‌های md-p/md-h/md-list/md-quote/md-code/md-icode، باکس تفکر
- `page.tsx` (~870 خط، client component): 
  - سایدبار راست 260px (چت جدید، لیست گفتگوها با حذف، خروجی Markdown/JSON، پاک کردن همه) + drawer موبایل
  - هدر: input مدل + datalist پنج مدل، چک‌باکس‌های تفکر/جستجوی عمیق/استریم، دکمه اتصال؟، Raw SSE، ⚙️، نشانگر وضعیت سبز/زرد/قرمز
  - ناحیه چت با کامپوننت memo شده پیام + اکشن‌های hover (کپی/ویرایش/حذف/بازتولید) + آمار (زمان/تکه/نویسه)
  - کامپوزر: textarea خودبزرگ‌شونده، Enter ارسال، Shift+Enter خط جدید، دکمه ارسال ↔ توقف حین استریم
  - flush استریم با requestAnimationFrame، کرسر چشمک‌زن، تفکر جمع‌شونده (details/summary)
  - localStorage: fm_chats و fm_settings، بارگذاری بعد از mount (بدون hydration mismatch)
  - Welcome screen با ۴ پیشنهاد، مودال System Prompt، پنل Raw SSE (80KB)، توست‌ها، Esc برای توقف/بستن
- `error.tsx`: مرز خطای فارسی برای جلوگیری از کرش کل صفحه
- رفع باگ: فراموشی import آیکون Brain → 500 صفحه؛ رفع شد و GET / → 200

Stage Summary:
- فرانت‌اند کامل و کامپایل‌شده؛ صفحه اصلی 200 می‌دهد
- قرارداد فرانت↔بک: POST /api/chat با {messages, modelId, thinking, deepSearch, stream} و پاسخ SSE/JSON عبوری؛ GET /api/ping
- نکته: خطای HTTP آپستریم به‌صورت «❌ HTTP 429 — متن» در حباب قرمز نمایش داده می‌شود

---
Task ID: 3
Agent: main (Z.ai Code)
Task: تأیید end-to-end با مرورگر (Agent Browser)

Work Log:
- باز کردن / در مرورگر headless: رندر کامل (welcome، سایدبار راست، هدر، کامپوزر) — بدون خطای کنسول
- ارسال پیام با کلیک روی پیشنهاد: حباب کاربر + کرسر چشمک‌زن + دکمه توقف قرمز + «⏳ در حال دریافت پاسخ…»
- استریم زنده موفق: پاسخ کامل با 286 تکه / 19 ثانیه / 1593 نویسه؛ باکس «💭 فرایند تفکر مدل» باز شد (delta.reasoning_content) و بعد از شروع پاسخ بسته شد
- مسیر خطا: آپستریم متناوب 429 (سهمیه) می‌داد → حباب قرمز «❌ HTTP 429 — {...تا 300 کاراکتر}» + آمار دقیق
- بازتولید ↻: پیام خطا حذف و درخواست دوباره شد ✓
- توقف: Esc وسط استریم → نشان «⏹ متوقف شد» + ذخیره نیمه‌کاره؛ لاگ سرور: «کلاینت قطع شد — آپستریم destroy می‌شود» ✓
- بلوک کد پایتون: هدر `python` + دکمه کپی (بازخورد «کپی شد ✓») + هایلایت (def/for/return آبی، اعداد زرد) + dir=ltr
- ویرایش اینلاین پیام کاربر (textarea پیش‌پر + ذخیره/انصراف) ✓
- رفرش صفحه: تاریخچه، عنوان چت، تنظیمات و System Prompt سر جایشان (fm_chats / fm_settings) ✓
- خروجی Markdown و JSON با توست تأیید دانلود ✓
- چت جدید / سوئیچ بین گفتگوها / welcome screen ✓
- موبایل 390px: هدر جمع‌شونده، همبرگر، اکشن‌های همیشه‌مریی، کامپوزر چسبان با safe-area ✓
- پنل Raw SSE: دیتای خام نمایش داده می‌شود؛ فرمت واقعی آپستریم = سبک OpenAI (delta.reasoning_content / delta.content) ✓

Stage Summary:
- همه معیارهای پذیرش نسخه Next.js تأیید شد؛ آپستریم فقط گاهی 429 سهمیه می‌دهد (رفتار سرویس رایگان، نه باگ ما)
- آماده شدن برای Task 4: پورت تک‌فایل app.js (منابع مرجع: src/lib/markdown.ts، src/lib/sse.ts، src/app/page.tsx)

---
Task ID: 4
Agent: full-stack-developer
Task: ساخت نسخه تک‌فایل مستقل app.js (Node خالص)

Work Log:
- خواندن worklog و پورت دقیق منطق از منابع مرجع: src/lib/markdown.ts (رندر امن + هایلایت + appendCursor + codeStore)، src/lib/sse.ts (پارسر جهانی SSE)، src/lib/upstream.ts + api/chat/route.ts + api/ping/route.ts (پروکسی)
- ساخت `/home/z/my-project/app.js` (۱ فایل، CommonJS، فقط ماژول‌های داخلی http/https، بدون هیچ نصب پکیج) — ۲۰۵۸ خط / ۸۴٬۳۸۰ بایت
- سرور: bind روی 127.0.0.1، پورت از env PORT (پیش‌فرض 3000)، بنر رنگی ANSI (نام اپ/آدرس/پورت/آپستریم)، لاگ رنگی هر درخواست (زمان، متد/مسیر، کد آپستریم، مدت)
- روت‌ها: GET / (HTML چت) · POST /api/chat (پروکسی استریم) · GET /api/ping ({status,ms,sample}) · هر OPTIONS → 204 + CORS باز · بقیه → 404
- پروکسی: خواندن کامل بدنه با سقف 5MB (بیشتر → 413)، هدرهای جعلی مرورگر + Content-Length واقعی، pipe مستقیم تکه‌به‌تکه (بدون تجمیع بافر + backpressure با pause/resume)، حذف access-control-*/transfer-encoding/content-encoding/content-length، افزودن Cache-Control: no-cache, no-transform و X-Accel-Buffering: no، تایم‌اوت 180s → 504 / خطای اتصال → 502، قطع کلاینت → destroy آپستریم
- فرانت: همان HTML داخل فایل — CSS در PAGE_CSS و JS کلاینت در PAGE_JS هر دو با String.raw، درج با ${...} در PAGE_HTML؛ در PAGE_JS مطلقاً بدون backtick و ${ (backtick های مارک‌داون با \x60 در regex/رشته ساخته شدند — ۶ backtick در کل فایل = فقط ۳ جفت delimiter)
- پورت کامل قابلیت‌ها: RTL فارسی + Vazirmatn، تم تاریک #0b1220، سایدبار راست 260px (چت جدید/لیست/حذف ✕ hover/خروجی MD و JSON/پاک کردن همه با confirm)، هدر (datalist ۵ مدل، تفکر/جستجوی عمیق/استریم، اتصال؟ + ping خودکار، Raw SSE، ⚙️ System Prompt، نشانگر سبز/زرد/قرمز)، Enter/Shift+Enter، استریم زنده با کرسر چشمک‌زن و flush با requestAnimationFrame، دکمه ⏹ توقف + Esc (AbortController)، نشان «⏹ متوقف شد»، بازتولید ↻ آخرین پاسخ، اکشن‌های hover (کپی/ویرایش اینلاین کاربر با حذف پیام‌های بعدی/حذف)، باکس «💭 فرایند تفکر مدل»، آمار ⏱/🧩/✍️، حافظه کامل با حذف پیام‌های خطا از payload، localStorage با fm_chats/fm_settings، عنوان = ۴۰ کاراکتر اول، welcome با ۴ پیشنهاد، پنل Raw SSE پایین-چپ (80KB، ltr، mono)، توست‌ها، موبایل (drawer سایدبار + safe-area کامپوزر)
- نکته بحرانی رعایت شد: node --check و همچنین استخراج و node --check جداگانهٔ PAGE_JS هر دو OK؛ بررسی شد هیچ ${ و </script داخل PAGE_JS/PAGE_CSS نیست (فقط ۳ توضیح ${PAGE_CSS}/${PAGE_JS} در HTML)

Stage Summary:
- مسیر فایل: /home/z/my-project/app.js — حجم: 84,380 بایت (2,058 خط) — `node --check app.js` ✓
- نتایج تست‌ها (سرور روی PORT=3107، پورت 3000 دست‌نخورده):
  1) GET / → 200 (67,559 بایت) شامل «چت هوشمند» و Vazirmatn و dir=rtl و datalist ۵ مدل ✓
  2) OPTIONS /api/chat → 204 با Access-Control-Allow-Origin: * و Allow-Methods/Headers ✓
  3) GET /api/ping → JSON معتبر {"status":"ok","ms":2595,"sample":"..."} (آپستریم در لحظهٔ تست سهمیهٔ تمام‌شده برمی‌گرداند — endpoint سالم است و sample پیام آپستریم را نشان می‌دهد) ✓
  4) POST /api/chat با stream:true → پاسخ آپستریم (در لحظه 429 سهمیه) عبور کرد با هدرهای تمیز (content-type آپستریم + Cache-Control: no-cache, no-transform + X-Accel-Buffering: no)؛ مسیر pipe برای 200/429/400 یکسان است و تست stream:false هم عبور موفق داشت ✓
  5) GET /xyz → 404 ✓
  6) کنسول: بنر رنگی + لاگ‌های رنگی همه درخواست‌ها (زمان/مسیر/کد/مدت) ✓
- تست تکمیلی: بدنهٔ >5MB → 413 ✓
- پروسه با kill (و در صورت نیاز kill -9) بسته شد؛ pgrep خالی و پورت 3107 آزاد تأیید شد ✓

---
Task ID: 5
Agent: main (Z.ai Code)
Task: تأیید مستقل خروجی ساب‌ایجنت (app.js) + جمع‌بندی نهایی

Work Log:
- `node --check app.js` → معتبر؛ حجم 84380 بایت (2058 خط)
- اجرای مستقل روی PORT=3108: بنر رنگی چاپ شد، GET / → 200 (شامل «چت هوشمند»)، OPTIONS → 204، مسیر ناشناس → 404، /api/ping → JSON معتبر {status:'ok', ms:2419, sample}
- POST /api/chat از app.js: پاسخ آپستریم عیناً عبور کرد (در لحظه، آپستریم خطای موقت سهمیه می‌داد — pipe سالم)
- پروسه با kill بسته شد و پورت آزاد شد؛ سرور Next.js روی 3000 دست‌نخورده ماند
- eslint.config.mjs: افزودن "app.js" به ignores (فایل مستقل CommonJS جزو بیلد Next نیست) → lint بدون خطا
- پاک‌سازی اسکرین‌شات‌های موقت تست

Stage Summary:
- هر دو نسخه تحویل داده شد و تست شد:
  1) نسخه Next.js (پیش‌نمایش زنده پروژه): src/app/page.tsx + src/app/api/chat/route.ts + src/app/api/ping/route.ts + src/lib/{upstream,sse,markdown}.ts
  2) نسخه تک‌فایل مستقل: /home/z/my-project/app.js — با `node app.js` (پورت 3000) یا `PORT=xxxx node app.js` اجرا می‌شود، بدون هیچ پکیجی
- معیارهای پذیرش: هر ۷ مورد تأیید (اجرای بدون نصب، رندر کامل، استریم زنده 286 تکه، توقف واقعی با destroy آپستریم، ماندگاری پس از رفرش، خروجی MD/JSON، کد تمیز با کامنت فارسی)
- محدودیت خارجی شناخته‌شده: آپستریم رایگان گاه‌به‌گاه 429 «providers exhausted» می‌دهد؛ هر دو نسخه آن را به حباب خطای قرمز شفاف تبدیل می‌کنند و پس از چند ثانیه retry موفق بوده است

---
Task ID: 6
Agent: main (Z.ai Code)
Task: افزودن ۷ مدل جدید سایت freemodels + اندپوینت‌های سازگار OpenAI و Anthropic با کلید API (در هر دو نسخه app.js و Next.js)

Work Log:
- لیست مدل‌ها طبق اسکرین‌شات کاربر به‌روزرسانی شد (۵ مدل قدیمی → ۷ مدل جدید): claude-sonnet-5 · claude-fable-5 · claude-fable-5.1 (پیش‌فرض) · gpt-5.6-sol · gpt-5.6-terra · glm-5.2 · kimi-k3 — در app.js (datalist با برچسب نام—سازنده + ثابت FM_MODELS سمت سرور + کلاینت) و page.tsx (MODELS آبجکتی + label در option)
- کلیدهای API طبق قوانین OpenAI/Anthropic: تابع loadOrCreateKeys — اولین اجرا می‌سازد و در api-keys.json (کنار app.js / ریشه پروژه، permission 600) ذخیره می‌کند؛ کلید سبک OpenAI = «sk-» + ۴۸ کاراکتر، کلید سبک Anthropic = «sk-ant-api03-» + ۸۸ کاراکتر؛ override با env (OPENAI_API_KEY / ANTHROPIC_API_KEY)؛ هر دو کلید روی هر دو اندپوینت پذیرفته می‌شوند؛ نسخه Next.js همان فایل را می‌خواند (src/lib/apikeys.ts با کش در حافظه) → کلیدها بین هر دو نسخه یکسان‌اند
- app.js — سه اندپوینت جدید: GET /v1/models (فرمت لیست OpenAI) · POST /v1/chat/completions (Authorization: Bearer — استریم SSE با reasoning_content + چانک نقش + finish_reason + stream_options.include_usage + data:[DONE]، و غیراستریم با usage تخمینی) · POST /v1/messages (x-api-key + anthropic-version — اعتبارسنجی اجباری model/max_tokens مثل خود Anthropic با خطای «max_tokens: Field required»، system به‌صورت رشته/بلوک، استریم با چرخهٔ کامل message_start→ping→content_block_start/delta/stop→message_delta→message_stop و بلوک thinking با thinking_delta، غیراستریم با بلوک‌های text/thinking)
- app.js — زیرساخت: پارسر SSE سمت سرور (makeUpstreamParser هم‌منطق با کلاینت) + collectUpstreamText برای پاسخ کامل + flattenContent برای محتوای بلوکی + getBearerToken + openaiError/anthropicError (خطا در همان فرمت API مقصد) + قطع کلاینت → destroy آپستریم در استریم‌ها + نرمال‌سازی نرم نام مدل در /api/chat هم (resolveModelId: «Claude Fable 5.1» و «claude_fable 5.1» هم قبول است) + بنر اجرا با کلیدها و اندپوینت‌ها
- app.js — UI: مودال ⚙️ تنظیمات بخش جدید «🔑 اندپوینت‌های API و کلیدها» (نمایش هر دو کلید + دکمه کپی + لیست اندپوینت‌ها + نمونه curl واقعی با کلید)؛ کلیدها از سرور با window.__FM__ تزریق می‌شوند؛ CSS با کلاس‌های api-sec/key-row/api-eps/api-curl (رفع باگ: div#api-eps کلاس نداشت و خط‌به‌خط رندر نمی‌شد)
- Next.js — فایل‌های جدید: src/lib/models.ts (FM_MODELS + resolveModelId) · src/lib/apikeys.ts (getApiKeys/keyIsValid/bearerFrom) · src/lib/v1.ts (CORS/SSE headers + flattenContent + readAll + estTokens) · src/app/v1/models/route.ts · src/app/v1/chat/completions/route.ts (ReadableStream استریم + abort با req.signal → destroy آپستریم) · src/app/v1/messages/route.ts · src/app/api/keys/route.ts (کلیدها برای مودال) — page.tsx: بخش API در مودال با fetch /api/keys + دکمه کپی + توست
- تست curl (پورت 3109 برای app.js و 3000 برای Next): /v1/models → 200/401 صحیح · OpenAI استریم → چانک‌های واقعی شامل reasoning_content و [DONE] · OpenAI غیراستریم → پاسخ واقعی «سلام» از glm-5.2/kimi-k3 با usage · Anthropic استریم → چرخهٔ کامل رویدادها (خطای موقت آپستریم داخل text_delta منتشر شد) · Anthropic بدون max_tokens → 400 طبق قوانین · خطای 429 آپستریم در فرمت استاندارد هر API برگشت · /api/ping سالم
- تأیید مرورگری (agent-browser): رندر هر دو UI بدون خطای کنسول · datalist ۷ مدل · مودال API در هر دو نسخه با کلیدهای درست · ارسال پیام زنده در هر دو (Next: پاسخ کامل پایتون با هایلایت + آمار 121 تکه؛ app.js: «سلام» با 💭 تفکر و آمار 44 تکه) · lint: 0 خطا

Stage Summary:
- هر دو نسخه حالا علاوه بر چت، یک API کامل سازگار با OpenAI و Anthropic هم سرویس می‌دهند؛ کلیدها: sk-ItqvFVBt8slw2vqxPuW9oLiSyGGgC29lNYeET64dIzJ04e50 (OpenAI) و sk-ant-api03-9lamB2K7KoYT8fw8tAp2CKL5kKsOHKhN4mE9eawuzRuW0aU3umJirsEFbS3B6RCjLRw8lrJ0YRmsnxECIu3nHaKM (Anthropic) — در api-keys.json مشترک هر دو نسخه
- app.js: 2901 خط / 120,243 بایت — node --check سالم (فایل اصلی + PAGE_JS استخراج‌شده)
- محدودیت شناخته‌شده: آپستریم رایگان گاهی 429 «providers exhausted» می‌دهد؛ در استریم داخل خود پاسخ و در غیراستریم با کد وضعیت درست به فرمت API مقصد برگردانده می‌شود و چند ثانیه بعد retry موفق است

---
Task ID: 7
Agent: main (Z.ai Code)
Task: بازیابی ورک‌اسپیس از فایل tar آپلودی + پیاده‌سازی پیکر مدل گروهی (مطابق HTML واقعی سایت freemodels) در هر دو نسخه

Work Log:
- استخراج workspace-228826a1-fa07-438e-befa-cdfb489723b4.tar و انتقال کامل پروژه به ریشه سندباکس (/home/z/my-project)؛ نصب وابستگی‌ها با bun و بالاآمدن dev سرور روی 3000 (GET / → 200)
- دانلود ۴ لوگوی واقعی ارائه‌دهنده از freemodels.pro (Claude-ai-logo.webp، ChatGPT-Logo.svg.webp، zai.png، kimi-logo-png_seeklogo-611650.png) و قراردادن‌ها در public/
- Next.js (src/app/page.tsx): حذف input+datalist مدل؛ افزودن دکمهٔ پیکر (لوگو + نام مدل + chevron) و پاپ‌آپ role=listbox با dir=ltr و عرض ۲۶۴px و max-h min(55dvh,320px) با اسکرول — دقیقاً با رنگ‌ها/فاصله‌های HTML مرجع: هدر گروه text-[11px] uppercase با آیکن (Sparkles/Zap/Globe)، ردیف‌ها با لوگوی ۲۰px گردگوشه، نام text-xs و سازندهٔ text-[11px] با شفافیت ۶۰٪، ردیف انتخاب‌شده bg-[#0A0A0B] سفید + تیک Check، hover #FFFBF5 و active #F5F3EF، min-h-44px موبایل
- STATE و رفتار: modelPickerOpen + pickerRef؛ بستن با کلیک بیرون (mousedown روی document) و Esc (اولویت قبل از مودال تنظیمات)؛ انتخاب مدل → setSettings + بستن پاپ‌آپ + ذخیره در fm_settings؛ اگر modelId دستی نامعلومی در localStorage باشد، دکمه همان id خام را بدون لوگو نشان می‌دهد
- app.js (نسخهٔ تک‌فایل): همان UI با کلاس‌های mp-* در PAGE_CSS و رندر JS خالص (buildPicker/updateModelBtn/setPickerOpen) از روی MODELS سمت کلاینت (هم‌گروه با FM_MODELS سرور)؛ SVG آیکن‌های گروه‌ها همان pathهای lucide سایت مرجع؛ رعایت کامل قیود PAGE_JS (بدون backtick و ${ و </script — تأیید با استخراج و node --check جداگانه)
- لوگوها در app.js به‌صورت base64 (نسخهٔ ۹۶px بهینه‌شده با PIL، ~۱۲KB مجموع) داخل EMBEDDED_LOGOS embed شدند و سرور همان مسیرهای مرجع (/Claude-ai-logo.webp و…) را با Cache-Control یک‌هفته‌ای سرو می‌کند — تک‌فایل مستقل ماند؛ /v1/models بدون تغییر (فقط فیلدهای مشخص — نشت base64 ندارد)
- باگ stacking رفع شد: در flexbox حتی flex-item استاتیک با z-index هم stacking-context می‌سازد؛ #topbar (z-30) پاپ‌آپ را محبوس می‌کرد و #sidebar (z-50، آیتم flex بعدی) رویش می‌آمد → topbar به z-55 ارتقا یافت (زیر مودال ۶۰ و توست ۷۰)؛ لنگر پاپ‌آپ در هر دو نسخه به right-0 فیزیکی تغییر کرد تا در RTL به سمت چپ (روی چت) باز شود نه زیر سایدبار
- تست مرورگری Next.js: باز شدن پاپ‌آپ با هر ۳ گروه و ۷ مدل و ۴ لوگو، اسکرول داخلی، انتخاب kimi-k3 (دکمه به‌روز + fm_settings ذخیره + ماندگاری پس از reload)، Esc و کلیک بیرون، ارسال پیام زنده با kimi-k3 (پاسخ کامل پایتون با هایلایت، ۱۷۶ تکه؛ یک بار خطای موقت «Service temporarily overloaded» آپستریم درست به حباب قرمز آمد)، موبایل ۳۹۰px با تاچ‌تارگت ۴۴px
- تست مرورگری app.js: همان سناریوها همه پاس؛ انتخاب مدل + توست «مدل روی Kimi K3 تنظیم شد ✓» + ماندگاری + جای تیک بعد از reopen؛ GET / (82KB)، هر ۴ مسیر لوگو ۲۰۰ با content-type درست، OPTIONS 204، /api/ping ok، /v1/models تمیز؛ موبایل ۳۹۰px ✓
- bun run lint: 0 خطا (فقط هشدار قدیمی فونت که عمداً به‌صورت لینک مستقیم مانده)؛ حذف پوشهٔ موقت workspace-restore بعد از انتقال

Stage Summary:
- هر دو نسخه حالا پیکر مدل گروهی دقیقاً مثل سایت freemodels دارند: Claude Pro (Sonnet 5، Fable 5، Fable 5.1) / ChatGPT Pro (Sol، Terra) / Other Pro Models (GLM 5.2، Kimi K3) با لوگو، سازنده، ردیف انتخاب‌شدهٔ تیره با تیک و اسکرول داخلی
- فایل‌های تغییریافته: src/app/page.tsx، app.js، public/{4 لوگو}، scripts/embed_logos.py (ابزار embed)؛ api-keys.json و بقیهٔ منطق دست‌نخورده
- known-issue ثابت: آپستریم رایگان گاهی «Service temporarily overloaded/429» می‌دهد — رفتار سرویس، نه باگ UI
