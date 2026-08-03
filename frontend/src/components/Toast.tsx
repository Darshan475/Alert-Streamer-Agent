"use client";

import { useEffect } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

interface Props {
  message: string;
  type: "success" | "error";
  onDismiss: () => void;
}

export function Toast({ message, type, onDismiss }: Props) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className={`toast-enter fixed bottom-24 right-6 z-[60] flex items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur-md ${
        type === "success"
          ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-200"
          : "border-red-500/40 bg-red-950/90 text-red-200"
      }`}
    >
      {type === "success" ? (
        <CheckCircle2 className="h-4 w-4 shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0" />
      )}
      {message}
    </div>
  );
}
