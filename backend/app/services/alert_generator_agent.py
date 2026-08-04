"""LangGraph agent that generates PSS BWS / Datadog-style monitoring alerts."""

import json
import logging
import random
from datetime import UTC, datetime
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from app.models.schemas import AlertIngest, AlertSeverity
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)

GENERATOR_SYSTEM = """You generate PSS BWS production monitoring alerts in Datadog incident-tracker format.
Respond ONLY with valid JSON (no markdown):
{
  "source": "datadog",
  "alert_type": "sqs_volume|api_5xx|latency|error_rate|queue_depth|other",
  "title": "Warn: [P3][PSS BWS]LOW SQS MESSAGE VOLUME DETECTED_propertyupdate",
  "description": "Operational summary with impact and affected service.",
  "severity": "medium",
  "service": "digitalpromosmiscservices-prd",
  "environment": "production",
  "metric_value": 12.5,
  "threshold": 5.0,
  "hostname": null,
  "namespace": "pss-bws",
  "pod_name": null,
  "region": "us-east-1",
  "tags": ["pss-bws", "p3", "datadog", "prod"],
  "metadata": {
    "incident_id": "859405",
    "opened_date": "7/22/2026",
    "priority_label": "3-Medium",
    "priority_tier": "P3",
    "platform": "Pss Bws",
    "monitor": "Datadog",
    "alert_kind": "Warn"
  }
}

Title rules (match enterprise format exactly):
- Warn style: Warn: [P3][PSS BWS]{UPPERCASE_ALERT_NAME}_{property}
  Example: Warn: [P3][PSS BWS]LOW SQS MESSAGE VOLUME DETECTED_propertyupdate
- Triggered style: Triggered: [P3][PSS BWS] {api_path} 5xx error rate- Prod - Tally {service}-prd
  Example: Triggered: [P3][PSS BWS] /whgservices/loyalty/v4/member/promotionregistertoken 5xx error rate- Prod - Tally digitalpromosmiscservices-prd

Always use severity "medium" and priority_label "3-Medium" for P3 alerts.
incident_id must be a unique 6-digit number. opened_date as M/D/YYYY.
Vary alert types: SQS volume, API 5xx, latency spikes, queue depth, auth failures."""


class GeneratorState(TypedDict):
    hint: str
    recent: str
    raw: str
    result: dict | None


