"""
NAGARNETRA — WebSocket Alert Manager
Manages connected WebSocket clients and broadcasts alert messages.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Set

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class AlertManager:
    """
    Manages WebSocket connections for live alert broadcasting.
    Thread-safe (asyncio-based), supports multiple simultaneous clients.
    """

    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)
        logger.info(f"WebSocket client connected. Total: {len(self._connections)}")

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(ws)
        logger.info(f"WebSocket client disconnected. Total: {len(self._connections)}")

    async def broadcast(self, payload: dict) -> None:
        """Send a JSON payload to all connected clients."""
        message = json.dumps(payload, default=str)
        dead: list[WebSocket] = []
        async with self._lock:
            connections = set(self._connections)

        for ws in connections:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections.discard(ws)

    async def broadcast_alert(
        self,
        alert_id: int,
        plate_number: str,
        camera_id: str,
        camera_name: str,
        alert_type: str,
        timestamp: datetime,
        details: str | None = None,
    ) -> None:
        await self.broadcast({
            "type": "alert",
            "alert_id": alert_id,
            "plate_number": plate_number,
            "camera_id": camera_id,
            "camera_name": camera_name,
            "alert_type": alert_type,
            "timestamp": timestamp.isoformat(),
            "details": details,
        })


# Singleton
alert_manager = AlertManager()
