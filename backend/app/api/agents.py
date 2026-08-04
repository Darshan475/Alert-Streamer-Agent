"""Agent API — generate alerts and auto-stream through the pipeline."""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.alerts import get_pipeline, get_store
from app.api.security import verify_api_key
from app.models.schemas import AlertIngest, AlertIngestResponse
from app.services.alert_generator_agent import AlertGeneratorAgent
from app.services.llm_client import LLMError

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


@router.post("/generate-alert", response_model=GenerateAlertResponse)
async def generate_alert(
    body: GenerateAlertRequest,
    background_tasks: BackgroundTasks,
    _: str = Depends(verify_api_key),
    generator: AlertGeneratorAgent = Depends(get_generator),
    pipeline=Depends(get_pipeline),
    store=Depends(get_store),
) -> GenerateAlertResponse:
    """Agent generates a realistic alert and ingests it through the pipeline."""
    try:
        recent_items, _ = await store.list_alerts(limit=10)
        alert = await generator.generate(
            hint=body.hint,
            recent_titles=[a.title for a in recent_items],
        )
        response, record = await pipeline.process(alert, store=store)
        if response.accepted and record:
            await store.save(record)
        return GenerateAlertResponse(alert=alert, ingest=response)
    except LLMError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


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

    try:
        for _ in range(body.count):
            alert = await generator.generate(hint=body.hint, recent_titles=recent_titles)
            response, record = await pipeline.process(alert, store=store)
            results.append(response)
            if response.accepted and record:
                await store.save(record)
                recent_titles.append(record.title)
    except (LLMError, RuntimeError) as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return AutoStreamResponse(
        generated=sum(1 for r in results if r.accepted),
        results=results,
    )
