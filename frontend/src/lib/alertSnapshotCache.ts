import type { StreamSnapshot } from "./types";

const SNAPSHOT_KEY = "alert-streamer-snapshot";

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
