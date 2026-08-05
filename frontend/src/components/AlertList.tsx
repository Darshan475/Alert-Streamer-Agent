"use client";

import { memo, useCallback } from "react";
import { PipelineFlow } from "./PipelineFlow";
import type { AlertRecord } from "@/lib/types";
import {
  formatTime,
  incidentIdFromMetadata,
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
    <div className="space-y-1.5">
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
      className={`w-full text-left rounded-lg border px-2.5 py-2 transition-colors hover:border-cyan-500/40 ${
        selected
          ? "border-cyan-500/60 bg-cyan-500/5 ring-1 ring-cyan-500/20"
          : "border-slate-700/60 bg-slate-900/40"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <PipelineFlow alert={alert} compact className="shrink-0 max-w-[48%] lg:max-w-none lg:flex-1 min-w-0" />
        <div className="hidden sm:flex items-center gap-1 shrink-0 ml-auto">
          <span
            className={`rounded border px-1 py-px text-[9px] font-medium ${severityColor(alert.severity)}`}
          >
            {alert.severity}
          </span>
          <span className="rounded bg-slate-800 px-1 py-px text-[9px] text-slate-300">
            {priorityLabel(alert.priority)}
          </span>
          <span className="text-[9px] text-slate-500">{teamLabel(alert.team)}</span>
          <span className={`text-[9px] capitalize ${statusColor(alert.status)}`}>
            {alert.status.replace("_", " ")}
          </span>
        </div>
        <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0" />
      </div>

      <div className="mt-1 flex items-center gap-2 min-w-0">
        <h3 className="font-medium text-white truncate text-xs sm:text-sm min-w-0 flex-[1.4]">
          {alert.title}
        </h3>
        <p className="text-[10px] sm:text-xs text-slate-400 truncate min-w-0 flex-1 hidden md:block">
          {alert.description}
        </p>
        <div className="flex items-center gap-1.5 shrink-0 text-[9px] sm:text-[10px] text-slate-500 whitespace-nowrap ml-auto">
          <span className="text-cyan-400/90 font-mono hidden lg:inline">
            ID {incidentIdFromMetadata(alert.metadata)}
          </span>
          <span className="hidden xl:inline">{alert.service}</span>
          <span className="hidden sm:inline">{alert.environment}</span>
          <span>{formatTime(alert.received_at)}</span>
        </div>
      </div>

      <div className="mt-0.5 flex sm:hidden items-center gap-1.5 flex-wrap">
        <span
          className={`rounded border px-1 py-px text-[9px] font-medium ${severityColor(alert.severity)}`}
        >
          {alert.severity}
        </span>
        <span className="rounded bg-slate-800 px-1 py-px text-[9px] text-slate-300">
          {priorityLabel(alert.priority)}
        </span>
        <span className={`text-[9px] capitalize ${statusColor(alert.status)}`}>
          {alert.status.replace("_", " ")}
        </span>
        <span className="text-[9px] text-cyan-400/90 font-mono">
          ID {incidentIdFromMetadata(alert.metadata)}
        </span>
      </div>
    </button>
  );
});
