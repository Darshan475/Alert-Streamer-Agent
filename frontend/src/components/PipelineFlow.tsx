"use client";

import { memo } from "react";
import { PIPELINE_STAGES, statusToStageIndex } from "@/lib/types";
import type { AlertRecord } from "@/lib/types";
import { CheckCircle2, Circle } from "lucide-react";

interface Props {
  alert: AlertRecord;
  className?: string;
  compact?: boolean;
}

export const PipelineFlow = memo(function PipelineFlow({
  alert,
  className = "",
  compact = false,
}: Props) {
  const currentStage = statusToStageIndex(alert.status);

  return (
    <div
      className={`flex flex-wrap items-center gap-0.5 ${compact ? "text-[9px]" : ""} ${className}`}
    >
      {PIPELINE_STAGES.map((stage, index) => {
        const done = index < currentStage;
        const active = index === currentStage;
        return (
          <div key={stage.id} className="flex items-center gap-0.5">
            <div
              className={`flex items-center gap-0.5 rounded-full font-medium ${
                compact ? "px-1.5 py-px text-[9px]" : "px-2 py-0.5 text-[10px]"
              } ${
                done
                  ? "bg-emerald-500/15 text-emerald-300"
                  : active
                    ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40"
                    : "bg-slate-800/60 text-slate-500"
              }`}
              title={stage.description}
            >
              {done ? (
                <CheckCircle2 className={compact ? "h-2 w-2" : "h-2.5 w-2.5"} />
              ) : (
                <Circle
                  className={`${compact ? "h-2 w-2" : "h-2.5 w-2.5"} ${active ? "fill-amber-400/30" : ""}`}
                />
              )}
              {stage.label}
            </div>
            {index < PIPELINE_STAGES.length - 1 && (
              <span className={`text-slate-600 mx-px ${compact ? "text-[8px]" : "text-[10px]"}`}>→</span>
            )}
          </div>
        );
      })}
    </div>
  );
});
