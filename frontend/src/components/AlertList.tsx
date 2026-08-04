"use client";

import { memo, useCallback } from "react";
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

export const AlertList = memo(function AlertList({ alerts, selectedId, onSelect }: Props) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 p-12 text-center text-slate-500">
        No alerts yet. Use{" "}
        <span className="text-cyan-400">Trigger Events</span> to generate alerts.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <AlertListItem
          key={alert.id}
          alert={alert}
          selected={selectedId === alert.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
});

const AlertListItem = memo(function AlertListItem({
  alert,
  selected,
  onSelect,
}: {
  alert: AlertRecord;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const handleClick = useCallback(() => onSelect(alert.id), [alert.id, onSelect]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`w-full text-left rounded-xl border p-3.5 transition-colors hover:border-cyan-500/40 ${
        selected
          ? "border-cyan-500/60 bg-cyan-500/5 ring-1 ring-cyan-500/20"
          : "border-slate-700/60 bg-slate-900/40"
      }`}
    >
      <PipelineFlow alert={alert} className="mb-2.5" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${severityColor(alert.severity)}`}
            >
              {alert.severity}
            </span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
              {priorityLabel(alert.priority)}
            </span>
            <span className="text-[10px] text-slate-500">{teamLabel(alert.team)}</span>
            <span className={`text-[10px] capitalize ${statusColor(alert.status)}`}>
              {alert.status.replace("_", " ")}
            </span>
          </div>
          <h3 className="font-medium text-white truncate text-sm">{alert.title}</h3>
          <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{alert.description}</p>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-600 shrink-0 mt-1" />
      </div>
      <div className="mt-1.5 flex gap-3 text-[10px] text-slate-500">
        <span>{alert.service}</span>
        <span>{alert.environment}</span>
        <span>{formatTime(alert.received_at)}</span>
      </div>
    </button>
  );
});
