const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_KEY =
  process.env.NEXT_PUBLIC_ALERT_STREAMER_API_KEY || "dev-secret-change-in-production";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const body = JSON.parse(text) as { detail?: string | { msg?: string }[] };
      if (typeof body.detail === "string") throw new Error(body.detail);
      if (Array.isArray(body.detail) && body.detail[0]?.msg) {
        throw new Error(body.detail[0].msg);
      }
    } catch (parseErr) {
      if (parseErr instanceof Error && parseErr.message !== text) throw parseErr;
    }
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function ingestAlert(
  payload: import("./types").AlertIngest
): Promise<import("./types").AlertIngestResponse> {
  return fetchJson("/api/v1/alerts/ingest", {
    method: "POST",
    headers: { "X-API-Key": API_KEY },
    body: JSON.stringify(payload),
  });
}

export async function ingestRawAlert(
  payload: Record<string, unknown>
): Promise<import("./types").RawAlertStreamResponse> {
  return fetchJson("/api/v1/alerts/stream", {
    method: "POST",
    headers: { "X-API-Key": API_KEY },
    body: JSON.stringify(payload),
  });
}

export async function getAlerts(params?: {
  status?: string;
  team?: string;
  limit?: number;
  include_duplicates?: boolean;
}): Promise<import("./types").AlertListResponse> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.team) qs.set("team", params.team);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.include_duplicates) qs.set("include_duplicates", "true");
  const query = qs.toString();
  return fetchJson(`/api/v1/alerts${query ? `?${query}` : ""}`);
}

export async function getAlert(id: string): Promise<import("./types").AlertRecord> {
  return fetchJson(`/api/v1/alerts/${id}`);
}

export async function getStats(): Promise<import("./types").PipelineStats> {
  return fetchJson("/api/v1/alerts/stats");
}

export async function getHealth(): Promise<{
  status: string;
  llm_configured: boolean;
  llm_provider?: string;
  model: string;
}> {
  return fetchJson("/health");
}

export async function getLlmProviders(): Promise<import("./types").LlmProvidersResponse> {
  return fetchJson("/api/v1/llm/providers");
}

export async function setLlmProvider(
  provider: import("./types").LlmProviderId
): Promise<import("./types").SetLlmProviderResponse> {
  return fetchJson("/api/v1/llm/provider", {
    method: "PUT",
    body: JSON.stringify({ provider }),
  });
}

export async function setLlmModel(
  model: string
): Promise<import("./types").SetLlmProviderResponse> {
  return fetchJson("/api/v1/llm/model", {
    method: "PUT",
    body: JSON.stringify({ model }),
  });
}

export async function generateAgentAlert(
  hint?: string
): Promise<{
  alert: import("./types").AlertIngest;
  ingest: import("./types").AlertIngestResponse;
  snapshot: import("./types").StreamSnapshot;
}> {
  return fetchJson("/api/v1/agents/generate-alert", {
    method: "POST",
    headers: { "X-API-Key": API_KEY },
    body: JSON.stringify({ hint: hint ?? null }),
  });
}

export async function agentGeneratorChat(
  message: string
): Promise<import("./types").ChatResponse> {
  return fetchJson("/api/v1/agents/chat", {
    method: "POST",
    headers: { "X-API-Key": API_KEY },
    body: JSON.stringify({ message }),
  });
}

export const ALERT_STREAM_SNAPSHOT_EVENT = "alert-stream-snapshot";

import { saveAlertSnapshot } from "@/lib/alertSnapshotCache";

export function dispatchAlertSnapshot(snapshot: import("./types").StreamSnapshot) {
  saveAlertSnapshot(snapshot);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(ALERT_STREAM_SNAPSHOT_EVENT, { detail: snapshot })
    );
  }
}

export async function agentAutoStream(
  count: number,
  hint?: string
): Promise<{ generated: number; results: import("./types").AlertIngestResponse[] }> {
  return fetchJson("/api/v1/agents/auto-stream", {
    method: "POST",
    headers: { "X-API-Key": API_KEY },
    body: JSON.stringify({ count, hint: hint ?? null }),
  });
}

export function apiBaseToWs(base: string): string {
  if (base.startsWith("https://")) return base.replace("https://", "wss://");
  if (base.startsWith("http://")) return base.replace("http://", "ws://");
  return base;
}

export { API_BASE };
