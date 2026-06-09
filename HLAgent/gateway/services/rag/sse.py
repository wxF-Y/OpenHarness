"""In-process pub-sub broadcaster for SSE clients.

Slow subscribers drop oldest events (queue maxsize=200, put_nowait + try/except).
"""
from __future__ import annotations

import asyncio


class SseBroadcaster:
    def __init__(self, queue_size: int = 200):
        self._subs: list[asyncio.Queue] = []
        self._qsize = queue_size

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=self._qsize)
        self._subs.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        if q in self._subs:
            self._subs.remove(q)

    async def emit(self, event: dict) -> None:
        for q in list(self._subs):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass
