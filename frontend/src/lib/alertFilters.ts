import type { AlertRecord, AlertStatus } from "./types";

export type FilterId = AlertStatus | "all" | "prioritized";

export function isPrioritized(alert: AlertRecord): boolean {
  return alert.status === "prioritized" || alert.status === "assigned";
}

export function filterAlerts(alerts: AlertRecord[], filter: FilterId): AlertRecord[] {
  if (filter === "duplicate") return alerts.filter((a) => a.status === "duplicate");
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
    duplicate: alerts.filter((a) => a.status === "duplicate").length,
  };
}

export function searchAlerts(alerts: AlertRecord[], query: string): AlertRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return alerts;
  return alerts.filter((a) => {
    const incidentId = String(a.metadata?.incident_id ?? "").toLowerCase();
    return (
      a.title.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.service.toLowerCase().includes(q) ||
      a.status.toLowerCase().includes(q) ||
      incidentId.includes(q)
    );
  });
}
