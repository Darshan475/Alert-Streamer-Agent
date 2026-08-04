"""Seed demo alerts on startup when the in-memory store is empty."""

import asyncio
import json
import logging
from pathlib import Path

from app.models.schemas import AlertIngest
from app.services.alert_pipeline import AlertPipeline
from app.services.alert_store import AlertStore

logger = logging.getLogger(__name__)

def _default_data_file() -> Path:
    backend_root = Path(__file__).resolve().parents[2]
    bundled = backend_root / "data" / "dummy_alerts.json"
    if bundled.exists():
        return bundled
    return backend_root.parent / "data" / "dummy_alerts.json"


DATA_FILE = _default_data_file()


async def seed_demo_alerts(
    store: AlertStore,
    pipeline: AlertPipeline,
    run_investigation,
    *,
    data_file: Path = DATA_FILE,
    max_alerts: int = 8,
) -> int:
    """Ingest demo alerts if the store is empty. Returns count seeded."""
    _, total = await store.list_alerts(limit=1)
    if total > 0:
        return 0

    if not data_file.exists():
        logger.warning("Demo seed skipped — data file not found: %s", data_file)
        return 0

    with open(data_file, encoding="utf-8") as handle:
        payload = json.load(handle)

    raw_alerts = payload.get("alerts", payload if isinstance(payload, list) else [])
    seeded = 0

    for entry in raw_alerts[:max_alerts]:
        alert = AlertIngest.model_validate(entry)
        response, record = await pipeline.process(alert)
        if not response.accepted or record is None:
            continue
        await store.save(record)
        asyncio.create_task(run_investigation(record.id))
        seeded += 1

    if seeded:
        logger.info("Seeded %d demo alert(s) from %s", seeded, data_file.name)
    return seeded
