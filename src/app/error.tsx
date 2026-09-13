'use client';

/** مرز خطا — اگر کل صفحه دچار خطا شود، به‌جای کرش این صفحه نمایش داده می‌شود */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#0b1220] p-6 text-slate-200">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-[#243352] bg-[#111a2e] p-6 text-center">
        <div className="text-4xl">⚠️</div>
        <h1 className="text-lg font-extrabold">خطایی رخ داد</h1>
        <p dir="auto" className="break-words text-sm leading-7 text-slate-400">
          {error?.message || 'خطای ناشناخته'}
        </p>
        <button
          onClick={reset}
          className="rounded-xl bg-[#3b82f6] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#2563eb]"
        >
          تلاش دوباره
        </button>
      </div>
    </div>
  );
}
