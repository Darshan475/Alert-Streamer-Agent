"use client";

import { useEffect, useState } from "react";
import { submitHumanReview } from "@/lib/api";
import { TEAM_ASSIGNEES, suggestTeam } from "@/lib/assignees";
import type { AlertRecord, HumanReviewDecision, Team } from "@/lib/types";
import { formatTime, teamLabel } from "@/lib/utils";
import { HumanReviewModal } from "./HumanReviewModal";
import { Maximize2, UserCheck, Users } from "lucide-react";

interface Props {
  alert: AlertRecord;
  onReviewComplete: () => void;
  onToast: (message: string, type: "success" | "error") => void;
}

export function HumanReviewPanel({ alert, onReviewComplete, onToast }: Props) {
  const suggestedTeam = suggestTeam(alert.category, alert.team);
  const [feedback, setFeedback] = useState("");
  const [reviewer, setReviewer] = useState("on-call-engineer");
  const [assignedTeam, setAssignedTeam] = useState<Team>(alert.team);
  const [assignedTo, setAssignedTo] = useState("");
  const [submitting, setSubmitting] = useState<HumanReviewDecision | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const assigneeOptions = TEAM_ASSIGNEES[assignedTeam] ?? [];

  useEffect(() => {
    setAssignedTeam(alert.team);
    setAssignedTo("");
    setFeedback("");
  }, [alert.id, alert.team]);

  const canReview =
    alert.status === "pending_review" ||
    alert.status === "investigating" ||
    alert.status === "escalated";

  useEffect(() => {
    if (canReview && (alert.status === "pending_review" || alert.status === "escalated")) {
      setModalOpen(true);
    } else {
      setModalOpen(false);
    }
  }, [alert.id, alert.status, canReview]);

  async function handleDecision(decision: HumanReviewDecision) {
    if (
      (decision === "approve" || decision === "escalate") &&
      !assignedTo.trim()
    ) {
      onToast("Assign the ticket to a team member before approving or escalating.", "error");
      return;
    }

    setSubmitting(decision);
    try {
      await submitHumanReview(alert.id, {
        decision,
        reviewer,
        feedback,
        assigned_team: assignedTeam,
        assigned_to: assignedTo.trim(),
      });
      const labels = { approve: "approved", reject: "rejected", escalate: "escalated" };
      const assignMsg =
        decision !== "reject" && assignedTo
          ? ` → assigned to ${assignedTo} (${teamLabel(assignedTeam)})`
          : "";
      onToast(`Alert ${labels[decision]} by ${reviewer}${assignMsg}`, "success");
      setFeedback("");
      setModalOpen(false);
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
        {!isAutoResolved && hr.assigned_to && (
          <p className="text-sm text-slate-400 flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-cyan-400" />
            Assigned to{" "}
            <span className="text-cyan-300">{hr.assigned_to}</span>
            {hr.assigned_team && (
              <span className="text-slate-500">· {teamLabel(hr.assigned_team)} team</span>
            )}
          </p>
        )}
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
    <>
      <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-violet-500/5 p-4">
        <div className="flex items-start gap-3">
          <UserCheck className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-amber-200 text-sm">Human Review Required</p>
            <p className="text-xs text-slate-400 mt-1">
              {alert.investigation
                ? "LLM investigation is complete. Open the full review to assign and decide."
                : "Investigation in progress. You can open review to assign while waiting."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 transition-colors"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Open Review
          </button>
        </div>
      </div>

      <HumanReviewModal
        alert={alert}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        reviewer={reviewer}
        onReviewerChange={setReviewer}
        assignedTeam={assignedTeam}
        onAssignedTeamChange={setAssignedTeam}
        assignedTo={assignedTo}
        onAssignedToChange={setAssignedTo}
        feedback={feedback}
        onFeedbackChange={setFeedback}
        assigneeOptions={assigneeOptions}
        suggestedTeam={suggestedTeam}
        submitting={submitting}
        onDecision={handleDecision}
      />
    </>
  );
}
