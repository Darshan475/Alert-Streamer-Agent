"""Ingest agent — normalize raw monitoring alerts into standard AlertIngest schema."""

import json
import logging
from datetime import UTC, datetime
from typing import Any

from app.models.schemas import AlertIngest, AlertSeverity
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)

NORMALIZE_SYSTEM = """You are the Alert Streamer INGEST agent (step 1).
Collect alerts from monitoring tools and standardize them into one schema.

Raw payloads may use varying field names, for example:
- alert-id, alert_id, uuid, id
- message, description, summary, text
- metric, alert_type, type, rule
- value, metric_value, current_value
- threshold, limit
- service, resource, entity

Respond ONLY with valid JSON (no markdown):
{
  "source": "cloudwatch|datadog|prometheus|grafana|pagerduty|other",
  "alert_type": "snake_case_type",
  "title": "concise alert title",
  "description": "operational description",
  "severity": "critical|high|medium|low|info",
  "service": "service name",
  "environment": "production|staging",
  "metric_value": number or null,
  "threshold": number or null,
  "hostname": null,
  "namespace": null,
  "pod_name": null,
  "region": null,
  "tags": ["tag1"],
  "metadata": {
    "external_id": "original alert-id if present",
    "raw_metric": "original metric name if present"
  }
}

Rules:
- Preserve external alert id in metadata.external_id (from alert-id/uuid/id).
- Map value/threshold into metric_value/threshold.
- Infer severity: value >> threshold = critical/high, moderate = medium, minor = low.
- Derive alert_type from metric/message (e.g. error-rate -> high_error_rate).
- Always set title and description from message when available."""


class IngestAgent:
    """Agent-driven normalization of raw monitoring tool payloads."""

    RETRIES = 3

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def normalize(self, raw: dict[str, Any]) -> tuple[AlertIngest, dict]:
        """Return normalized AlertIngest and ingest stage log entry."""
        last_error: Exception | None = None
        raw_json = json.dumps(raw, default=str)

        for attempt in range(self.RETRIES):
            try:
                raw_response = await self._llm.chat(
                    [
                        {"role": "system", "content": NORMALIZE_SYSTEM},
                        {
                            "role": "user",
                            "content": f"Normalize this raw monitoring alert:\n\n{raw_json}",
                        },
                    ],
                    json_mode=True,
                    temperature=0.2,
                    max_tokens=800,
                )
                data = self._parse_json(raw_response)
                alert = self._to_ingest(data, raw)
                stage = {
                    "stage": "ingest",
                    "reasoning": f"Normalized {alert.source} alert for {alert.service}/{alert.alert_type}",
                    "external_id": alert.metadata.get("external_id"),
                }
                return alert, stage
            except Exception as exc:
                last_error = exc
                logger.warning("Ingest agent attempt %d failed: %s", attempt + 1, exc)

        raise RuntimeError(
            "Ingest agent could not normalize alert — check LLM configuration."
        ) from last_error

    @staticmethod
    def _parse_json(raw: str) -> dict[str, Any]:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            start, end = raw.find("{"), raw.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(raw[start:end])
            raise

    def _to_ingest(self, data: dict[str, Any], raw: dict[str, Any]) -> AlertIngest:
        external_id = (
            (data.get("metadata") or {}).get("external_id")
            or raw.get("alert-id")
            or raw.get("alert_id")
            or raw.get("uuid")
            or raw.get("id")
        )
        metric_value = data.get("metric_value")
        threshold = data.get("threshold")
        if metric_value is None and isinstance(raw.get("value"), (int, float)):
            metric_value = raw["value"]
        if threshold is None and isinstance(raw.get("threshold"), (int, float)):
            threshold = raw["threshold"]

        title = data.get("title") or raw.get("message") or raw.get("summary") or "Monitoring alert"
        description = data.get("description") or title
        alert_type = data.get("alert_type") or self._slug(raw.get("metric") or raw.get("type") or "incident")
        source = data.get("source") or self._infer_source(raw)
        severity = data.get("severity") or self._infer_severity(metric_value, threshold)

        metadata = {
            **(data.get("metadata") or {}),
            "external_id": external_id,
            "raw_payload": raw,
            "normalized_by": "ingest_agent",
            "normalized_at": datetime.now(UTC).isoformat(),
        }

        return AlertIngest(
            source=str(source).lower()[:128],
            alert_type=self._slug(alert_type)[:128],
            title=str(title)[:512],
            description=str(description)[:4096],
            severity=AlertSeverity(str(severity).lower()),
            service=str(data.get("service") or raw.get("service") or "unknown")[:128],
            environment=str(data.get("environment") or "production")[:64],
            metric_value=float(metric_value) if metric_value is not None else None,
            threshold=float(threshold) if threshold is not None else None,
            hostname=data.get("hostname"),
            namespace=data.get("namespace"),
            pod_name=data.get("pod_name"),
            region=data.get("region"),
            tags=data.get("tags") or [],
            metadata=metadata,
            timestamp=datetime.now(UTC),
        )

    @staticmethod
    def _slug(value: str) -> str:
        return str(value).lower().replace(" ", "_").replace("-", "_")

    @staticmethod
    def _infer_source(raw: dict[str, Any]) -> str:
        for key in ("source", "origin", "monitor", "tool"):
            if raw.get(key):
                return str(raw[key]).lower()
        return "monitoring"

    @staticmethod
    def _infer_severity(metric_value: float | None, threshold: float | None) -> str:
        if metric_value is None or threshold is None or threshold == 0:
            return "medium"
        ratio = metric_value / threshold
        if ratio >= 3:
            return "critical"
        if ratio >= 1.5:
            return "high"
        if ratio >= 1:
            return "medium"
        return "low"
