import type { AlertRecord, PipelineStats, StreamSnapshot } from "./types";

export const SNAPSHOT_KEY = "alert-streamer-snapshot";

export function computeStatsFromAlerts(items: AlertRecord[]): PipelineStats {
  const active = items.filter((a) => a.status !== "duplicate");
  const by_status: Record<string, number> = {};
  const by_priority: Record<string, number> = {};
  const by_team: Record<string, number> = {};

  for (const alert of items) {
    by_status[alert.status] = (by_status[alert.status] ?? 0) + 1;
  }
  for (const alert of active) {
    const p = `P${alert.priority}`;
    by_priority[p] = (by_priority[p] ?? 0) + 1;
    by_team[alert.team] = (by_team[alert.team] ?? 0) + 1;
  }

  return {
    total_alerts: active.length,
    by_status,
    by_priority,
    by_team,
  };
}

export function mergeSnapshots(
  base: StreamSnapshot | null,
  incoming: StreamSnapshot
): StreamSnapshot {
  const byId = new Map<string, AlertRecord>();
  for (const alert of base?.alerts.items ?? []) byId.set(alert.id, alert);
  for (const alert of incoming.alerts.items) byId.set(alert.id, alert);

  const items = [...byId.values()].sort(
    (a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime()
  );

  return {
    type: "snapshot",
    alerts: { total: items.length, items },
    stats: computeStatsFromAlerts(items),
  };
}

export function emptySnapshot(): StreamSnapshot {
  return {
    type: "snapshot",
    alerts: { total: 0, items: [] },
    stats: {
      total_alerts: 0,
      by_status: {},
      by_priority: {},
      by_team: {},
    },
  };
}

export function saveAlertSnapshot(snapshot: StreamSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota / private mode */
  }
}

export function loadAlertSnapshot(): StreamSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StreamSnapshot;
    return parsed?.type === "snapshot" ? parsed : null;
  } catch {
    return null;
  }
}

export function clearAlertSnapshot(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
}
