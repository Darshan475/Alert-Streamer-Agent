"""Shared alert review actions for API and chat agent."""

from datetime import UTC, datetime
from uuid import UUID

from app.models.schemas import (
    AlertRecord,
    AlertStatus,
    HumanReview,
    HumanReviewDecision,
    HumanReviewRequest,
    Team,
)
from app.services.alert_store import AlertStore


async def apply_human_review(
    store: AlertStore,
    alert_id: UUID,
    payload: HumanReviewRequest,
) -> tuple[AlertRecord | None, str | None]:
    """Apply human review to one alert. Returns (record, error)."""
    alert = await store.get(alert_id)
    if not alert:
        return None, "Alert not found"

    if alert.status in (AlertStatus.RESOLVED, AlertStatus.REJECTED):
        return None, f"Alert {alert_id} already closed"

    if alert.status not in (
        AlertStatus.PENDING_REVIEW,
        AlertStatus.INVESTIGATING,
        AlertStatus.ESCALATED,
    ):
        return None, f"Cannot review alert in status '{alert.status.value}'"

    if payload.decision in (HumanReviewDecision.APPROVE, HumanReviewDecision.ESCALATE):
        if not payload.assigned_to.strip():
            return None, "assigned_to is required for approve/escalate"

    assign_team = payload.assigned_team or alert.team
    now = datetime.now(UTC)
    review = HumanReview(
        decision=payload.decision,
        reviewer=payload.reviewer,
        feedback=payload.feedback,
        reviewed_at=now,
        override_recommendations=payload.override_recommendations,
        assigned_team=assign_team,
        assigned_to=payload.assigned_to.strip(),
    )
    alert.human_review = review
    alert.team = assign_team
    alert.updated_at = now

    if payload.decision == HumanReviewDecision.APPROVE:
        alert.status = AlertStatus.RESOLVED
        if payload.override_recommendations and alert.investigation:
            alert.investigation.recommendations = payload.override_recommendations
    elif payload.decision == HumanReviewDecision.REJECT:
        alert.status = AlertStatus.REJECTED
    elif payload.decision == HumanReviewDecision.ESCALATE:
        alert.status = AlertStatus.ESCALATED
        alert.priority = max(1, alert.priority - 1)

    await store.update(alert)
    return alert, None


async def batch_approve_alerts(
    store: AlertStore,
    alert_ids: list[UUID],
    *,
    reviewer: str = "chat-agent",
    assigned_to: str = "on-call-engineer",
    assigned_team: Team | None = None,
    feedback: str = "Batch approved via AI chat agent",
) -> dict:
    approved: list[str] = []
    failed: list[dict] = []

    for aid in alert_ids:
        payload = HumanReviewRequest(
            decision=HumanReviewDecision.APPROVE,
            reviewer=reviewer,
            feedback=feedback,
            assigned_team=assigned_team,
            assigned_to=assigned_to,
        )
        record, err = await apply_human_review(store, aid, payload)
        if record:
            approved.append(str(aid))
        else:
            failed.append({"id": str(aid), "error": err or "unknown"})

    return {"approved": approved, "failed": failed, "count": len(approved)}


def group_alerts_by_service(alerts: list[AlertRecord]) -> list[dict]:
    groups: dict[str, list[AlertRecord]] = {}
    for alert in alerts:
        key = f"{alert.service}/{alert.environment}"
        groups.setdefault(key, []).append(alert)

    return [
        {
            "group_key": key,
            "service": alerts_in_group[0].service,
            "environment": alerts_in_group[0].environment,
            "count": len(alerts_in_group),
            "alert_ids": [str(a.id) for a in alerts_in_group],
            "titles": [a.title for a in alerts_in_group],
            "priorities": [a.priority for a in alerts_in_group],
            "statuses": [a.status.value for a in alerts_in_group],
        }
        for key, alerts_in_group in groups.items()
    ]
