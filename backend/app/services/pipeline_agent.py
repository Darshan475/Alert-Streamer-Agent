"""LangGraph pipeline agent — Ingest → Validate → Deduplicate → Prioritize."""

import json
import logging
from dataclasses import dataclass, field
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from app.models.schemas import AlertCategory, AlertIngest, Team
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)

PIPELINE_SYSTEM = """You are the Alert Streamer pipeline agent. Process ONE stage at a time.
Respond ONLY with valid JSON (no markdown fences).

Stage "validate": check payload quality and completeness.
{"stage":"validate","valid":true|false,"enriched_fields":{},"reject_reason":"","reasoning":""}

Stage "deduplicate": compare against open alerts — semantic duplicate if same incident.
{"stage":"deduplicate","is_duplicate":true|false,"duplicate_of_id":null|"uuid","reasoning":""}

Stage "prioritize": assign P1-P5 priority, category, and owning team from severity and impact.
{"stage":"prioritize","priority":1-5,"category":"cpu|memory|disk|pod|database|api|ssl|kubernetes|error_rate|payment|other","team":"platform|sre|database|security|payments|frontend|backend","reasoning":""}

Be decisive. P1/P2 for critical production incidents. Payment/k8s critical = P1-P2."""


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

    STAGE_RETRIES = 3

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

    async def _call_stage(self, stage: str, alert: dict, extra: str = "") -> dict:
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
                    temperature=0.15,
                )
                parsed = json.loads(raw)
                if parsed.get("stage") == stage:
                    return parsed
                start, end = raw.find("{"), raw.rfind("}") + 1
                if start >= 0 and end > start:
                    parsed = json.loads(raw[start:end])
                    if parsed.get("stage") == stage:
                        return parsed
                raise ValueError(f"Stage {stage} returned unexpected payload")
            except Exception as exc:
                last_error = exc
                logger.warning("Pipeline stage %s attempt %d failed: %s", stage, attempt + 1, exc)

        raise RuntimeError(f"Pipeline stage {stage} failed after {self.STAGE_RETRIES} attempts") from last_error

    async def _validate_node(self, state: PipelineState) -> PipelineState:
        alert = state["alert"]
        log = list(state.get("stage_log") or [])
        result = await self._call_stage("validate", alert)
        valid = bool(result.get("valid", True))
        enriched = result.get("enriched_fields") or {}
        log.append({"stage": "validate", **result})
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
        result = await self._call_stage("deduplicate", alert, extra)
        is_dup = bool(result.get("is_duplicate"))
        dup_id = result.get("duplicate_of_id")
        log.append({"stage": "deduplicate", **result})
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
        log.append({"stage": "prioritize", **result})
        return {
            **state,
            "priority": priority,
            "category": category,
            "team": team,
            "stage_log": log,
        }

    @staticmethod
    def _parse_category(value: str) -> AlertCategory:
        return AlertCategory(value.lower())

    @staticmethod
    def _parse_team(value: str) -> Team:
        return Team(value.lower())

    async def run(self, alert: AlertIngest, open_alerts: list[dict] | None = None) -> PipelineAgentResult:
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
