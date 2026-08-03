"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[40vh] flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-lg font-semibold text-white">Something went wrong</h2>
      <p className="text-sm text-slate-400 max-w-md">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-cyan-600 px-4 py-2 text-sm text-white hover:bg-cyan-500 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
