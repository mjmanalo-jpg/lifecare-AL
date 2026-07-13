import json
from typing import Dict, Set
from fastapi import WebSocket
from datetime import datetime


class ConnectionManager:
    def __init__(self):
        self._connections: Dict[str, Set[WebSocket]] = {}
        self._user_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, channel: str, user_id: str | None = None):
        await websocket.accept()
        if channel not in self._connections:
            self._connections[channel] = set()
        self._connections[channel].add(websocket)
        if user_id:
            if user_id not in self._user_connections:
                self._user_connections[user_id] = set()
            self._user_connections[user_id].add(websocket)

    def disconnect(self, websocket: WebSocket, channel: str, user_id: str | None = None):
        if channel in self._connections:
            self._connections[channel].discard(websocket)
            if not self._connections[channel]:
                del self._connections[channel]
        if user_id and user_id in self._user_connections:
            self._user_connections[user_id].discard(websocket)
            if not self._user_connections[user_id]:
                del self._user_connections[user_id]

    async def broadcast(self, channel: str, message: dict):
        if channel not in self._connections:
            return
        dead = []
        for ws in self._connections[channel]:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._connections[channel].discard(ws)

    async def send_to_user(self, user_id: str, message: dict):
        if user_id not in self._user_connections:
            return
        dead = []
        for ws in self._user_connections[user_id]:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._user_connections[user_id].discard(ws)

    def get_active_connections(self, channel: str) -> int:
        return len(self._connections.get(channel, set()))

    def get_user_connections(self, user_id: str) -> int:
        return len(self._user_connections.get(user_id, set()))


manager = ConnectionManager()
