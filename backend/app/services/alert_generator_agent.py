"""LangGraph agent that generates realistic monitoring alerts — no JSON files."""

import json
import logging
import random
from datetime import UTC, datetime
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from app.models.schemas import AlertIngest, AlertSeverity
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)

SERVICES = [
    "api-gateway",
    "payment-service",
    "user-auth",
    "order-processor",
    "notification-hub",
    "analytics-pipeline",
]
REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1"]

GENERATOR_SYSTEM = """You are an SRE simulation agent that generates realistic production monitoring alerts.
Respond ONLY with valid JSON (no markdown):
{
  "source": "prometheus|datadog|grafana|cloudwatch|pagerduty",
  "alert_type": "snake_case_type",
  "title": "concise alert title",
  "description": "2-3 sentence operational description with specifics",
  "severity": "critical|high|medium|low|info",
  "service": "service name",
  "environment": "production|staging",
  "metric_value": number or null,
  "threshold": number or null,
  "hostname": "host.example.internal or null",
  "namespace": "k8s namespace or null",
  "pod_name": "pod-name-abc123 or null",
  "region": "aws region",
  "tags": ["tag1", "tag2"],
  "metadata": {"runbook_url": "https://wiki.internal/runbooks/...", "dashboard_url": "..."}
}
Vary alert types: cpu, memory, disk, pod crash, db timeout, api latency, ssl expiry, k8s node, error rate, payment failures.
Make each alert unique and production-realistic."""


class GeneratorState(TypedDict):
    hint: str
    recent: str
    raw: str
    result: dict | None


class AlertGeneratorAgent:
    """Agent-driven alert generation for auto-trigger streaming."""

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
        user = state["hint"] or "Generate a new unique production incident alert."
        if state["recent"]:
            user += f"\n\nAvoid duplicating these recent titles:\n{state['recent']}"
        raw = await self._llm.chat(
            [
                {"role": "system", "content": GENERATOR_SYSTEM},
                {"role": "user", "content": user},
            ],
            json_mode=True,
            temperature=0.85,
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
        last_data: dict = {}
        for attempt in range(2):
            initial: GeneratorState = {
                "hint": hint or ("Generate a unique production incident alert." if attempt else ""),
                "recent": "\n".join(f"- {t}" for t in (recent_titles or [])[-8:]),
                "raw": "",
                "result": None,
            }
            final = await self._graph.ainvoke(initial)
            data = final.get("result") or {}
            last_data = data
            title = data.get("title")
            if title and title not in (recent_titles or []):
                return self._to_ingest(data)
        if last_data.get("title"):
            return self._to_ingest(last_data)
        raise RuntimeError("Alert generator agent could not produce a valid alert — check LLM API key.")

    def _to_ingest(self, data: dict) -> AlertIngest:
        if not data.get("title"):
            raise ValueError("Agent did not produce a valid alert title")
        return AlertIngest(
            source=data.get("source", "prometheus"),
            alert_type=data.get("alert_type", "incident"),
            title=data["title"],
            description=data.get("description", data["title"]),
            severity=AlertSeverity(data.get("severity", "medium")),
            service=data.get("service", random.choice(SERVICES)),
            environment=data.get("environment", "production"),
            metric_value=data.get("metric_value"),
            threshold=data.get("threshold"),
            hostname=data.get("hostname"),
            namespace=data.get("namespace"),
            pod_name=data.get("pod_name"),
            region=data.get("region", random.choice(REGIONS)),
            tags=data.get("tags") or ["agent-generated"],
            metadata={**(data.get("metadata") or {}), "generated_by": "alert_generator_agent"},
            timestamp=datetime.now(UTC),
        )
