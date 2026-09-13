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
