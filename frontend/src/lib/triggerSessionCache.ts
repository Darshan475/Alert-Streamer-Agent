const TRIGGER_KEY = "alert-streamer-trigger-session";

export interface TriggerSessionData {
  generated: import("./types").AlertIngest[];
  events: Array<{
    id: string;
    ts: string;
    title: string;
    status: string;
    message: string;
    source: string;
    severity: string;
  }>;
  metrics: {
    sent: number;
    accepted: number;
    rejected: number;
    duplicates: number;
  };
  streamCount: number;
}

export function saveTriggerSession(data: TriggerSessionData): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(TRIGGER_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

export function loadTriggerSession(): TriggerSessionData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(TRIGGER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TriggerSessionData;
  } catch {
    return null;
  }
}

export function clearTriggerSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(TRIGGER_KEY);
  } catch {
    /* ignore */
  }
}
