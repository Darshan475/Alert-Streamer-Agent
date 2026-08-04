"""Seed demo alerts on startup using the alert generator agent — no JSON files."""

import asyncio
import logging

from app.services.alert_generator_agent import AlertGeneratorAgent
from app.services.alert_pipeline import AlertPipeline
from app.services.alert_store import AlertStore

logger = logging.getLogger(__name__)


async def seed_demo_alerts(
    store: AlertStore,
    pipeline: AlertPipeline,
    run_investigation,
    generator: AlertGeneratorAgent,
    *,
    max_alerts: int = 6,
) -> int:
    """Agent-generates demo alerts if the store is empty."""
    _ = run_investigation  # kept for API compat; pipeline-only mode skips investigation
    _, total = await store.list_alerts(limit=1)
    if total > 0:
        return 0

    seeded = 0
    recent_titles: list[str] = []

    for _ in range(max_alerts):
        alert = await generator.generate(recent_titles=recent_titles)
        response, record = await pipeline.process(alert, store=store)
        if not response.accepted or record is None:
            continue
        await store.save(record)
        recent_titles.append(record.title)
        seeded += 1

    if seeded:
        logger.info("Agent seeded %d demo alert(s)", seeded)
    return seeded
