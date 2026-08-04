"""LangGraph pipeline agent — Ingest → Validate → Deduplicate → Prioritize (no HITL)."""

import json
import logging
from dataclasses import dataclass, field
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from app.models.schemas import AlertCategory, AlertIngest, AlertSeverity, Team
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)

PIPELINE_SYSTEM = """You are the Alert Streamer pipeline agent. Process ONE stage at a time.
Respond ONLY with valid JSON (no markdown fences).

Stage "validate": check payload quality and completeness.
{"stage":"validate","valid":true|false,"enriched_fields":{},"reject_reason":"","reasoning":""}

Stage "deduplicate": compare against open alerts — semantic duplicate if same incident.
{"stage":"deduplicate","is_duplicate":true|false,"duplicate_of_id":null|"uuid","reasoning":""}

Stage "prioritize": assign P1-P5 from severity, impact, metrics.
{"stage":"prioritize","priority":1-5,"reasoning":""}

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
        raw = await self._llm.chat(
            [
                {"role": "system", "content": PIPELINE_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            json_mode=True,
            temperature=0.15,
        )
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            start, end = raw.find("{"), raw.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(raw[start:end])
            raise

    async def _validate_node(self, state: PipelineState) -> PipelineState:
        alert = state["alert"]
        log = list(state.get("stage_log") or [])
        try:
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
        except Exception as exc:
            logger.warning("Validate agent error: %s", exc)
            log.append({"stage": "validate", "valid": True, "reasoning": "schema pass — agent retry"})
            return {**state, "valid": True, "stage_log": log, "error": str(exc)}

    async def _dedup_node(self, state: PipelineState) -> PipelineState:
        alert = state["alert"]
        open_alerts = state.get("open_alerts") or []
        log = list(state.get("stage_log") or [])
        extra = f"\nOpen alerts in store ({len(open_alerts)}):\n{json.dumps(open_alerts[:12], default=str)}"
        try:
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
        except Exception as exc:
            logger.warning("Dedup agent error: %s", exc)
            log.append({"stage": "deduplicate", "is_duplicate": False, "reasoning": "agent fallback — treat as new"})
            return {**state, "is_duplicate": False, "stage_log": log}

    async def _prioritize_node(self, state: PipelineState) -> PipelineState:
        alert = state["alert"]
        log = list(state.get("stage_log") or [])
        try:
            result = await self._call_stage("prioritize", alert)
            priority = min(5, max(1, int(result.get("priority", 3))))
            log.append({"stage": "prioritize", **result})
            return {**state, "priority": priority, "stage_log": log}
        except Exception as exc:
            logger.warning("Prioritize agent error: %s", exc)
            sev_map = {"critical": 1, "high": 2, "medium": 3, "low": 4, "info": 5}
            priority = sev_map.get(str(alert.get("severity", "medium")), 3)
            log.append({"stage": "prioritize", "priority": priority, "reasoning": "severity mapping fallback"})
            return {**state, "priority": priority, "stage_log": log}

    @staticmethod
    def _infer_category_team(alert: dict) -> tuple[AlertCategory, Team]:
        alert_type = str(alert.get("alert_type", "")).lower()
        service = str(alert.get("service", "")).lower()
        type_map = {
            "cpu": AlertCategory.CPU,
            "memory": AlertCategory.MEMORY,
            "disk": AlertCategory.DISK,
            "pod": AlertCategory.POD,
            "database": AlertCategory.DATABASE,
            "api": AlertCategory.API,
            "ssl": AlertCategory.SSL,
            "kubernetes": AlertCategory.KUBERNETES,
            "k8s": AlertCategory.KUBERNETES,
            "error": AlertCategory.ERROR_RATE,
            "payment": AlertCategory.PAYMENT,
        }
        category = AlertCategory.OTHER
        for key, cat in type_map.items():
            if key in alert_type:
                category = cat
                break

        if "payment" in service or category == AlertCategory.PAYMENT:
            team = Team.PAYMENTS
        elif category == AlertCategory.DATABASE:
            team = Team.DATABASE
        elif category in (AlertCategory.KUBERNETES, AlertCategory.POD):
            team = Team.PLATFORM
        elif "security" in service or "auth" in service:
            team = Team.SECURITY
        elif "frontend" in service or "ui" in service:
            team = Team.FRONTEND
        elif "api" in service or "backend" in service:
            team = Team.BACKEND
        else:
            team = Team.SRE
        return category, team

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

        category, team = self._infer_category_team(final.get("alert") or alert.model_dump(mode="json"))

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
