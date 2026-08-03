"""LangGraph-based investigation agent for alert triage."""

import json
import logging
from datetime import UTC, datetime
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from app.models.schemas import AlertRecord, InvestigationResult
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)

INVESTIGATION_SYSTEM = """You are an expert SRE incident investigator for the Alert Streamer platform.
Analyze the alert and respond ONLY with valid JSON (no markdown fences):
{
  "root_cause": "concise root cause hypothesis",
  "impact_assessment": "business and technical impact",
  "recommendations": ["action 1", "action 2", "action 3"],
  "urgency_score": 1-10,
  "estimated_resolution_minutes": number or null,
  "related_runbooks": ["runbook/path"]
}
Be specific to the alert type, service, and metrics provided."""


class InvestigationState(TypedDict):
    alert: dict
    analysis: str
    result: dict | None
    error: str | None


class InvestigationAgent:
    """Fast linear LangGraph: gather context → LLM analyze → parse result."""

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm
        self._graph = self._build_graph()

    def _build_graph(self):
        graph = StateGraph(InvestigationState)
        graph.add_node("analyze", self._analyze_node)
        graph.add_node("parse", self._parse_node)
        graph.add_edge(START, "analyze")
        graph.add_edge("analyze", "parse")
        graph.add_edge("parse", END)
        return graph.compile()

    async def _analyze_node(self, state: InvestigationState) -> InvestigationState:
        alert = state["alert"]
        user_prompt = self._format_alert_prompt(alert)
        try:
            raw = await self._llm.chat(
                [
                    {"role": "system", "content": INVESTIGATION_SYSTEM},
                    {"role": "user", "content": user_prompt},
                ],
                json_mode=True,
            )
            return {**state, "analysis": raw, "error": None}
        except Exception as exc:
            logger.exception("LLM investigation failed")
            return {**state, "analysis": "", "error": str(exc)}

    async def _parse_node(self, state: InvestigationState) -> InvestigationState:
        if state.get("error"):
            fallback = {
                "root_cause": f"Investigation error: {state['error']}",
                "impact_assessment": "Manual triage required",
                "recommendations": ["Review alert manually", "Check service health dashboards"],
                "urgency_score": 5,
                "estimated_resolution_minutes": None,
                "related_runbooks": [],
            }
            return {**state, "result": fallback}

        try:
            parsed = json.loads(state["analysis"])
        except json.JSONDecodeError:
            # Try extracting JSON from mixed output
            text = state["analysis"]
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                parsed = json.loads(text[start:end])
            else:
                parsed = {
                    "root_cause": state["analysis"][:500],
                    "impact_assessment": "See analysis",
                    "recommendations": ["Follow standard incident response"],
                    "urgency_score": 5,
                    "estimated_resolution_minutes": None,
                    "related_runbooks": [],
                }

        return {**state, "result": parsed}

    async def investigate(self, alert: AlertRecord) -> InvestigationResult:
        initial: InvestigationState = {
            "alert": alert.model_dump(mode="json"),
            "analysis": "",
            "result": None,
            "error": None,
        }
        final = await self._graph.ainvoke(initial)
        data = final["result"] or {}
        return InvestigationResult(
            root_cause=data.get("root_cause", "Unknown"),
            impact_assessment=data.get("impact_assessment", "Unknown"),
            recommendations=data.get("recommendations", []),
            urgency_score=min(10, max(1, int(data.get("urgency_score", 5)))),
            estimated_resolution_minutes=data.get("estimated_resolution_minutes"),
            related_runbooks=data.get("related_runbooks", []),
            investigated_at=datetime.now(UTC),
        )

    @staticmethod
    def _format_alert_prompt(alert: dict) -> str:
        return f"""Investigate this production alert:

Title: {alert.get('title')}
Type: {alert.get('alert_type')}
Category: {alert.get('category')}
Severity: {alert.get('severity')}
Priority: P{alert.get('priority')}
Service: {alert.get('service')}
Environment: {alert.get('environment')}
Team: {alert.get('team')}
Description: {alert.get('description')}
Metric: {alert.get('metric_value')} (threshold: {alert.get('threshold')})
Host: {alert.get('hostname')}
Namespace: {alert.get('namespace')}
Pod: {alert.get('pod_name')}
Region: {alert.get('region')}
Tags: {', '.join(alert.get('tags') or [])}
Metadata: {json.dumps(alert.get('metadata') or {})}
"""
