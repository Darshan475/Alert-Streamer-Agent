"use client";

import { Loader2 } from "lucide-react";

interface Props {
  show?: boolean;
  label?: string;
}

export function LoadingOverlay({ show = false, label = "Loading…" }: Props) {
  if (!show) return null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0b0f19]/60 backdrop-blur-[2px] animate-fade-in pointer-events-none">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-900/80 px-6 py-4 shadow-xl">
        <Loader2 className="h-6 w-6 text-cyan-400 animate-spin" />
        <span className="text-sm text-slate-400">{label}</span>
      </div>
    </div>
  );
}
