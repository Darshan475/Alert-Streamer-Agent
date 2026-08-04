export type AlertSeverity = "critical" | "high" | "medium" | "low" | "info";
export type AlertStatus =
  | "received"
  | "validated"
  | "deduplicated"
  | "prioritized"
  | "assigned"
  | "investigating"
  | "pending_review"
  | "resolved"
  | "duplicate"
  | "rejected"
  | "escalated";

export type Team =
  | "platform"
  | "sre"
  | "database"
  | "security"
  | "payments"
  | "frontend"
  | "backend";

export interface AlertRecord {
  id: string;
  fingerprint: string;
  source: string;
  alert_type: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  priority: number;
  service: string;
  environment: string;
  team: Team;
  category: string;
  status: AlertStatus;
  metric_value?: number | null;
  threshold?: number | null;
  hostname?: string | null;
  namespace?: string | null;
  pod_name?: string | null;
  region?: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  received_at: string;
  updated_at: string;
}

export interface AlertIngest {
  source: string;
  alert_type: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  service: string;
  environment: string;
  metric_value?: number | null;
  threshold?: number | null;
  hostname?: string | null;
  namespace?: string | null;
  pod_name?: string | null;
  region?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface AlertIngestResponse {
  accepted: boolean;
  alert_id: string | null;
  status: AlertStatus;
  message: string;
  duplicate_of: string | null;
}

export interface RawAlertStreamResponse {
  normalized: AlertIngest;
  ingest: AlertIngestResponse;
}

export interface AlertListResponse {
  total: number;
  items: AlertRecord[];
}

export interface PipelineStats {
  total_alerts: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  by_team: Record<string, number>;
}

export type LlmProviderId = "gemini" | "openrouter" | "groq" | "huggingface" | "nvidia" | "offline";

export interface LlmProviderInfo {
  id: LlmProviderId;
  label: string;
  model: string;
  free: boolean;
  is_default: boolean;
  configured: boolean;
  key_hint: string;
  signup_url: string;
  models?: string[];
}

export interface LlmProvidersResponse {
  active_provider: LlmProviderId;
  default_provider: LlmProviderId;
  active_model: string;
  providers: LlmProviderInfo[];
}

export interface SetLlmProviderResponse {
  active_provider: LlmProviderId;
  label: string;
  model: string;
  configured: boolean;
  message: string;
}

export interface PipelineStage {
  id: string;
  label: string;
  description: string;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "ingest", label: "Ingest", description: "Agent normalizes raw monitoring payload" },
  { id: "validate", label: "Validate", description: "AI validation agent checks quality" },
  { id: "dedup", label: "Deduplicate", description: "AI dedup agent vs open alerts" },
  { id: "prioritize", label: "Prioritize", description: "AI assigns P1–P5 priority" },
];

export function statusToStageIndex(status: AlertStatus): number {
  const map: Record<AlertStatus, number> = {
    received: 0,
    validated: 1,
    deduplicated: 2,
    rejected: 2,
    duplicate: 2,
    prioritized: 3,
    assigned: 3,
    investigating: 3,
    pending_review: 3,
    escalated: 3,
    resolved: 3,
  };
  return map[status] ?? 0;
}
