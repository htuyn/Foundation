import asyncio
from collections import defaultdict
from uuid import UUID

from fastapi import WebSocket


class ScannerConnections:
    def __init__(self) -> None:
        self._sockets: dict[UUID, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def add(self, session_id: UUID, websocket: WebSocket) -> None:
        async with self._lock:
            self._sockets[session_id].add(websocket)

    async def remove(self, session_id: UUID, websocket: WebSocket) -> None:
        async with self._lock:
            self._sockets[session_id].discard(websocket)
            if not self._sockets[session_id]:
                self._sockets.pop(session_id, None)

    async def broadcast(self, session_id: UUID, event: dict) -> None:
        async with self._lock:
            sockets = tuple(self._sockets.get(session_id, set()))
        for websocket in sockets:
            try:
                await websocket.send_json(event)
            except Exception:
                await self.remove(session_id, websocket)


scanner_connections = ScannerConnections()
