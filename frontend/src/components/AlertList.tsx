"use client";

import { PipelineFlow } from "./PipelineFlow";
import type { AlertRecord } from "@/lib/types";
import {
  formatTime,
  priorityLabel,
  severityColor,
  statusColor,
  teamLabel,
} from "@/lib/utils";
import { ChevronRight } from "lucide-react";

interface Props {
  alerts: AlertRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function AlertList({ alerts, selectedId, onSelect }: Props) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 p-12 text-center text-slate-500">
        No alerts yet. Run{" "}
        <code className="text-cyan-400">python scripts/trigger_alerts.py</code> to ingest
        dummy data.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert) => (
        <button
          key={alert.id}
          type="button"
          onClick={() => onSelect(alert.id)}
          className={`w-full text-left rounded-xl border p-4 transition-all hover:border-cyan-500/40 ${
            selectedId === alert.id
              ? "border-cyan-500/60 bg-cyan-500/5 ring-1 ring-cyan-500/20"
              : "border-slate-700/60 bg-slate-900/40"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span
                  className={`rounded border px-2 py-0.5 text-xs font-medium ${severityColor(alert.severity)}`}
                >
                  {alert.severity}
                </span>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                  {priorityLabel(alert.priority)}
                </span>
                <span className="text-xs text-slate-500">{teamLabel(alert.team)}</span>
                <span className={`text-xs capitalize ${statusColor(alert.status)}`}>
                  {alert.status.replace("_", " ")}
                </span>
                {alert.status === "pending_review" && (
                  <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] text-violet-300 uppercase tracking-wide">
                    HITL
                  </span>
                )}
              </div>
              <h3 className="font-medium text-white truncate">{alert.title}</h3>
              <p className="text-sm text-slate-400 mt-1 line-clamp-1">{alert.description}</p>
              <div className="mt-3">
                <PipelineFlow alert={alert} />
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-600 shrink-0 mt-1" />
          </div>
          <div className="mt-2 flex gap-3 text-xs text-slate-500">
            <span>{alert.service}</span>
            <span>{alert.environment}</span>
            <span>{formatTime(alert.received_at)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
