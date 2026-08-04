"""Agent-based routing — auto-resolves all alerts (no HITL)."""

import logging
from datetime import UTC, datetime

from app.models.schemas import AlertRecord, AlertStatus, HumanReview, HumanReviewDecision, InvestigationResult

logger = logging.getLogger(__name__)


class RoutingAgent:
    """Legacy routing agent — always auto-resolves (HITL removed)."""

    def __init__(self, _llm=None) -> None:
        pass

    async def route(
        self,
        alert: AlertRecord,
        investigation: InvestigationResult,
    ) -> tuple[AlertStatus, HumanReview | None, str]:
        reason = f"P{alert.priority} alert auto-processed after pipeline prioritization"
        now = datetime.now(UTC)
        review = HumanReview(
            decision=HumanReviewDecision.APPROVE,
            reviewer="routing-agent",
            feedback=f"Auto-resolved by agent: {reason}",
            reviewed_at=now,
        )
        return AlertStatus.RESOLVED, review, reason
