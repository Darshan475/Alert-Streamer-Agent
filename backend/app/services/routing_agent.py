"""Agent-based routing after investigation — decides human review vs auto-resolve."""

import json
import logging

from app.models.schemas import AlertRecord, AlertStatus, HumanReview, HumanReviewDecision, InvestigationResult
from app.services.alert_pipeline import HUMAN_REVIEW_MAX_PRIORITY
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)

ROUTING_SYSTEM = """You are an incident routing agent. After LLM investigation, decide the next step.
Respond ONLY with valid JSON:
{
  "route": "human_review" | "auto_resolve",
  "reason": "one sentence"
}
Policy: P1 and P2 alerts MUST route to human_review. P3+ may auto_resolve if investigation shows low risk.
Never auto_resolve payment or kubernetes critical incidents without human_review."""


class RoutingAgent:
    """Agent routing replacing hardcoded priority if-else."""

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def route(
        self,
        alert: AlertRecord,
        investigation: InvestigationResult,
    ) -> tuple[AlertStatus, HumanReview | None, str]:
        prompt = (
            f"Alert: {alert.title}\n"
            f"Priority: P{alert.priority} | Severity: {alert.severity.value}\n"
            f"Category: {alert.category.value} | Team: {alert.team.value}\n"
            f"Root cause: {investigation.root_cause}\n"
            f"Impact: {investigation.impact_assessment}\n"
            f"Urgency: {investigation.urgency_score}/10\n"
            f"Recommendations: {'; '.join(investigation.recommendations[:3])}"
        )

        route = "human_review"
        reason = f"P{alert.priority} requires human review per policy"

        if self._llm.is_configured:
            try:
                raw = await self._llm.chat(
                    [
                        {"role": "system", "content": ROUTING_SYSTEM},
                        {"role": "user", "content": prompt},
                    ],
                    json_mode=True,
                    temperature=0.1,
                )
                parsed = json.loads(raw)
                route = parsed.get("route", route)
                reason = parsed.get("reason", reason)
            except Exception as exc:
                logger.warning("Routing agent failed, using policy fallback: %s", exc)

        # Policy guardrails — agent cannot bypass P1/P2 human review
        if alert.priority <= HUMAN_REVIEW_MAX_PRIORITY:
            route = "human_review"
        elif route != "human_review" and alert.priority > HUMAN_REVIEW_MAX_PRIORITY:
            route = "auto_resolve"

        if route == "human_review":
            return AlertStatus.PENDING_REVIEW, None, reason

        from datetime import UTC, datetime

        now = datetime.now(UTC)
        review = HumanReview(
            decision=HumanReviewDecision.APPROVE,
            reviewer="routing-agent",
            feedback=f"Auto-resolved by routing agent: {reason}",
            reviewed_at=now,
        )
        return AlertStatus.RESOLVED, review, reason
