import type { AlertRecord, AlertStatus } from "./types";

export type FilterId = AlertStatus | "all" | "prioritized";

export function isPrioritized(alert: AlertRecord): boolean {
  return alert.status === "prioritized" || alert.status === "assigned";
}

export function filterAlerts(alerts: AlertRecord[], filter: FilterId): AlertRecord[] {
  const visible = alerts.filter((a) => a.status !== "duplicate");
  if (filter === "all") return visible;
  if (filter === "prioritized") return visible.filter(isPrioritized);
  return visible.filter((a) => a.status === filter);
}

export function computeFilterCounts(alerts: AlertRecord[]): Record<string, number> {
  const visible = alerts.filter((a) => a.status !== "duplicate");
  return {
    all: visible.length,
    prioritized: visible.filter(isPrioritized).length,
    rejected: visible.filter((a) => a.status === "rejected").length,
    resolved: visible.filter((a) => a.status === "resolved").length,
  };
}
