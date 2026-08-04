"use client";

import { useState } from "react";
import type { AlertRecord } from "@/lib/types";
import { AlertDetailContent } from "./AlertDetailContent";
import { AlertDetailFullscreenModal } from "./AlertDetailFullscreenModal";
import { Maximize2 } from "lucide-react";

interface Props {
  alert: AlertRecord | null;
  onReviewComplete: () => void;
  onToast: (message: string, type: "success" | "error") => void;
}

export function AlertDetail({ alert, onReviewComplete, onToast }: Props) {
  const [fullscreen, setFullscreen] = useState(false);

  if (!alert) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700/60 bg-slate-900/20 p-8 text-center text-slate-500 min-h-[280px] flex flex-col items-center justify-center gap-2">
        <p>Select an alert to validate and review</p>
        <p className="text-xs text-slate-600">Approve · Reject · Escalate for human-in-the-loop</p>
      </div>
    );
  }

  return (
    <>
      <div className="relative rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 min-h-[320px]">
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          aria-label="Open full screen"
          title="Full screen"
          className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-800/80 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40 hover:bg-slate-800 transition-colors"
        >
          <Maximize2 className="h-4 w-4" />
        </button>

        <AlertDetailContent
          alert={alert}
          onReviewComplete={onReviewComplete}
          onToast={onToast}
        />
      </div>

      <AlertDetailFullscreenModal
        alert={alert}
        open={fullscreen}
        onClose={() => setFullscreen(false)}
        onReviewComplete={() => {
          onReviewComplete();
        }}
        onToast={onToast}
      />
    </>
  );
}
