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

from app.api import alerts, chat, llm
from app.config import get_settings
from app.services.alert_pipeline import AlertPipeline, DedupStore
from app.services.alert_store import AlertStore
from app.services.chat_service import ChatService
from app.services.demo_seed import seed_demo_alerts
from app.services.investigation_agent import InvestigationAgent
from app.services.llm_client import LLMClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent / "static"

settings = get_settings()
alert_store = AlertStore()
dedup_store = DedupStore(ttl_seconds=settings.dedup_ttl_seconds)
alert_pipeline = AlertPipeline(dedup_store)
llm_client = LLMClient(settings)
investigation_agent = InvestigationAgent(llm_client)
chat_service = ChatService(llm_client, alert_store)

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "Alert Streamer starting — LLM provider=%s configured=%s model=%s",
        llm_client.provider,
        llm_client.is_configured,
        llm_client.model,
    )
    if settings.seed_demo_alerts:
        from app.api.alerts import _run_investigation

        await seed_demo_alerts(alert_store, alert_pipeline, _run_investigation)
    yield
    logger.info("Alert Streamer shutting down")


app = FastAPI(
    title="Alert Streamer",
    description="Alert ingestion, LLM investigation, and built-in dashboard (optional Next.js UI in frontend/)",
    version="1.0.0",
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
app.include_router(chat.router, prefix="/api/v1")
app.include_router(llm.router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "alert-streamer",
        "llm_configured": llm_client.is_configured,
        "llm_provider": llm_client.provider,
        "model": llm_client.model,
    }


@app.get("/")
async def dashboard():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")
