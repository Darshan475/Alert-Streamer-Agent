import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.api import agents, alerts, llm
from app.config import (
    DEFAULT_LLM_PROVIDER,
    DEFAULT_NVIDIA_MODEL,
    DEFAULT_OPENROUTER_MODEL,
    get_settings,
)
from app.services.alert_generator_agent import AlertGeneratorAgent
from app.services.alert_pipeline import AlertPipeline, DedupStore
from app.services.alert_store import AlertStore
from app.services.generator_chat_agent import GeneratorChatAgent
from app.services.ingest_agent import IngestAgent
from app.services.llm_client import LLMClient
from app.services.pipeline_agent import PipelineAgent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent / "static"

settings = get_settings()
llm_client = LLMClient(settings)
_active_provider = settings.llm_provider or DEFAULT_LLM_PROVIDER
llm_client.set_provider(_active_provider)
if _active_provider == "nvidia":
    _startup_model = settings.llm_model or settings.nvidia_model or DEFAULT_NVIDIA_MODEL
elif _active_provider == "openrouter":
    _startup_model = settings.llm_model or DEFAULT_OPENROUTER_MODEL
    if "nemotron" in _startup_model.lower():
        _startup_model = DEFAULT_OPENROUTER_MODEL
else:
    _startup_model = settings.llm_model or settings.model_for(_active_provider)
llm_client.set_model(_startup_model)
alert_store = AlertStore()
dedup_store = DedupStore(ttl_seconds=settings.dedup_ttl_seconds)
pipeline_agent = PipelineAgent(llm_client)
ingest_agent = IngestAgent(llm_client)
alert_pipeline = AlertPipeline(dedup_store, pipeline_agent=pipeline_agent, ingest_agent=ingest_agent)
alert_generator = AlertGeneratorAgent(llm_client)
generator_chat_agent = GeneratorChatAgent(llm_client, alert_generator, alert_pipeline)

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.services.demo_seed import seed_demo_alerts

    logger.info(
        "Alert Streamer starting — LLM provider=%s configured=%s model=%s",
        llm_client.provider,
        llm_client.is_configured,
        llm_client.model,
    )
    if settings.seed_demo_alerts:
        await seed_demo_alerts(alert_store, alert_pipeline, alert_generator)
    yield
    logger.info("Alert Streamer shutting down")


app = FastAPI(
    title="Alert Streamer",
    description="Agent-driven alert pipeline — ingest, validate, deduplicate, prioritize",
    version="2.8.0",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(alerts.router, prefix="/api/v1")
app.include_router(llm.router, prefix="/api/v1")
app.include_router(agents.router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "alert-streamer",
        "llm_configured": llm_client.is_configured,
        "llm_provider": llm_client.provider,
        "model": llm_client.model,
        "pipeline": "ingest → validate → deduplicate → prioritize",
        "agents": ["ingest", "pipeline", "generator", "generator-chat", "websocket"],
    }


@app.get("/")
async def dashboard():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")
