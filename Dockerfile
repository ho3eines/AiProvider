# syntax=docker/dockerfile:1
# ═══════════════════════════════════════════════════════════════════════════
#  چت هوشمند (Smart Chat) — تصویر Docker نسخهٔ Next.js (پیش‌فرض Railway)
# ═══════════════════════════════════════════════════════════════════════════
#  Build :  docker build -t smart-chat .
#  Run   :  docker run --rm -p 3000:3000 \
#             -e OPENAI_API_KEY=sk-... -e ANTHROPIC_API_KEY=sk-ant-api03-... \
#             smart-chat
#  Health:  GET /healthz   (بدون تماس با آپستریم — برای health check Railway)
#
#  سه‌مرحله‌ای است: deps (نصب) → build (next build) → runner (فقط خروجی
#  standalone ~۳۶MB). node_modules کامل (~۹۵۰MB) وارد تصویر نهایی نمی‌شود.
# ═══════════════════════════════════════════════════════════════════════════

# ───────────────────────── 1) وابستگی‌ها ─────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false
# lockfile اول کپی می‌شود تا لایهٔ کشِ npm ci تا وقتی وابستگی‌ها عوض نشده‌اند اعتبار داشته باشد
COPY package.json package-lock.json ./
# schema برای postinstall پریزما (در صورت استفاده از DB) — اختیاری ولی بی‌خطر
COPY prisma ./prisma
RUN npm ci

# ───────────────────────── 2) بیلد ─────────────────────────
FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next build + کپی public و .next/static داخل .next/standalone
# (کلیدها عمداً در بیلد ساخته نمی‌شوند: api-keys.json در .dockerignore است)
RUN npm run build

# ───────────────────────── 3) اجرا ─────────────────────────
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# خروجی standalone خودش server.js + .next/static + public + node_modulesِ trace‌شده را دارد
COPY --from=build --chown=node:node /app/.next/standalone ./
# /data برای کلیدهای پایدار است (اختیاری): API_KEYS_FILE=/data/api-keys.json + یک volume
# در Railway به‌جای این، کلیدها را در Variables بگذارید (OPENAI_API_KEY/ANTHROPIC_API_KEY)
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3000
# بررسی سلامت با خودِ Node (بدون نصب curl/wget در تصویر)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
