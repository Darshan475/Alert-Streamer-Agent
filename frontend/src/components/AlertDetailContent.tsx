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
  alert: AlertRecord;
  onReviewComplete: () => void;
  onToast: (message: string, type: "success" | "error") => void;
  spacious?: boolean;
}

export function AlertDetailContent({
  alert,
  onReviewComplete,
  onToast,
  spacious = false,
}: Props) {
  const inv = alert.investigation;
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

      <PipelineFlow alert={alert} />

      <div className={`grid grid-cols-2 ${spacious ? "sm:grid-cols-3 gap-4" : "gap-3"} text-sm`}>
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

      {inv ? (
        <div
          className={`rounded-lg border border-emerald-500/20 bg-emerald-500/5 ${spacious ? "p-6 space-y-5" : "p-4 space-y-4"}`}
        >
          <div className="flex items-center gap-2 text-emerald-300">
            <Bot className={spacious ? "h-5 w-5" : "h-4 w-4"} />
            <span className="font-medium">LLM Investigation</span>
            <span className="text-xs text-slate-500 ml-auto">{formatTime(inv.investigated_at)}</span>
          </div>
          <InvestigationBlock title="Root Cause" text={inv.root_cause} spacious={spacious} />
          <InvestigationBlock title="Impact" text={inv.impact_assessment} spacious={spacious} />
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

function InvestigationBlock({
  title,
  text,
  spacious,
}: {
  title: string;
  text: string;
  spacious?: boolean;
}) {
  return (
    <div>
      <h4 className="text-sm font-medium text-slate-300">{title}</h4>
      <p className={`text-sm text-slate-400 mt-1 ${spacious ? "leading-relaxed" : ""}`}>{text}</p>
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
