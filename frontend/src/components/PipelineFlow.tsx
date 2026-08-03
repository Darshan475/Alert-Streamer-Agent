"use client";

import { PIPELINE_STAGES, statusToStageIndex } from "@/lib/types";
import type { AlertRecord } from "@/lib/types";
import { CheckCircle2, Circle } from "lucide-react";

interface Props {
  alert: AlertRecord;
}

export function PipelineFlow({ alert }: Props) {
  const currentStage = statusToStageIndex(alert.status);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {PIPELINE_STAGES.map((stage, index) => {
        const done = index < currentStage;
        const active = index === currentStage;
        return (
          <div key={stage.id} className="flex items-center gap-1">
            <div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                done
                  ? "bg-emerald-500/15 text-emerald-300"
                  : active
                    ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40"
                    : "bg-slate-800/60 text-slate-500"
              }`}
              title={stage.description}
            >
              {done ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <Circle className={`h-3 w-3 ${active ? "fill-amber-400/30" : ""}`} />
              )}
              {stage.label}
            </div>
            {index < PIPELINE_STAGES.length - 1 && (
              <span className="text-slate-600 mx-0.5">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
