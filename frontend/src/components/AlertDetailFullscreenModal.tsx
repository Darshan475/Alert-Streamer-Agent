"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { AlertRecord } from "@/lib/types";
import { AlertDetailContent } from "./AlertDetailContent";
import { Maximize2, X } from "lucide-react";

interface Props {
  alert: AlertRecord;
  open: boolean;
  onClose: () => void;
  onReviewComplete: () => void;
  onToast: (message: string, type: "success" | "error") => void;
}

export function AlertDetailFullscreenModal({
  alert,
  open,
  onClose,
  onReviewComplete,
  onToast,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#0b0f19] animate-fade-in">
      <header className="shrink-0 flex items-center justify-between gap-4 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-sm px-4 sm:px-6 py-3">
        <div className="flex items-center gap-2 min-w-0 text-slate-400">
          <Maximize2 className="h-4 w-4 text-cyan-400 shrink-0" />
          <span className="text-sm font-medium text-slate-300 truncate">Alert Detail — Full Screen</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close full screen"
          className="shrink-0 flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700/60 transition-colors"
        >
          <X className="h-4 w-4" />
          <span className="hidden sm:inline">Close</span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto scroll-panel">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
          <AlertDetailContent
            alert={alert}
            onReviewComplete={onReviewComplete}
            onToast={onToast}
            spacious
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
