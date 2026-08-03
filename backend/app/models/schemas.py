from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class AlertSeverity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class AlertStatus(str, Enum):
    RECEIVED = "received"
    VALIDATED = "validated"
    DEDUPLICATED = "deduplicated"
    PRIORITIZED = "prioritized"
    ASSIGNED = "assigned"
    INVESTIGATING = "investigating"
    PENDING_REVIEW = "pending_review"
    RESOLVED = "resolved"
    DUPLICATE = "duplicate"
    REJECTED = "rejected"
    ESCALATED = "escalated"


class AlertCategory(str, Enum):
    CPU = "cpu"
    MEMORY = "memory"
    DISK = "disk"
    POD = "pod"
    DATABASE = "database"
    API = "api"
    SSL = "ssl"
    KUBERNETES = "kubernetes"
    ERROR_RATE = "error_rate"
    PAYMENT = "payment"
    OTHER = "other"


class Team(str, Enum):
    PLATFORM = "platform"
    SRE = "sre"
    DATABASE = "database"
    SECURITY = "security"
    PAYMENTS = "payments"
    FRONTEND = "frontend"
    BACKEND = "backend"


class AlertIngest(BaseModel):
    """Raw alert payload from monitoring systems."""

    source: str = Field(..., min_length=1, max_length=128)
    alert_type: str = Field(..., min_length=1, max_length=128)
    title: str = Field(..., min_length=1, max_length=512)
    description: str = Field(..., min_length=1, max_length=4096)
    severity: AlertSeverity
    service: str = Field(..., min_length=1, max_length=128)
    environment: str = Field(..., min_length=1, max_length=64)
    metric_value: float | None = None
    threshold: float | None = None
    hostname: str | None = None
    namespace: str | None = None
    pod_name: str | None = None
    region: str | None = None
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime | None = None

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, value: list[str]) -> list[str]:
        return sorted({tag.strip().lower() for tag in value if tag.strip()})


class AlertRecord(BaseModel):
    id: UUID
    fingerprint: str
    source: str
    alert_type: str
    title: str
    description: str
    severity: AlertSeverity
    priority: int = Field(ge=1, le=5)
    service: str
    environment: str
    team: Team
    category: AlertCategory
    status: AlertStatus
    metric_value: float | None = None
    threshold: float | None = None
    hostname: str | None = None
    namespace: str | None = None
    pod_name: str | None = None
    region: str | None = None
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    received_at: datetime
    updated_at: datetime
    investigation: "InvestigationResult | None" = None
    human_review: "HumanReview | None" = None


class InvestigationResult(BaseModel):
    root_cause: str
    impact_assessment: str
    recommendations: list[str]
    urgency_score: int = Field(ge=1, le=10)
    estimated_resolution_minutes: int | None = None
    related_runbooks: list[str] = Field(default_factory=list)
    investigated_at: datetime


class HumanReviewDecision(str, Enum):
    APPROVE = "approve"
    REJECT = "reject"
    ESCALATE = "escalate"


class HumanReview(BaseModel):
    decision: HumanReviewDecision
    reviewer: str
    feedback: str = ""
    reviewed_at: datetime
    override_recommendations: list[str] = Field(default_factory=list)


class HumanReviewRequest(BaseModel):
    decision: HumanReviewDecision
    reviewer: str = Field(default="on-call-engineer", min_length=1, max_length=128)
    feedback: str = Field(default="", max_length=4096)
    override_recommendations: list[str] = Field(default_factory=list)


class AlertIngestResponse(BaseModel):
    accepted: bool
    alert_id: UUID | None = None
    status: AlertStatus
    message: str
    duplicate_of: UUID | None = None


class AlertListResponse(BaseModel):
    total: int
    items: list[AlertRecord]


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    alert_id: UUID | None = None


class ChatResponse(BaseModel):
    reply: str
    alert_context_used: bool = False


class PipelineStats(BaseModel):
    total_alerts: int
    by_status: dict[str, int]
    by_priority: dict[str, int]
    by_team: dict[str, int]
