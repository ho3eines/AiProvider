import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* پیش‌نمایش زنده پشت پروکسی (سندباکس/تونل): در حالت dev درخواست‌های
     cross-origin به assets مسدود نشوند. در پروداکشن بی‌اثر است. */
  allowedDevOrigins: ["*.e2b.app", "localhost", "127.0.0.1"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
