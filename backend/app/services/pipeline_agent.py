"""LangGraph pipeline agent — validate → deduplicate → prioritize."""

import json
import logging
from dataclasses import dataclass, field
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.models.schemas import AlertCategory, AlertIngest, Team
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)

PIPELINE_SYSTEM = """You are the Alert Streamer pipeline agent. Process ONE stage at a time.
Respond ONLY with valid JSON (no markdown fences). Always include the "stage" field.

Stage "validate": check payload quality and completeness. PSS BWS Datadog alerts with title, service, severity are valid.
{"stage":"validate","valid":true,"enriched_fields":{},"reject_reason":"","reasoning":""}

Stage "deduplicate": compare against open alerts — semantic duplicate if same incident.
{"stage":"deduplicate","is_duplicate":false,"duplicate_of_id":null,"reasoning":""}

Stage "prioritize": assign P1-P5 priority, category, and owning team.
PSS BWS P3 medium alerts = priority 3. API 5xx = category api, team backend.
{"stage":"prioritize","priority":3,"category":"api","team":"backend","reasoning":""}"""


class PipelineState(TypedDict):
    alert: dict
    open_alerts: list[dict]
    stage_log: list[dict]
    valid: bool
    reject_reason: str
    is_duplicate: bool
    duplicate_of_id: str | None
    priority: int
    category: str
    team: str
    enriched: dict
    error: str | None


@dataclass
class PipelineAgentResult:
    accepted: bool
    rejected: bool
    duplicate: bool
    duplicate_of_id: str | None = None
    reject_message: str = ""
    category: AlertCategory = AlertCategory.OTHER
    team: Team = Team.SRE
    priority: int = 3
    stage_log: list[dict] = field(default_factory=list)
    enriched_metadata: dict = field(default_factory=dict)


