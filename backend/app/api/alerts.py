from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.security import verify_api_key
from app.models.schemas import (
    AlertIngest,
    AlertIngestResponse,
    AlertListResponse,
    AlertRecord,
    AlertStatus,
    PipelineStats,
)
from app.services.alert_pipeline import AlertPipeline
from app.services.alert_store import AlertStore

router = APIRouter(prefix="/alerts", tags=["alerts"])


def get_store() -> AlertStore:
    from app.main import alert_store

    return alert_store


def get_pipeline() -> AlertPipeline:
    from app.main import alert_pipeline

    return alert_pipeline


@router.post("/ingest", response_model=AlertIngestResponse, status_code=status.HTTP_202_ACCEPTED)
async def ingest_alert(
    payload: AlertIngest,
    _: str = Depends(verify_api_key),
    pipeline: AlertPipeline = Depends(get_pipeline),
    store: AlertStore = Depends(get_store),
) -> AlertIngestResponse:
    """Receive alert and run the agent pipeline: validate → deduplicate → prioritize."""
    response, record = await pipeline.process(payload, store=store)
    if not response.accepted or record is None:
        return response

    await store.save(record)
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


