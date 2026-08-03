"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0b0f19] text-slate-200 flex flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-xl font-semibold text-white">Alert Streamer</h1>
        <p className="text-sm text-slate-400 max-w-md text-center">{error.message}</p>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-cyan-600 px-4 py-2 text-sm text-white hover:bg-cyan-500"
        >
          Reload dashboard
        </button>
      </body>
    </html>
  );
}