class PipelineAgent:
    """Orchestrates validate → deduplicate → prioritize via LLM agents."""

    STAGE_RETRIES = 2

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm
        self._graph = self._build_graph()

    def _build_graph(self):
        graph = StateGraph(PipelineState)
        graph.add_node("validate", self._validate_node)
        graph.add_node("deduplicate", self._dedup_node)
        graph.add_node("prioritize", self._prioritize_node)
        graph.add_edge(START, "validate")
        graph.add_conditional_edges("validate", self._after_validate, {"continue": "deduplicate", "reject": END})
        graph.add_conditional_edges("deduplicate", self._after_dedup, {"continue": "prioritize", "duplicate": END})
        graph.add_edge("prioritize", END)
        return graph.compile()

    @staticmethod
    def _after_validate(state: PipelineState) -> str:
        return "reject" if not state.get("valid", True) else "continue"

    @staticmethod
    def _after_dedup(state: PipelineState) -> str:
        return "duplicate" if state.get("is_duplicate") else "continue"

    @staticmethod
    def _parse_json(raw: str) -> dict[str, Any]:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            start, end = raw.find("{"), raw.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(raw[start:end])
            raise

    def _coerce_stage_payload(self, parsed: dict[str, Any], stage: str) -> dict[str, Any]:
        if parsed.get("stage") == stage:
            return parsed
        if stage == "validate" and "valid" in parsed:
            return {**parsed, "stage": "validate"}
        if stage == "deduplicate" and "is_duplicate" in parsed:
            return {**parsed, "stage": "deduplicate"}
        if stage == "prioritize" and "priority" in parsed:
            return {**parsed, "stage": "prioritize"}
        raise ValueError(f"Stage {stage} returned unexpected payload")

    def _fallback_validate(self, alert: dict[str, Any]) -> dict[str, Any]:
        required = ("title", "description", "severity", "service", "source", "alert_type")
        missing = [f for f in required if not alert.get(f)]
        valid = len(missing) == 0
        return {
            "stage": "validate",
            "valid": valid,
            "enriched_fields": {},
            "reject_reason": f"Missing fields: {', '.join(missing)}" if missing else "",
            "reasoning": "Local schema validation (LLM fallback)",
        }

    def _fallback_dedup(self, alert: dict[str, Any], open_alerts: list[dict]) -> dict[str, Any]:
        title = str(alert.get("title", "")).strip().lower()
        service = str(alert.get("service", "")).strip().lower()
        for open_alert in open_alerts:
            if (
                str(open_alert.get("title", "")).strip().lower() == title
                and str(open_alert.get("service", "")).strip().lower() == service
            ):
                return {
                    "stage": "deduplicate",
                    "is_duplicate": True,
                    "duplicate_of_id": open_alert.get("id"),
                    "reasoning": "Local dedup — same title and service (LLM fallback)",
                }
        return {
            "stage": "deduplicate",
            "is_duplicate": False,
            "duplicate_of_id": None,
            "reasoning": "Local dedup — no match (LLM fallback)",
        }

    def _fallback_prioritize(self, alert: dict[str, Any]) -> dict[str, Any]:
        severity = str(alert.get("severity", "medium")).lower()
        title = str(alert.get("title", "")).lower()
        alert_type = str(alert.get("alert_type", "")).lower()
        meta = alert.get("metadata") or {}

        priority_map = {"critical": 1, "high": 2, "medium": 3, "low": 4, "info": 5}
        priority = priority_map.get(severity, 3)
        if meta.get("priority_tier") == "P3" or meta.get("priority_label") == "3-Medium":
            priority = 3

        if "5xx" in title or alert_type == "api_5xx":
            category = "api"
        elif "sqs" in title or alert_type == "sqs_volume":
            category = "other"
        else:
            category = "other"

        team = "backend" if "pss" in title or meta.get("platform") else "sre"

        return {
            "stage": "prioritize",
            "priority": priority,
            "category": category,
            "team": team,
            "reasoning": "Local PSS BWS prioritization (LLM fallback)",
        }

    def _fallback_stage(
        self, stage: str, alert: dict[str, Any], open_alerts: list[dict]
    ) -> dict[str, Any]:
        if stage == "validate":
            return self._fallback_validate(alert)
        if stage == "deduplicate":
            return self._fallback_dedup(alert, open_alerts)
        return self._fallback_prioritize(alert)

    async def _call_stage(
        self,
        stage: str,
        alert: dict[str, Any],
        extra: str = "",
        open_alerts: list[dict] | None = None,
    ) -> dict[str, Any]:
        prompt = f'Stage: "{stage}"\n\nAlert payload:\n{json.dumps(alert, default=str)}\n{extra}'
        last_error: Exception | None = None

        for attempt in range(self.STAGE_RETRIES):
            try:
                raw = await self._llm.chat(
                    [
                        {"role": "system", "content": PIPELINE_SYSTEM},
                        {"role": "user", "content": prompt},
                    ],
                    json_mode=True,
                    temperature=0.1,
                    max_tokens=400,
                )
                parsed = self._coerce_stage_payload(self._parse_json(raw), stage)
                return parsed
            except Exception as exc:
                last_error = exc
                logger.warning("Pipeline stage %s attempt %d failed: %s", stage, attempt + 1, exc)

        logger.warning("Pipeline stage %s using local fallback: %s", stage, last_error)
        return self._fallback_stage(stage, alert, open_alerts or [])

    async def _validate_node(self, state: PipelineState) -> PipelineState:
        alert = state["alert"]
        log = list(state.get("stage_log") or [])
        result = await self._call_stage("validate", alert)
        valid = bool(result.get("valid", True))
        enriched = result.get("enriched_fields") or {}
        log.append({"stage": "validate", **{k: v for k, v in result.items() if k != "stage"}})
        return {
            **state,
            "valid": valid,
            "reject_reason": result.get("reject_reason", ""),
            "enriched": enriched,
            "stage_log": log,
            "error": None,
        }

    async def _dedup_node(self, state: PipelineState) -> PipelineState:
        alert = state["alert"]
        open_alerts = state.get("open_alerts") or []
        log = list(state.get("stage_log") or [])
        extra = f"\nOpen alerts in store ({len(open_alerts)}):\n{json.dumps(open_alerts[:12], default=str)}"
        result = await self._call_stage("deduplicate", alert, extra, open_alerts=open_alerts)
        is_dup = bool(result.get("is_duplicate"))
        dup_id = result.get("duplicate_of_id")
        log.append({"stage": "deduplicate", **{k: v for k, v in result.items() if k != "stage"}})
        return {
            **state,
            "is_duplicate": is_dup,
            "duplicate_of_id": str(dup_id) if dup_id else None,
            "stage_log": log,
        }

    async def _prioritize_node(self, state: PipelineState) -> PipelineState:
        alert = state["alert"]
        log = list(state.get("stage_log") or [])
        result = await self._call_stage("prioritize", alert)
        priority = min(5, max(1, int(result.get("priority", 3))))
        category = str(result.get("category", "other"))
        team = str(result.get("team", "sre"))
        log.append({"stage": "prioritize", **{k: v for k, v in result.items() if k != "stage"}})
        return {
            **state,
            "priority": priority,
            "category": category,
            "team": team,
            "stage_log": log,
        }

    @staticmethod
    def _parse_category(value: str) -> AlertCategory:
        try:
            return AlertCategory(value.lower())
        except ValueError:
            return AlertCategory.OTHER

    @staticmethod
    def _parse_team(value: str) -> Team:
        try:
            return Team(value.lower())
        except ValueError:
            return Team.SRE

    async def run(
        self,
        alert: AlertIngest,
        open_alerts: list[dict] | None = None,
        *,
        skip_dedup: bool = False,
    ) -> PipelineAgentResult:
        if skip_dedup:
            return await self._run_generation_path(alert)

        initial: PipelineState = {
            "alert": alert.model_dump(mode="json"),
            "open_alerts": open_alerts or [],
            "stage_log": [],
            "valid": True,
            "reject_reason": "",
            "is_duplicate": False,
            "duplicate_of_id": None,
            "priority": 3,
            "category": "other",
            "team": "sre",
            "enriched": {},
            "error": None,
        }
        final = await self._graph.ainvoke(initial)
        log = final.get("stage_log") or []

        if not final.get("valid", True):
            return PipelineAgentResult(
                accepted=False,
                rejected=True,
                duplicate=False,
                reject_message=final.get("reject_reason") or "Validation agent rejected alert",
                stage_log=log,
            )

        if final.get("is_duplicate"):
            return PipelineAgentResult(
                accepted=False,
                rejected=False,
                duplicate=True,
                duplicate_of_id=final.get("duplicate_of_id"),
                reject_message="Duplicate suppressed by dedup agent",
                stage_log=log,
            )

        category = self._parse_category(final.get("category", "other"))
        team = self._parse_team(final.get("team", "sre"))

        return PipelineAgentResult(
            accepted=True,
            rejected=False,
            duplicate=False,
            category=category,
            team=team,
            priority=final.get("priority", 3),
            stage_log=log,
            enriched_metadata=final.get("enriched") or {},
        )

    async def _run_generation_path(self, alert: AlertIngest) -> PipelineAgentResult:
        """Validate → prioritize only (skip dedup for agent-generated unique alerts)."""
        alert_dict = alert.model_dump(mode="json")
        log: list[dict] = []

        validate = await self._call_stage("validate", alert_dict)
        log.append({"stage": "validate", **{k: v for k, v in validate.items() if k != "stage"}})
        if not validate.get("valid", True):
            return PipelineAgentResult(
                accepted=False,
                rejected=True,
                duplicate=False,
                reject_message=validate.get("reject_reason") or "Validation agent rejected alert",
                stage_log=log,
            )

        log.append(
            {
                "stage": "deduplicate",
                "is_duplicate": False,
                "reasoning": "Dedup skipped — agent-generated unique alert",
            }
        )

        prioritize = await self._call_stage("prioritize", alert_dict)
        log.append({"stage": "prioritize", **{k: v for k, v in prioritize.items() if k != "stage"}})
        priority = min(5, max(1, int(prioritize.get("priority", 3))))

        return PipelineAgentResult(
            accepted=True,
            rejected=False,
            duplicate=False,
            category=self._parse_category(prioritize.get("category", "other")),
            team=self._parse_team(prioritize.get("team", "sre")),
            priority=priority,
            stage_log=log,
            enriched_metadata=validate.get("enriched_fields") or {},
        )
