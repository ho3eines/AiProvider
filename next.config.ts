import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* خروجی standalone برای Docker/Railway:
     همهٔ چیزی که برای اجرا لازم است در .next/standalone جمع می‌شود
     (server.js + node_modulesِ trace‌شده). بدون این، تصویر Docker ساخته نمی‌شود. */
  output: "standalone",

  /* تایپ‌ها سالم‌اند (npm run typecheck) — اجازه نده بیلد بی‌بررسی تایپ رد شود.
     اگر زمانی لازم شد بیلد را با خطای تایپ عبور دهید: ignoreBuildErrors: true */
  typescript: {
    ignoreBuildErrors: false,
  },

  /* صفحهٔ چت state سنگینی دارد و از localStorage بعد از mount می‌خواند؛
     strict mode در توسعه باعث double-invoke شدن effectها و ping تکراری می‌شد. */
  reactStrictMode: false,
};

export default nextConfig;
