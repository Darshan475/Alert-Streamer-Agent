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

export async function getAlerts(params?: {
  status?: string;
  team?: string;
  limit?: number;
}): Promise<import("./types").AlertListResponse> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.team) qs.set("team", params.team);
  if (params?.limit) qs.set("limit", String(params.limit));
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

export async function sendChat(
  message: string,
  alertId?: string
): Promise<import("./types").ChatResponse> {
  return fetchJson("/api/v1/chat", {
    method: "POST",
    body: JSON.stringify({ message, alert_id: alertId ?? null }),
  });
}

export async function submitHumanReview(
  alertId: string,
  payload: {
    decision: import("./types").HumanReviewDecision;
    reviewer?: string;
    feedback?: string;
    override_recommendations?: string[];
  }
): Promise<import("./types").AlertRecord> {
  return fetchJson(`/api/v1/alerts/${alertId}/human-review`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export { API_BASE };
