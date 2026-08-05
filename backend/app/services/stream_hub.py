"""WebSocket hub — push alert stream snapshots to connected clients."""

import logging
from typing import TYPE_CHECKING

from fastapi import WebSocket

if TYPE_CHECKING:
    from app.services.alert_store import AlertStore

logger = logging.getLogger(__name__)


class StreamHub:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket, store: "AlertStore") -> None:
        await websocket.accept()
        self._connections.add(websocket)
        await self.send_snapshot(websocket, store)
        logger.info("WebSocket client connected (%d total)", len(self._connections))

    async def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)
        logger.info("WebSocket client disconnected (%d total)", len(self._connections))

    async def broadcast(self, store: "AlertStore") -> None:
        if not self._connections:
            return
        dead: list[WebSocket] = []
        for ws in list(self._connections):
            try:
                await self.send_snapshot(ws, store)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._connections.discard(ws)

    @staticmethod
    async def build_snapshot(store: "AlertStore") -> dict:
        items, total = await store.list_alerts(limit=100)
        stats = await store.stats()
        return {
            "type": "snapshot",
            "alerts": {
                "total": total,
                "items": [a.model_dump(mode="json") for a in items],
            },
            "stats": stats.model_dump(mode="json"),
        }

    @staticmethod
    async def send_snapshot(websocket: WebSocket, store: "AlertStore") -> None:
        payload = await StreamHub.build_snapshot(store)
        await websocket.send_json(payload)


stream_hub = StreamHub()
