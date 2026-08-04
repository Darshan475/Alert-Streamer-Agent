"use client";

import { useEffect, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TEAMS } from "@/lib/assignees";
import type { AlertRecord, HumanReviewDecision, Team } from "@/lib/types";
import {
  formatTime,
  priorityLabel,
  severityColor,
  statusColor,
  teamLabel,
} from "@/lib/utils";
import { PipelineFlow } from "./PipelineFlow";
import { LoadingOverlay } from "./LoadingOverlay";
import {
  ArrowUpCircle,
  Bot,
  CheckCircle2,
  Clock,
  Loader2,
  Shield,
  UserCheck,
  X,
  XCircle,
  Zap,
} from "lucide-react";

interface Props {
  alert: AlertRecord;
  open: boolean;
  onClose: () => void;
  reviewer: string;
  onReviewerChange: (v: string) => void;
  assignedTeam: Team;
  onAssignedTeamChange: (t: Team) => void;
  assignedTo: string;
  onAssignedToChange: (v: string) => void;
  feedback: string;
  onFeedbackChange: (v: string) => void;
  assigneeOptions: string[];
  suggestedTeam: Team;
  submitting: HumanReviewDecision | null;
  onDecision: (decision: HumanReviewDecision) => void;
}

export function HumanReviewModal({
  alert,
  open,
  onClose,
  reviewer,
  onReviewerChange,
  assignedTeam,
  onAssignedTeamChange,
  assignedTo,
  onAssignedToChange,
  feedback,
  onFeedbackChange,
  assigneeOptions,
  suggestedTeam,
  submitting,
  onDecision,
}: Props) {
  const inv = alert.investigation;
  const busy = !!submitting;

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
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#0b0f19] animate-fade-in">
      <header className="shrink-0 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-sm px-4 sm:px-6 py-4">
        <div className="flex items-start gap-4 max-w-7xl mx-auto">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span
                className={`rounded border px-2 py-0.5 text-xs font-medium ${severityColor(alert.severity)}`}
              >
                {alert.severity}
              </span>
              <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                {priorityLabel(alert.priority)}
              </span>
              <span className={`text-xs capitalize ${statusColor(alert.status)}`}>
                {alert.status.replace(/_/g, " ")}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-amber-300">
                <UserCheck className="h-3.5 w-3.5" />
                Human Review
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold text-white truncate">{alert.title}</h1>
            <p className="text-sm text-slate-400 mt-1 line-clamp-2">{alert.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="shrink-0 rounded-lg border border-slate-700/80 bg-slate-800/60 p-2 text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors disabled:opacity-50"
            aria-label="Close review"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-w-7xl mx-auto mt-4">
          <PipelineFlow alert={alert} />
        </div>
      </header>

      <main className="relative flex-1 overflow-hidden">
        <LoadingOverlay show={busy} label="Submitting review…" />

        <div className="h-full overflow-y-auto scroll-panel">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid lg:grid-cols-5 gap-6">
            <section className="lg:col-span-3 space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <Meta label="Service" value={alert.service} />
                <Meta label="Team" value={teamLabel(alert.team)} icon={Shield} />
                <Meta label="Environment" value={alert.environment} />
                <Meta label="Type" value={alert.alert_type} />
                <Meta label="Category" value={alert.category} />
                {alert.metric_value != null && (
                  <Meta
                    label="Metric"
                    value={`${alert.metric_value} / ${alert.threshold ?? "—"}`}
                    icon={Zap}
                  />
                )}
                {alert.pod_name && <Meta label="Pod" value={alert.pod_name} />}
                {alert.region && <Meta label="Region" value={alert.region} />}
                {alert.hostname && <Meta label="Host" value={alert.hostname} />}
              </div>

              {inv ? (
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-5 space-y-4">
                  <div className="flex items-center gap-2 text-emerald-300">
                    <Bot className="h-5 w-5" />
                    <span className="font-medium">LLM Investigation</span>
                    <span className="text-xs text-slate-500 ml-auto">
                      {formatTime(inv.investigated_at)}
                    </span>
                  </div>
                  <Block title="Root Cause" text={inv.root_cause} />
                  <Block title="Impact Assessment" text={inv.impact_assessment} />
                  <div>
                    <h4 className="text-sm font-medium text-slate-300">Recommendations</h4>
                    <ul className="mt-2 space-y-1.5">
                      {inv.recommendations.map((rec, i) => (
                        <li key={i} className="text-sm text-slate-400 flex gap-2">
                          <span className="text-cyan-500 shrink-0">{i + 1}.</span>
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {inv.related_runbooks.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-slate-300">Related Runbooks</h4>
                      <ul className="mt-2 space-y-1">
                        {inv.related_runbooks.map((rb) => (
                          <li key={rb} className="text-sm text-cyan-400/90">
                            {rb}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-4 text-sm pt-1">
                    <span className="text-amber-400">Urgency: {inv.urgency_score}/10</span>
                    {inv.estimated_resolution_minutes != null && (
                      <span className="text-slate-400 flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" /> ~{inv.estimated_resolution_minutes} min
                      </span>
                    )}
                  </div>
                </div>
              ) : alert.status === "investigating" ? (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-8 flex flex-col items-center gap-3 text-center">
                  <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
                  <p className="text-amber-200 font-medium">LLM is investigating this alert…</p>
                  <p className="text-sm text-slate-500 max-w-md">
                    Root cause analysis and recommendations will appear here when ready. You can assign
                    the ticket now or wait for investigation to complete.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-5 text-sm text-slate-500">
                  No LLM investigation available for this alert yet.
                </div>
              )}

              {alert.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {alert.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-slate-800/80 px-2.5 py-0.5 text-xs text-slate-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <aside className="lg:col-span-2">
              <div className="lg:sticky lg:top-0 rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-violet-500/5 p-5 space-y-4">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-medium text-amber-200">
                    <UserCheck className="h-4 w-4" />
                    Assignment & Decision
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Assign this ticket to the right team and owner, then approve, reject, or escalate.
                  </p>
                </div>

                <div className="space-y-3">
                  <Field label="Reviewer (you)">
                    <input
                      value={reviewer}
                      onChange={(e) => onReviewerChange(e.target.value)}
                      className="w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Assign to team">
                      <select
                        value={assignedTeam}
                        onChange={(e) => {
                          onAssignedTeamChange(e.target.value as Team);
                          onAssignedToChange("");
                        }}
                        className="w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
                      >
                        {TEAMS.map((t) => (
                            <option key={t} value={t}>
                              {teamLabel(t)}
                              {t === suggestedTeam ? " (suggested)" : ""}
                              {t === alert.team && t !== suggestedTeam ? " (current)" : ""}
                            </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Assign to user">
                      <select
                        value={assignedTo}
                        onChange={(e) => onAssignedToChange(e.target.value)}
                        className="w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
                      >
                        <option value="">Select assignee…</option>
                        {assigneeOptions.map((user) => (
                          <option key={user} value={user}>
                            {user}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <Field label="Or type username / email">
                    <input
                      value={assignedTo}
                      onChange={(e) => onAssignedToChange(e.target.value)}
                      placeholder="engineer@company.com"
                      className="w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
                    />
                  </Field>

                  <Field label="Feedback (optional)">
                    <textarea
                      value={feedback}
                      onChange={(e) => onFeedbackChange(e.target.value)}
                      rows={4}
                      placeholder="Handoff notes for the assigned engineer…"
                      className="w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500/40 resize-none"
                    />
                  </Field>
                </div>

                <div className="flex flex-col gap-2 pt-1">
                  <ActionBtn
                    label="Approve & Assign"
                    icon={CheckCircle2}
                    color="emerald"
                    loading={submitting === "approve"}
                    disabled={busy}
                    onClick={() => onDecision("approve")}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <ActionBtn
                      label="Reject"
                      icon={XCircle}
                      color="red"
                      loading={submitting === "reject"}
                      disabled={busy}
                      onClick={() => onDecision("reject")}
                    />
                    <ActionBtn
                      label="Escalate"
                      icon={ArrowUpCircle}
                      color="amber"
                      loading={submitting === "escalate"}
                      disabled={busy}
                      onClick={() => onDecision("escalate")}
                    />
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>,
    document.body,
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
    <div className="rounded-lg bg-slate-800/50 p-3">
      <div className="flex items-center gap-1 text-xs text-slate-500">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className="text-sm text-slate-200 mt-0.5 truncate">{value}</div>
    </div>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h4 className="text-sm font-medium text-slate-300">{title}</h4>
      <p className="text-sm text-slate-400 mt-1 leading-relaxed">{text}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function ActionBtn({
  label,
  icon: Icon,
  color,
  loading,
  disabled,
  onClick,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  color: "emerald" | "red" | "amber";
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const colors = {
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20",
    red: "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all disabled:opacity-50 ${colors[color]}`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {label}
    </button>
  );
}