class AlertGeneratorAgent:
    """Agent-driven alert generation for auto-trigger streaming."""

    GENERATE_RETRIES = 3

    TEMPLATE_WARN = "Warn: [P3][PSS BWS]LOW SQS MESSAGE VOLUME DETECTED_propertyupdate"
    TEMPLATE_TRIGGERED = (
        "Triggered: [P3][PSS BWS] /whgservices/loyalty/v4/member/promotionregistertoken "
        "5xx error rate- Prod - Tally digitalpromosmiscservices-prd"
    )

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm
        self._graph = self._build_graph()

    def _build_graph(self):
        graph = StateGraph(GeneratorState)
        graph.add_node("generate", self._generate_node)
        graph.add_node("parse", self._parse_node)
        graph.add_edge(START, "generate")
        graph.add_edge("generate", "parse")
        graph.add_edge("parse", END)
        return graph.compile()

    async def _generate_node(self, state: GeneratorState) -> GeneratorState:
        user = state["hint"] or "Generate a new unique PSS BWS P3 Datadog alert."
        if state["recent"]:
            user += f"\n\nAvoid duplicating these recent titles:\n{state['recent']}"
        raw = await self._llm.chat(
            [
                {"role": "system", "content": GENERATOR_SYSTEM},
                {"role": "user", "content": user},
            ],
            json_mode=True,
            temperature=0.7,
            max_tokens=700,
        )
        return {**state, "raw": raw}

    async def _parse_node(self, state: GeneratorState) -> GeneratorState:
        try:
            parsed = json.loads(state["raw"])
        except json.JSONDecodeError:
            text = state["raw"]
            start, end = text.find("{"), text.rfind("}") + 1
            parsed = json.loads(text[start:end]) if start >= 0 and end > start else {}
        return {**state, "result": parsed}

    async def generate(
        self,
        *,
        hint: str | None = None,
        recent_titles: list[str] | None = None,
    ) -> AlertIngest:
        last_error: Exception | None = None
        recent = "\n".join(f"- {t}" for t in (recent_titles or [])[-8:])

        for attempt in range(self.GENERATE_RETRIES):
            try:
                initial: GeneratorState = {
                    "hint": hint or "Generate a unique PSS BWS P3 Datadog incident alert.",
                    "recent": recent,
                    "raw": "",
                    "result": None,
                }
                final = await self._graph.ainvoke(initial)
                data = final.get("result") or {}
                title = data.get("title")
                if not title:
                    raise ValueError("Generator agent returned empty title")
                if title in (recent_titles or []):
                    data = {**data, "title": f"{title} ({datetime.now(UTC).strftime('%H:%M:%S')})"}
                return self._to_ingest(data)
            except Exception as exc:
                last_error = exc
                logger.warning("Alert generator attempt %d failed: %s", attempt + 1, exc)

        logger.warning("LLM generation failed — using PSS BWS template fallback")
        return self._template_fallback(recent_titles)

    def _template_fallback(self, recent_titles: list[str] | None) -> AlertIngest:
        """Deterministic PSS BWS alert when LLM is unavailable."""
        use_warn = random.choice([True, False])
        title = self.TEMPLATE_WARN if use_warn else self.TEMPLATE_TRIGGERED
        if title in (recent_titles or []):
            title = self.TEMPLATE_TRIGGERED if use_warn else self.TEMPLATE_WARN

        now = datetime.now(UTC)
        incident_id = str(random.randint(850000, 899999))
        service = (
            f"digitalpromosmiscservices-{incident_id[-3]}-prd"
            if not use_warn
            else f"propertyupdate-{incident_id[-3]}"
        )

        return AlertIngest(
            source="datadog",
            alert_type="sqs_volume" if use_warn else "api_5xx",
            title=title,
            description=(
                "PSS BWS monitoring alert — low SQS message volume detected on property update queue."
                if use_warn
                else "PSS BWS API 5xx error rate exceeded threshold on loyalty promotion register token endpoint."
            ),
            severity=AlertSeverity.MEDIUM,
            service=service,
            environment="production",
            metric_value=22.0 if not use_warn else 3.0,
            threshold=5.0 if not use_warn else 10.0,
            namespace="pss-bws",
            region="us-east-1",
            tags=["pss-bws", "p3", "datadog", "prod"],
            metadata={
                "incident_id": incident_id,
                "opened_date": f"{now.month}/{now.day}/{now.year}",
                "priority_label": "3-Medium",
                "priority_tier": "P3",
                "platform": "Pss Bws",
                "monitor": "Datadog",
                "alert_kind": "Warn" if use_warn else "Triggered",
                "generated_by": "alert_generator_agent",
                "fallback": True,
            },
            timestamp=now,
        )

    def _to_ingest(self, data: dict) -> AlertIngest:
        title = data.get("title") or ""
        if not title:
            raise ValueError("Generator agent missing title")

        meta = data.get("metadata") or {}
        now = datetime.now(UTC)
        if not meta.get("incident_id"):
            meta["incident_id"] = str(random.randint(850000, 899999))
        if not meta.get("opened_date"):
            meta["opened_date"] = f"{now.month}/{now.day}/{now.year}"
        meta.setdefault("priority_label", "3-Medium")
        meta.setdefault("priority_tier", "P3")
        meta.setdefault("platform", "Pss Bws")
        meta.setdefault("monitor", "Datadog")
        meta.setdefault("generated_by", "alert_generator_agent")
        if title.startswith("Warn:"):
            meta.setdefault("alert_kind", "Warn")
        elif title.startswith("Triggered:"):
            meta.setdefault("alert_kind", "Triggered")

        severity = str(data.get("severity") or "medium").lower()
        service = data.get("service") or "pss-bws"
        alert_type = data.get("alert_type") or ("api_5xx" if "5xx" in title else "sqs_volume")

        return AlertIngest(
            source=str(data.get("source") or "datadog").lower(),
            alert_type=alert_type,
            title=title[:512],
            description=str(data.get("description") or title)[:4096],
            severity=AlertSeverity(severity),
            service=str(service)[:128],
            environment=str(data.get("environment") or "production")[:64],
            metric_value=data.get("metric_value") if data.get("metric_value") is not None else 10.0,
            threshold=data.get("threshold") if data.get("threshold") is not None else 5.0,
            hostname=data.get("hostname"),
            namespace=data.get("namespace") or "pss-bws",
            pod_name=data.get("pod_name"),
            region=data.get("region") or "us-east-1",
            tags=data.get("tags") or ["pss-bws", "p3", "datadog"],
            metadata=meta,
            timestamp=now,
        )
