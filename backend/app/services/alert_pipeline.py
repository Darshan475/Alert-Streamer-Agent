"""Alert processing pipeline: validate, deduplicate, prioritize, assign team."""

import hashlib
import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from app.models.schemas import (
    AlertCategory,
    AlertIngest,
    AlertIngestResponse,
    AlertRecord,
    AlertSeverity,
    AlertStatus,
    Team,
)

REQUIRED_FIELDS = ("source", "alert_type", "title", "description", "severity", "service", "environment")

# Map alert types to categories and default teams
ALERT_TYPE_MAP: dict[str, tuple[AlertCategory, Team]] = {
    "cpu_high": (AlertCategory.CPU, Team.PLATFORM),
    "cpu_critical": (AlertCategory.CPU, Team.PLATFORM),
    "memory_leak": (AlertCategory.MEMORY, Team.SRE),
    "memory_high": (AlertCategory.MEMORY, Team.SRE),
    "disk_full": (AlertCategory.DISK, Team.PLATFORM),
    "disk_usage_high": (AlertCategory.DISK, Team.PLATFORM),
    "pod_crash": (AlertCategory.POD, Team.SRE),
    "pod_crashloop": (AlertCategory.POD, Team.SRE),
    "database_timeout": (AlertCategory.DATABASE, Team.DATABASE),
    "db_connection_pool_exhausted": (AlertCategory.DATABASE, Team.DATABASE),
    "api_latency": (AlertCategory.API, Team.BACKEND),
    "api_latency_high": (AlertCategory.API, Team.BACKEND),
    "ssl_certificate_expiring": (AlertCategory.SSL, Team.SECURITY),
    "ssl_cert_expiry": (AlertCategory.SSL, Team.SECURITY),
    "kubernetes_node_down": (AlertCategory.KUBERNETES, Team.PLATFORM),
    "node_not_ready": (AlertCategory.KUBERNETES, Team.PLATFORM),
    "high_error_rate": (AlertCategory.ERROR_RATE, Team.BACKEND),
    "error_rate_spike": (AlertCategory.ERROR_RATE, Team.BACKEND),
    "payment_service_unavailable": (AlertCategory.PAYMENT, Team.PAYMENTS),
    "payment_gateway_down": (AlertCategory.PAYMENT, Team.PAYMENTS),
}

SEVERITY_PRIORITY: dict[AlertSeverity, int] = {
    AlertSeverity.CRITICAL: 1,
    AlertSeverity.HIGH: 2,
    AlertSeverity.MEDIUM: 3,
    AlertSeverity.LOW: 4,
    AlertSeverity.INFO: 5,
}

# Only P1 and P2 require human review; P3+ auto-resolve after LLM investigation
HUMAN_REVIEW_MAX_PRIORITY = 2

CLOSED_STATUSES = frozenset(
    {AlertStatus.RESOLVED, AlertStatus.REJECTED, AlertStatus.DUPLICATE}
)

if TYPE_CHECKING:
    from app.services.alert_store import AlertStore


def validate_alert(alert: AlertIngest) -> list[str]:
    """Return list of validation errors; empty means valid."""
    errors: list[str] = []
    for field in REQUIRED_FIELDS:
        value = getattr(alert, field, None)
        if value is None or (isinstance(value, str) and not value.strip()):
            errors.append(f"Missing required field: {field}")

    if alert.metric_value is not None and alert.threshold is not None:
        if alert.metric_value < 0 or alert.threshold < 0:
            errors.append("metric_value and threshold must be non-negative")

    return errors


