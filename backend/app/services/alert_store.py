"""In-memory alert store with optional persistence hooks."""

from uuid import UUID

from app.models.schemas import AlertRecord, AlertStatus, PipelineStats


class AlertStore:
    def __init__(self) -> None:
        self._alerts: dict[UUID, AlertRecord] = {}
        self._events: list[dict] = []

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
        return alert

    async def get(self, alert_id: UUID) -> AlertRecord | None:
        return self._alerts.get(alert_id)

    async def list(
        self,
        *,
        status: AlertStatus | None = None,
        team: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[AlertRecord], int]:
        items = list(self._alerts.values())
        items.sort(key=lambda a: (a.priority, a.received_at), reverse=False)

        if status:
            items = [a for a in items if a.status == status]
        if team:
            items = [a for a in items if a.team.value == team]

        total = len(items)
        return items[offset : offset + limit], total

    async def stats(self) -> PipelineStats:
        by_status: dict[str, int] = {}
        by_priority: dict[str, int] = {}
        by_team: dict[str, int] = {}

        for alert in self._alerts.values():
            by_status[alert.status.value] = by_status.get(alert.status.value, 0) + 1
            by_priority[f"P{alert.priority}"] = by_priority.get(f"P{alert.priority}", 0) + 1
            by_team[alert.team.value] = by_team.get(alert.team.value, 0) + 1

        return PipelineStats(
            total_alerts=len(self._alerts),
            by_status=by_status,
            by_priority=by_priority,
            by_team=by_team,
        )

    async def get_events(self, since_index: int = 0) -> list[dict]:
        return self._events[since_index:]

    async def clear(self) -> None:
        self._alerts.clear()
        self._events.clear()
