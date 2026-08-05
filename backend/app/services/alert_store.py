"""In-memory alert store with JSON file persistence."""

import json
import logging
import os
from pathlib import Path
from uuid import UUID

from app.models.schemas import AlertRecord, AlertStatus, PipelineStats

logger = logging.getLogger(__name__)

DEFAULT_PERSIST_PATH = Path(os.environ.get("ALERT_STORE_PATH", "/tmp/alert_streamer_store.json"))


class AlertStore:
    def __init__(self, persist_path: Path | None = None) -> None:
        self._alerts: dict[UUID, AlertRecord] = {}
        self._events: list[dict] = []
        self._persist_path = persist_path or DEFAULT_PERSIST_PATH
        self._load_from_disk()

    def _load_from_disk(self) -> None:
        if not self._persist_path.exists():
            return
        try:
            raw = json.loads(self._persist_path.read_text(encoding="utf-8"))
            for item in raw.get("alerts", []):
                record = AlertRecord.model_validate(item)
                self._alerts[record.id] = record
            self._events = raw.get("events", [])
            logger.info("Loaded %d alerts from %s", len(self._alerts), self._persist_path)
        except Exception:
            logger.exception("Failed to load alert store from %s", self._persist_path)

    def _persist(self) -> None:
        try:
            self._persist_path.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "alerts": [a.model_dump(mode="json") for a in self._alerts.values()],
                "events": self._events[-500:],
            }
            self._persist_path.write_text(json.dumps(payload, default=str), encoding="utf-8")
        except Exception:
            logger.exception("Failed to persist alert store to %s", self._persist_path)

    async def save(self, alert: AlertRecord) -> AlertRecord:
        self._alerts[alert.id] = alert
        self._events.append(
            {
                "type": "alert_saved",
                "alert_id": str(alert.id),
                "status": alert.status.value,
                "priority": alert.priority,
                "team": alert.team.value,
            }
        )
        self._persist()
        from app.services.stream_hub import stream_hub

        await stream_hub.broadcast(self)
        return alert

    async def update(self, alert: AlertRecord) -> AlertRecord:
        self._alerts[alert.id] = alert
        self._events.append(
            {
                "type": "alert_updated",
                "alert_id": str(alert.id),
                "status": alert.status.value,
            }
        )
        self._persist()
        from app.services.stream_hub import stream_hub

        await stream_hub.broadcast(self)
        return alert

    async def get(self, alert_id: UUID) -> AlertRecord | None:
        return self._alerts.get(alert_id)

    async def list_alerts(
        self,
        *,
        status: AlertStatus | None = None,
        team: str | None = None,
        limit: int = 100,
        offset: int = 0,
        exclude_statuses: set[AlertStatus] | None = None,
    ) -> tuple[list[AlertRecord], int]:
        items = list(self._alerts.values())
        items.sort(key=lambda a: a.received_at, reverse=True)

        if exclude_statuses:
            items = [a for a in items if a.status not in exclude_statuses]
        if status:
            items = [a for a in items if a.status == status]
        if team:
            items = [a for a in items if a.team.value == team]

        total = len(items)
        return items[offset : offset + limit], total

    async def stats(self) -> PipelineStats:
        active = [a for a in self._alerts.values() if a.status != AlertStatus.DUPLICATE]
        by_status: dict[str, int] = {}
        by_priority: dict[str, int] = {}
        by_team: dict[str, int] = {}

        for alert in self._alerts.values():
            by_status[alert.status.value] = by_status.get(alert.status.value, 0) + 1

        for alert in active:
            by_priority[f"P{alert.priority}"] = by_priority.get(f"P{alert.priority}", 0) + 1
            by_team[alert.team.value] = by_team.get(alert.team.value, 0) + 1

        return PipelineStats(
            total_alerts=len(active),
            by_status=by_status,
            by_priority=by_priority,
            by_team=by_team,
        )

    async def get_events(self, since_index: int = 0) -> list[dict]:
        return self._events[since_index:]

    async def clear(self) -> None:
        self._alerts.clear()
        self._events.clear()
        self._persist()
