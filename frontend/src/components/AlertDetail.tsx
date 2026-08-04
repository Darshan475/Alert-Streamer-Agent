"use client";

import type { ComponentType } from "react";
import type { AlertRecord } from "@/lib/types";
import {
  formatTime,
  priorityLabel,
  severityColor,
  statusColor,
  teamLabel,
} from "@/lib/utils";
import { PipelineFlow } from "./PipelineFlow";
import { HumanReviewPanel } from "./HumanReviewPanel";
import { Bot, Clock, Shield, Zap } from "lucide-react";

interface Props {
  alert: AlertRecord | null;
  onReviewComplete: () => void;
  onToast: (message: string, type: "success" | "error") => void;
}

export function AlertDetail({ alert, onReviewComplete, onToast }: Props) {
  if (!alert) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700/60 bg-slate-900/20 p-8 text-center text-slate-500 min-h-[280px] flex flex-col items-center justify-center gap-2">
        <p>Select an alert to validate and review</p>
        <p className="text-xs text-slate-600">Approve · Reject · Escalate for human-in-the-loop</p>
      </div>
    );
  }

  const inv = alert.investigation;

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-4 min-h-[320px]">
      <div>
        <div className="flex flex-wrap gap-2 mb-2">
          <span className={`rounded border px-2 py-0.5 text-xs ${severityColor(alert.severity)}`}>
            {alert.severity}
          </span>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs">{priorityLabel(alert.priority)}</span>
          <span className={`text-xs capitalize ${statusColor(alert.status)}`}>{alert.status.replace("_", " ")}</span>
        </div>
        <h2 className="text-lg font-semibold text-white">{alert.title}</h2>
        <p className="text-slate-400 mt-2">{alert.description}</p>
      </div>

      <PipelineFlow alert={alert} />

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Meta label="Service" value={alert.service} />
        <Meta label="Team" value={teamLabel(alert.team)} icon={Shield} />
        <Meta label="Environment" value={alert.environment} />
        <Meta label="Type" value={alert.alert_type} />
        {alert.metric_value != null && (
          <Meta label="Metric" value={`${alert.metric_value} / ${alert.threshold ?? "—"}`} icon={Zap} />
        )}
        {alert.pod_name && <Meta label="Pod" value={alert.pod_name} />}
        {alert.region && <Meta label="Region" value={alert.region} />}
      </div>

      {inv ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-4">
          <div className="flex items-center gap-2 text-emerald-300">
            <Bot className="h-4 w-4" />
            <span className="font-medium">LLM Investigation</span>
            <span className="text-xs text-slate-500 ml-auto">{formatTime(inv.investigated_at)}</span>
          </div>
          <div>
            <h4 className="text-sm font-medium text-slate-300">Root Cause</h4>
            <p className="text-sm text-slate-400 mt-1">{inv.root_cause}</p>
          </div>
          <div>
            <h4 className="text-sm font-medium text-slate-300">Impact</h4>
            <p className="text-sm text-slate-400 mt-1">{inv.impact_assessment}</p>
          </div>
          <div>
            <h4 className="text-sm font-medium text-slate-300">Recommendations</h4>
            <ul className="mt-1 space-y-1">
              {inv.recommendations.map((rec, i) => (
                <li key={i} className="text-sm text-slate-400 flex gap-2">
                  <span className="text-cyan-500">{i + 1}.</span>
                  {rec}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex gap-4 text-sm">
            <span className="text-amber-400">Urgency: {inv.urgency_score}/10</span>
            {inv.estimated_resolution_minutes != null && (
              <span className="text-slate-400 flex items-center gap-1">
                <Clock className="h-3 w-3" /> ~{inv.estimated_resolution_minutes} min
              </span>
            )}
          </div>
        </div>
      ) : alert.status === "investigating" ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-amber-300 text-sm animate-pulse">
          LLM is investigating this alert…
        </div>
      ) : null}

      <HumanReviewPanel alert={alert} onReviewComplete={onReviewComplete} onToast={onToast} />
    </div>
  );
}

function Meta({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg bg-slate-800/50 p-2">
      <div className="flex items-center gap-1 text-xs text-slate-500">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className="text-sm text-slate-200 mt-0.5 truncate">{value}</div>
    </div>
  );
}
