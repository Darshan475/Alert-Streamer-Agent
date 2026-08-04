import type { AlertRecord, AlertStatus } from "./types";

export type FilterId = AlertStatus | "all" | "needs_review";

const NEEDS_REVIEW_STATUSES: AlertStatus[] = ["pending_review", "investigating", "escalated"];

export function isNeedsReview(alert: AlertRecord): boolean {
  return alert.priority <= 2 && NEEDS_REVIEW_STATUSES.includes(alert.status);
}

export function filterAlerts(alerts: AlertRecord[], filter: FilterId): AlertRecord[] {
  const visible = alerts.filter((a) => a.status !== "duplicate");
  if (filter === "all") return visible;
  if (filter === "needs_review") return visible.filter(isNeedsReview);
  return visible.filter((a) => a.status === filter);
}

export function computeFilterCounts(alerts: AlertRecord[]): Record<string, number> {
  const visible = alerts.filter((a) => a.status !== "duplicate");
  return {
    all: visible.length,
    needs_review: visible.filter(isNeedsReview).length,
    pending_review: visible.filter((a) => a.status === "pending_review").length,
    investigating: visible.filter((a) => a.status === "investigating").length,
    escalated: visible.filter((a) => a.status === "escalated").length,
    resolved: visible.filter((a) => a.status === "resolved").length,
  };
}
