"use client";

import type { ComponentType } from "react";
import type { AlertRecord } from "@/lib/types";
import {
  incidentIdFromMetadata,
  priorityLabel,
  severityColor,
  statusColor,
  teamLabel,
} from "@/lib/utils";
import { Bot, Shield, Zap } from "lucide-react";

interface Props {
  alert: AlertRecord;
  onReviewComplete: () => void;
  onToast: (message: string, type: "success" | "error") => void;
  spacious?: boolean;
}

export function AlertDetailContent({
  alert,
  onReviewComplete: _onReviewComplete,
  onToast: _onToast,
  spacious = false,
}: Props) {
  const titleClass = spacious ? "text-2xl" : "text-lg";
  const pad = spacious ? "space-y-6" : "space-y-4";

  return (
    <div className={pad}>
      <div>
        <div className="flex flex-wrap gap-2 mb-2">
          <span className={`rounded border px-2 py-0.5 text-xs ${severityColor(alert.severity)}`}>
            {alert.severity}
          </span>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs">{priorityLabel(alert.priority)}</span>
          <span className={`text-xs capitalize ${statusColor(alert.status)}`}>
            {alert.status.replace(/_/g, " ")}
          </span>
        </div>
        <h2 className={`${titleClass} font-semibold text-white`}>{alert.title}</h2>
        <p className={`text-slate-400 mt-2 ${spacious ? "text-base leading-relaxed" : ""}`}>
          {alert.description}
        </p>
      </div>

      <div className={`grid grid-cols-2 ${spacious ? "sm:grid-cols-3 gap-4" : "gap-3"} text-sm`}>
        <Meta label="Incident ID" value={incidentIdFromMetadata(alert.metadata)} spacious={spacious} />
        <Meta label="Service" value={alert.service} spacious={spacious} />
        <Meta label="Team" value={teamLabel(alert.team)} icon={Shield} spacious={spacious} />
        <Meta label="Environment" value={alert.environment} spacious={spacious} />
        <Meta label="Type" value={alert.alert_type} spacious={spacious} />
        {alert.metric_value != null && (
          <Meta
            label="Metric"
            value={`${alert.metric_value} / ${alert.threshold ?? "—"}`}
            icon={Zap}
            spacious={spacious}
          />
        )}
        {alert.pod_name && <Meta label="Pod" value={alert.pod_name} spacious={spacious} />}
        {alert.region && <Meta label="Region" value={alert.region} spacious={spacious} />}
        {alert.hostname && <Meta label="Host" value={alert.hostname} spacious={spacious} />}
      </div>

      {Array.isArray(alert.metadata?.pipeline_agent_log) && (
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-cyan-300 text-sm font-medium">
            <Bot className="h-4 w-4" />
            Agent Pipeline Log
          </div>
          <ul className="space-y-1">
            {(alert.metadata.pipeline_agent_log as Array<{ stage?: string; reasoning?: string }>).map(
              (entry, i) => (
                <li key={i} className="text-xs text-slate-400">
                  <span className="text-emerald-400 capitalize">{entry.stage}</span>
                  {entry.reasoning ? ` — ${entry.reasoning}` : ""}
                </li>
              )
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function Meta({
  label,
  value,
  icon: Icon,
  spacious,
}: {
  label: string;
  value: string;
  icon?: ComponentType<{ className?: string }>;
  spacious?: boolean;
}) {
  return (
    <div className={`rounded-lg bg-slate-800/50 ${spacious ? "p-3" : "p-2"}`}>
      <div className="flex items-center gap-1 text-xs text-slate-500">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className="text-sm text-slate-200 mt-0.5 truncate">{value}</div>
    </div>
  );
}
