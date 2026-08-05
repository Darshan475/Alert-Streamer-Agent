from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status

from app.api.security import verify_api_key
from app.models.schemas import (
    AlertIngest,
    AlertIngestResponse,
    AlertListResponse,
    AlertRecord,
    AlertStatus,
    PipelineStats,
    RawAlertStreamResponse,
)
from app.models.schemas import StreamSnapshot
from app.services.alert_pipeline import AlertPipeline
from app.services.alert_store import AlertStore
from app.services.data_masking import mask_record
from app.services.llm_client import LLMError
from app.services.stream_hub import StreamHub, stream_hub

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
    """Receive standardized alert and run validate → deduplicate → prioritize."""
    response, record = await pipeline.process(payload, store=store)
    if not response.accepted or record is None:
        return response

    await store.save(record)
    return response


@router.post("/stream", response_model=RawAlertStreamResponse, status_code=status.HTTP_202_ACCEPTED)
async def ingest_raw_alert(
    payload: dict,
    _: str = Depends(verify_api_key),
    pipeline: AlertPipeline = Depends(get_pipeline),
    store: AlertStore = Depends(get_store),
) -> RawAlertStreamResponse:
    """Ingest agent normalizes raw monitoring payload, then runs the pipeline."""
    try:
        response, record, normalized = await pipeline.process_raw(payload, store=store)
        if normalized is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Ingest agent could not normalize alert",
            )
        if response.accepted and record is not None:
            await store.save(record)
        return RawAlertStreamResponse(normalized=normalized, ingest=response)
    except LLMError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


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
    return AlertListResponse(total=total, items=[mask_record(a) for a in items])


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


@router.delete("/clear")
async def clear_alerts(
    _: str = Depends(verify_api_key),
    store: AlertStore = Depends(get_store),
) -> dict:
    """Clear all stored alerts and broadcast empty snapshot."""
    await store.clear()
    raw = await StreamHub.build_snapshot(store)
    snapshot = StreamSnapshot.model_validate(raw)
    await stream_hub.broadcast(store)
    return {"cleared": True, "snapshot": snapshot.model_dump(mode="json")}


@router.websocket("/ws")
async def alert_stream(websocket: WebSocket) -> None:
    """Real-time alert stream — pushes snapshots on connect and after each change."""
    store = get_store()
    await stream_hub.connect(websocket, store)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await stream_hub.disconnect(websocket)


@router.get("/{alert_id}", response_model=AlertRecord)
async def get_alert(alert_id: UUID, store: AlertStore = Depends(get_store)) -> AlertRecord:
    alert = await store.get(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return mask_record(alert)