def compute_fingerprint(alert: AlertIngest) -> str:
    """Stable hash for deduplication within a time window."""
    key = {
        "source": alert.source,
        "alert_type": alert.alert_type.lower(),
        "service": alert.service.lower(),
        "environment": alert.environment.lower(),
        "hostname": (alert.hostname or "").lower(),
        "namespace": (alert.namespace or "").lower(),
        "pod_name": (alert.pod_name or "").lower(),
    }
    payload = json.dumps(key, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def classify_alert(alert: AlertIngest) -> tuple[AlertCategory, Team]:
    normalized = alert.alert_type.lower().replace(" ", "_").replace("-", "_")
    if normalized in ALERT_TYPE_MAP:
        return ALERT_TYPE_MAP[normalized]

    title_lower = alert.title.lower()
    if "cpu" in title_lower:
        return AlertCategory.CPU, Team.PLATFORM
    if "memory" in title_lower or "leak" in title_lower:
        return AlertCategory.MEMORY, Team.SRE
    if "disk" in title_lower:
        return AlertCategory.DISK, Team.PLATFORM
    if "pod" in title_lower or "crash" in title_lower:
        return AlertCategory.POD, Team.SRE
    if "database" in title_lower or "db" in title_lower or "timeout" in title_lower:
        return AlertCategory.DATABASE, Team.DATABASE
    if "latency" in title_lower or "api" in title_lower:
        return AlertCategory.API, Team.BACKEND
    if "ssl" in title_lower or "certificate" in title_lower:
        return AlertCategory.SSL, Team.SECURITY
    if "node" in title_lower or "kubernetes" in title_lower:
        return AlertCategory.KUBERNETES, Team.PLATFORM
    if "error rate" in title_lower or "error_rate" in title_lower:
        return AlertCategory.ERROR_RATE, Team.BACKEND
    if "payment" in title_lower:
        return AlertCategory.PAYMENT, Team.PAYMENTS

    return AlertCategory.OTHER, Team.SRE


def assign_priority(alert: AlertIngest, category: AlertCategory) -> int:
    base = SEVERITY_PRIORITY[alert.severity]

    # Escalate critical infra and payment alerts
    if category in (AlertCategory.PAYMENT, AlertCategory.KUBERNETES) and base <= 2:
        return 1
    if category == AlertCategory.SSL and alert.severity in (AlertSeverity.CRITICAL, AlertSeverity.HIGH):
        return min(base, 2)

    # Metric-based escalation
    if alert.metric_value is not None and alert.threshold is not None and alert.threshold > 0:
        ratio = alert.metric_value / alert.threshold
        if ratio >= 1.5 and base > 1:
            return base - 1

    return base


def build_alert_record(
    alert: AlertIngest,
    fingerprint: str,
    category: AlertCategory,
    team: Team,
    priority: int,
    status: AlertStatus = AlertStatus.ASSIGNED,
) -> AlertRecord:
    now = datetime.now(UTC)
    return AlertRecord(
        id=uuid4(),
        fingerprint=fingerprint,
        source=alert.source,
        alert_type=alert.alert_type,
        title=alert.title,
        description=alert.description,
        severity=alert.severity,
        priority=priority,
        service=alert.service,
        environment=alert.environment,
        team=team,
        category=category,
        status=status,
        metric_value=alert.metric_value,
        threshold=alert.threshold,
        hostname=alert.hostname,
        namespace=alert.namespace,
        pod_name=alert.pod_name,
        region=alert.region,
        tags=alert.tags,
        metadata=alert.metadata,
        received_at=alert.timestamp or now,
        updated_at=now,
    )


class AlertPipeline:
    """Orchestrates validation → dedup → priority → team assignment."""

    def __init__(self, dedup_store: "DedupStore") -> None:
        self._dedup = dedup_store

    async def process(
        self,
        alert: AlertIngest,
        *,
        store: "AlertStore | None" = None,
    ) -> tuple[AlertIngestResponse, AlertRecord | None]:
        errors = validate_alert(alert)
        if errors:
            return (
                AlertIngestResponse(
                    accepted=False,
                    status=AlertStatus.REJECTED,
                    message="; ".join(errors),
                ),
                None,
            )

        fingerprint = compute_fingerprint(alert)
        existing_id = await self._dedup.get(fingerprint)

        # Re-open resolved/rejected/duplicate tickets as new alerts
        if existing_id and store is not None:
            try:
                existing = await store.get(UUID(existing_id))
            except ValueError:
                existing = None
            if existing and existing.status in CLOSED_STATUSES:
                await self._dedup.clear(fingerprint)
                existing_id = None

        if existing_id:
            return (
                AlertIngestResponse(
                    accepted=False,
                    status=AlertStatus.DUPLICATE,
                    message="Duplicate alert suppressed (still open)",
                    duplicate_of=UUID(existing_id),
                ),
                None,
            )

        category, team = classify_alert(alert)
        priority = assign_priority(alert, category)
        record = build_alert_record(alert, fingerprint, category, team, priority)
        await self._dedup.set(fingerprint, str(record.id))

        return (
            AlertIngestResponse(
                accepted=True,
                alert_id=record.id,
                status=AlertStatus.ASSIGNED,
                message=f"Alert assigned to {team.value} team with priority P{priority}",
            ),
            record,
        )


class DedupStore:
    """In-memory dedup with TTL; swap for Redis in production."""

    def __init__(self, ttl_seconds: int = 3600) -> None:
        self._ttl = ttl_seconds
        self._cache: dict[str, tuple[str, float]] = {}

    async def get(self, fingerprint: str) -> str | None:
        import time

        entry = self._cache.get(fingerprint)
        if not entry:
            return None
        alert_id, expires = entry
        if time.time() > expires:
            del self._cache[fingerprint]
            return None
        return alert_id

    async def set(self, fingerprint: str, alert_id: str) -> None:
        import time

        self._cache[fingerprint] = (alert_id, time.time() + self._ttl)

    async def clear(self, fingerprint: str) -> None:
        self._cache.pop(fingerprint, None)

    async def clear_all(self) -> None:
        self._cache.clear()
