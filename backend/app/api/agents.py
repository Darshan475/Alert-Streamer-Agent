"""Agent API — generate alerts, auto-stream, batch review."""

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.alerts import _run_investigation, get_pipeline, get_store
from app.api.security import verify_api_key
from app.models.schemas import AlertIngest, AlertIngestResponse, HumanReviewDecision, HumanReviewRequest
from app.services.alert_generator_agent import AlertGeneratorAgent
from app.services.review_actions import apply_human_review, batch_approve_alerts

router = APIRouter(prefix="/agents", tags=["agents"])


def get_generator() -> AlertGeneratorAgent:
    from app.main import alert_generator

    return alert_generator


class GenerateAlertRequest(BaseModel):
    hint: str | None = Field(None, max_length=500)


class GenerateAlertResponse(BaseModel):
    alert: AlertIngest
    ingest: AlertIngestResponse


class AutoStreamRequest(BaseModel):
    count: int = Field(5, ge=1, le=20)
    hint: str | None = None


class AutoStreamResponse(BaseModel):
    generated: int
    results: list[AlertIngestResponse]


class BatchReviewRequest(BaseModel):
    alert_ids: list[UUID] = Field(..., min_length=1, max_length=50)
    decision: HumanReviewDecision = HumanReviewDecision.APPROVE
    reviewer: str = "chat-agent"
    assigned_to: str = "on-call-engineer"
    feedback: str = "Batch review via agent"


@router.post("/generate-alert", response_model=GenerateAlertResponse)
async def generate_alert(
    body: GenerateAlertRequest,
    background_tasks: BackgroundTasks,
    _: str = Depends(verify_api_key),
    generator: AlertGeneratorAgent = Depends(get_generator),
    pipeline=Depends(get_pipeline),
    store=Depends(get_store),
) -> GenerateAlertResponse:
    """Agent generates a realistic alert and ingests it — no JSON files."""
    recent_items, _ = await store.list_alerts(limit=10)
    alert = await generator.generate(
        hint=body.hint,
        recent_titles=[a.title for a in recent_items],
    )
    response, record = await pipeline.process(alert, store=store)
    if response.accepted and record:
        await store.save(record)
    return GenerateAlertResponse(alert=alert, ingest=response)


@router.post("/auto-stream", response_model=AutoStreamResponse)
async def auto_stream(
    body: AutoStreamRequest,
    background_tasks: BackgroundTasks,
    _: str = Depends(verify_api_key),
    generator: AlertGeneratorAgent = Depends(get_generator),
    pipeline=Depends(get_pipeline),
    store=Depends(get_store),
) -> AutoStreamResponse:
    """Agent autonomously generates and ingests multiple alerts."""
    results: list[AlertIngestResponse] = []
    recent_titles: list[str] = []

    for _ in range(body.count):
        alert = await generator.generate(hint=body.hint, recent_titles=recent_titles)
        response, record = await pipeline.process(alert, store=store)
        results.append(response)
        if response.accepted and record:
            await store.save(record)
            recent_titles.append(record.title)

    return AutoStreamResponse(
        generated=sum(1 for r in results if r.accepted),
        results=results,
    )


@router.post("/batch-review")
async def batch_review(
    body: BatchReviewRequest,
    store=Depends(get_store),
) -> dict:
    """Batch approve/reject/escalate alerts — used by chat agent and UI."""
    if body.decision == HumanReviewDecision.APPROVE:
        return await batch_approve_alerts(
            store,
            body.alert_ids,
            reviewer=body.reviewer,
            assigned_to=body.assigned_to,
            feedback=body.feedback,
        )

    results = {"approved": [], "failed": []}
    for aid in body.alert_ids:
        payload = HumanReviewRequest(
            decision=body.decision,
            reviewer=body.reviewer,
            feedback=body.feedback,
            assigned_to=body.assigned_to,
        )
        record, err = await apply_human_review(store, aid, payload)
        if record:
            results["approved"].append(str(aid))
        else:
            results["failed"].append({"id": str(aid), "error": err})

    results["count"] = len(results["approved"])
    return results
