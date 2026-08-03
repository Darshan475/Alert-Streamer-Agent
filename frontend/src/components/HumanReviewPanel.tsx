"use client";

import { useState, type ComponentType } from "react";
import { submitHumanReview } from "@/lib/api";
import type { AlertRecord, HumanReviewDecision } from "@/lib/types";
import { formatTime } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  ArrowUpCircle,
  UserCheck,
  Loader2,
} from "lucide-react";

interface Props {
  alert: AlertRecord;
  onReviewComplete: () => void;
  onToast: (message: string, type: "success" | "error") => void;
}

export function HumanReviewPanel({ alert, onReviewComplete, onToast }: Props) {
  const [feedback, setFeedback] = useState("");
  const [reviewer, setReviewer] = useState("on-call-engineer");
  const [submitting, setSubmitting] = useState<HumanReviewDecision | null>(null);

  const canReview =
    alert.status === "pending_review" ||
    alert.status === "investigating" ||
    alert.status === "escalated";

  async function handleDecision(decision: HumanReviewDecision) {
    setSubmitting(decision);
    try {
      await submitHumanReview(alert.id, {
        decision,
        reviewer,
        feedback,
      });
      const labels = { approve: "approved", reject: "rejected", escalate: "escalated" };
      onToast(`Alert ${labels[decision]} by ${reviewer}`, "success");
      setFeedback("");
      onReviewComplete();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Review failed", "error");
    } finally {
      setSubmitting(null);
    }
  }

  if (alert.human_review && alert.status !== "escalated") {
    const hr = alert.human_review;
    const isAutoResolved = hr.reviewer === "system-auto-resolve";
    return (
      <div
        className={`rounded-xl border p-4 space-y-2 ${
          isAutoResolved
            ? "border-emerald-500/25 bg-emerald-500/5"
            : "border-violet-500/25 bg-violet-500/5"
        }`}
      >
        <div
          className={`flex items-center gap-2 ${isAutoResolved ? "text-emerald-300" : "text-violet-300"}`}
        >
          <UserCheck className="h-4 w-4" />
          <span className="font-medium text-sm">
            {isAutoResolved ? "Auto-Resolved" : `Human Review — ${hr.decision}`}
          </span>
          <span className="text-xs text-slate-500 ml-auto">{formatTime(hr.reviewed_at)}</span>
        </div>
        <p className="text-sm text-slate-400">
          {isAutoResolved ? "Resolved by" : "Reviewer:"}{" "}
          <span className="text-slate-200">{isAutoResolved ? "pipeline policy" : hr.reviewer}</span>
        </p>
        {hr.feedback && (
          <p
            className={`text-sm text-slate-400 border-l-2 pl-3 ${
              isAutoResolved ? "border-emerald-500/40" : "border-violet-500/40"
            }`}
          >
            {hr.feedback}
          </p>
        )}
      </div>
    );
  }

  if (!canReview) return null;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-violet-500/5 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <UserCheck className="h-4 w-4 text-amber-400" />
        <span className="font-medium text-amber-200 text-sm">Human-in-the-Loop Review</span>
        <span className="ml-auto text-xs text-amber-400/80 animate-pulse">Awaiting your decision</span>
      </div>

      <p className="text-xs text-slate-400">
        LLM investigation complete. P1/P2 alerts require your approval — approve to resolve, reject as false
        positive, or escalate priority.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-500 col-span-2">Reviewer</label>
        <input
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          className="col-span-2 rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500/40"
        />
        <label className="text-xs text-slate-500 col-span-2">Feedback (optional)</label>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={2}
          placeholder="Add notes for the team…"
          className="col-span-2 rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500/40 resize-none"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <ActionBtn
          label="Approve"
          icon={CheckCircle2}
          color="emerald"
          loading={submitting === "approve"}
          disabled={!!submitting}
          onClick={() => handleDecision("approve")}
        />
        <ActionBtn
          label="Reject"
          icon={XCircle}
          color="red"
          loading={submitting === "reject"}
          disabled={!!submitting}
          onClick={() => handleDecision("reject")}
        />
        <ActionBtn
          label="Escalate"
          icon={ArrowUpCircle}
          color="amber"
          loading={submitting === "escalate"}
          disabled={!!submitting}
          onClick={() => handleDecision("escalate")}
        />
      </div>
    </div>
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
      className={`flex flex-1 min-w-[100px] items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all disabled:opacity-50 ${colors[color]}`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {label}
    </button>
  );
}
