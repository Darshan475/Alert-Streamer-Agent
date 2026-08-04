"""Alert pipeline — validate → dedup → prioritize (no HITL)."""

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
    AlertStatus,
    Team,
)

CLOSED_STATUSES = frozenset(
    {AlertStatus.RESOLVED, AlertStatus.REJECTED, AlertStatus.DUPLICATE}
)

if TYPE_CHECKING:
    from app.services.alert_store import AlertStore
    from app.services.ingest_agent import IngestAgent
    from app.services.pipeline_agent import PipelineAgent


def compute_fingerprint(alert: AlertIngest) -> str:
    key = {
        "source": alert.source,
        "alert_type": alert.alert_type.lower(),
        "service": alert.service.lower(),
        "environment": alert.environment.lower(),
        "hostname": (alert.hostname or "").lower(),
        "namespace": (alert.namespace or "").lower(),
        "pod_name": (alert.pod_name or "").lower(),
    }
    return hashlib.sha256(json.dumps(key, sort_keys=True).encode()).hexdigest()


def build_alert_record(
    alert: AlertIngest,
    fingerprint: str,
    category: AlertCategory,
    team: Team,
    priority: int,
    *,
    stage_log: list | None = None,
    extra_metadata: dict | None = None,
    status: AlertStatus = AlertStatus.PRIORITIZED,
) -> AlertRecord:
    now = datetime.now(UTC)
    metadata = {**(alert.metadata or {}), **(extra_metadata or {})}
    if stage_log:
        metadata["pipeline_agent_log"] = stage_log
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
        metadata=metadata,
        received_at=alert.timestamp or now,
        updated_at=now,
    )


class AlertPipeline:
    """AI pipeline agent orchestrates validate → dedup → prioritize."""

    def __init__(
        self,
        dedup_store: "DedupStore",
        pipeline_agent: "PipelineAgent | None" = None,
        ingest_agent: "IngestAgent | None" = None,
    ) -> None:
        self._dedup = dedup_store
        self._agent = pipeline_agent
        self._ingest = ingest_agent

    async def process_raw(
        self,
        raw: dict,
        *,
        store: "AlertStore | None" = None,
    ) -> tuple[AlertIngestResponse, AlertRecord | None, AlertIngest | None]:
        """Normalize raw monitoring payload, then run validate → dedup → prioritize."""
        if self._ingest is None:
            return (
                AlertIngestResponse(
                    accepted=False,
                    status=AlertStatus.REJECTED,
                    message="Ingest agent not configured",
                ),
                None,
                None,
            )
        alert, ingest_stage = await self._ingest.normalize(raw)
        response, record = await self.process(alert, store=store, ingest_stage=ingest_stage)
        return response, record, alert

    async def process(
        self,
        alert: AlertIngest,
        *,
        store: "AlertStore | None" = None,
        ingest_stage: dict | None = None,
    ) -> tuple[AlertIngestResponse, AlertRecord | None]:
        try:
            alert = AlertIngest.model_validate(alert.model_dump())
        except Exception as exc:
            return (
                AlertIngestResponse(
                    accepted=False,
                    status=AlertStatus.REJECTED,
                    message=f"Schema validation failed: {exc}",
                ),
                None,
            )

        fingerprint = compute_fingerprint(alert)
        existing_id = await self._dedup.get(fingerprint)

        if existing_id and store is not None:
            try:
                existing = await store.get(UUID(existing_id))
            except ValueError:
                existing = None
            if existing and existing.status in CLOSED_STATUSES:
                await self._dedup.clear(fingerprint)
                existing_id = None

        open_alerts: list[dict] = []
        if store is not None:
            items, _ = await store.list_alerts(limit=20, exclude_statuses={AlertStatus.DUPLICATE})
            open_alerts = [
                {
                    "id": str(a.id),
                    "title": a.title,
                    "service": a.service,
                    "alert_type": a.alert_type,
                    "status": a.status.value,
                    "fingerprint": a.fingerprint,
                }
                for a in items
                if a.status not in CLOSED_STATUSES
            ]

        if self._agent is None:
            return (
                AlertIngestResponse(
                    accepted=False,
                    status=AlertStatus.REJECTED,
                    message="Pipeline agent not configured",
                ),
                None,
            )

        result = await self._agent.run(alert, open_alerts)

        if result.rejected:
            return (
                AlertIngestResponse(
                    accepted=False,
                    status=AlertStatus.REJECTED,
                    message=result.reject_message,
                ),
                None,
            )

        if result.duplicate or existing_id:
            dup = result.duplicate_of_id or existing_id
            return (
                AlertIngestResponse(
                    accepted=False,
                    status=AlertStatus.DUPLICATE,
                    message=result.reject_message or "Duplicate alert suppressed",
                    duplicate_of=UUID(dup) if dup else None,
                ),
                None,
            )

        stage_log = ([ingest_stage] if ingest_stage else []) + result.stage_log
        record = build_alert_record(
            alert,
            fingerprint,
            result.category,
            result.team,
            result.priority,
            stage_log=stage_log,
            extra_metadata=result.enriched_metadata,
        )
        await self._dedup.set(fingerprint, str(record.id))

        stages = " → ".join(s["stage"] for s in stage_log if "stage" in s)
        return (
            AlertIngestResponse(
                accepted=True,
                alert_id=record.id,
                status=AlertStatus.PRIORITIZED,
                message=f"Agent pipeline ({stages}): P{result.priority} — {result.team.value}",
            ),
            record,
        )


class DedupStore:
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
