from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status

from app.api.security import verify_api_key
from app.models.schemas import (
    AlertIngest,
    AlertIngestResponse,
    AlertListResponse,
    AlertRecord,
    AlertStatus,
    HumanReviewRequest,
    PipelineStats,
)
from app.services.alert_pipeline import AlertPipeline
from app.services.alert_store import AlertStore
from app.services.investigation_agent import InvestigationAgent
from app.services.review_actions import apply_human_review
from app.services.routing_agent import RoutingAgent

router = APIRouter(prefix="/alerts", tags=["alerts"])


def get_store() -> AlertStore:
    from app.main import alert_store

    return alert_store


def get_pipeline() -> AlertPipeline:
    from app.main import alert_pipeline

    return alert_pipeline


def get_agent() -> InvestigationAgent:
    from app.main import investigation_agent

    return investigation_agent


def get_routing_agent() -> RoutingAgent:
    from app.main import routing_agent

    return routing_agent


async def _run_investigation(alert_id: UUID) -> None:
    store = get_store()
    agent = get_agent()
    router = get_routing_agent()
    alert = await store.get(alert_id)
    if not alert:
        return

    alert.status = AlertStatus.INVESTIGATING
    alert.updated_at = datetime.now(UTC)
    await store.update(alert)

    investigation = await agent.investigate(alert)
    alert.investigation = investigation
    now = datetime.now(UTC)

    status, auto_review, reason = await router.route(alert, investigation)
    alert.status = status
    if auto_review:
        alert.human_review = auto_review

    alert.metadata = {**alert.metadata, "routing_reason": reason}
    alert.updated_at = now
    await store.update(alert)


@router.post("/ingest", response_model=AlertIngestResponse, status_code=status.HTTP_202_ACCEPTED)
async def ingest_alert(
    payload: AlertIngest,
    background_tasks: BackgroundTasks,
    _: str = Depends(verify_api_key),
    pipeline: AlertPipeline = Depends(get_pipeline),
    store: AlertStore = Depends(get_store),
) -> AlertIngestResponse:
    """Receive alert, validate, deduplicate, prioritize, assign team, and queue investigation."""
    response, record = await pipeline.process(payload, store=store)
    if not response.accepted or record is None:
        return response

    await store.save(record)
    background_tasks.add_task(_run_investigation, record.id)
    return response


@router.get("", response_model=AlertListResponse)
async def list_alerts(
    status_filter: AlertStatus | None = Query(None, alias="status"),
    team: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    include_duplicates: bool = Query(False),
    store: AlertStore = Depends(get_store),
) -> AlertListResponse:
    exclude = None if include_duplicates else {AlertStatus.DUPLICATE}
    items, total = await store.list_alerts(
        status=status_filter, team=team, limit=limit, offset=offset, exclude_statuses=exclude
    )
    return AlertListResponse(total=total, items=items)


@router.get("/stats", response_model=PipelineStats)
async def get_stats(store: AlertStore = Depends(get_store)) -> PipelineStats:
    return await store.stats()


@router.get("/events")
async def get_events(
    since: int = Query(0, ge=0),
    store: AlertStore = Depends(get_store),
) -> dict:
    events = await store.get_events(since_index=since)
    return {"events": events, "next_index": since + len(events)}


@router.get("/{alert_id}", response_model=AlertRecord)
async def get_alert(alert_id: UUID, store: AlertStore = Depends(get_store)) -> AlertRecord:
    alert = await store.get(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@router.post("/{alert_id}/human-review", response_model=AlertRecord)
async def submit_human_review(
    alert_id: UUID,
    payload: HumanReviewRequest,
    store: AlertStore = Depends(get_store),
) -> AlertRecord:
    """Human-in-the-loop: approve, reject, or escalate after LLM investigation."""
    record, err = await apply_human_review(store, alert_id, payload)
    if record is None:
        if err and "not found" in err.lower():
            raise HTTPException(status_code=404, detail=err)
        raise HTTPException(status_code=409 if err and "closed" in err.lower() else 422, detail=err)
    return record


@router.post("/{alert_id}/investigate", response_model=AlertRecord)
async def trigger_investigation(
    alert_id: UUID,
    background_tasks: BackgroundTasks,
    _: str = Depends(verify_api_key),
    store: AlertStore = Depends(get_store),
) -> AlertRecord:
    alert = await store.get(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    background_tasks.add_task(_run_investigation, alert_id)
    alert.status = AlertStatus.INVESTIGATING
    alert.updated_at = datetime.now(UTC)
    await store.update(alert)
    return alert
