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

export type HumanReviewDecision = "approve" | "reject" | "escalate";

export type Team =
  | "platform"
  | "sre"
  | "database"
  | "security"
  | "payments"
  | "frontend"
  | "backend";

export interface InvestigationResult {
  root_cause: string;
  impact_assessment: string;
  recommendations: string[];
  urgency_score: number;
  estimated_resolution_minutes: number | null;
  related_runbooks: string[];
  investigated_at: string;
}

export interface HumanReview {
  decision: HumanReviewDecision;
  reviewer: string;
  feedback: string;
  reviewed_at: string;
  override_recommendations: string[];
  assigned_team?: Team | null;
  assigned_to?: string;
}

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
  investigation?: InvestigationResult | null;
  human_review?: HumanReview | null;
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

export interface ChatResponse {
  reply: string;
  alert_context_used: boolean;
  actions?: ChatAction[];
  groups?: AlertGroup[];
}

export interface ChatAction {
  type: string;
  alert_ids: string[];
  label: string;
}

export interface AlertGroup {
  group_key: string;
  service: string;
  environment: string;
  count: number;
  alert_ids: string[];
  titles: string[];
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
  { id: "ingest", label: "Ingest", description: "Agent receives alert payload" },
  { id: "validate", label: "Validate", description: "AI validation agent checks quality" },
  { id: "dedup", label: "Deduplicate", description: "AI dedup agent vs open alerts" },
  { id: "prioritize", label: "Prioritize", description: "AI assigns P1–P5 priority" },
  { id: "assign", label: "Assign Team", description: "AI routes to owning team" },
  { id: "investigate", label: "Investigate", description: "Investigation agent root cause" },
  { id: "human_review", label: "Human Review", description: "Engineer review for P1/P2" },
  { id: "resolve", label: "Resolve", description: "Routing agent closes alert" },
];

export function statusToStageIndex(status: AlertStatus): number {
  const map: Record<AlertStatus, number> = {
    received: 0,
    validated: 1,
    deduplicated: 2,
    rejected: 2,
    duplicate: 2,
    prioritized: 3,
    assigned: 4,
    investigating: 5,
    pending_review: 6,
    escalated: 6,
    resolved: 7,
  };
  return map[status] ?? 0;
}
