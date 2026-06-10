"""File-system watcher for the RAG indexer.

Watchdog Observer wraps the cwd; events are filtered, per-file debounced
(500ms), then aggregated every 3s into batches handed to indexer.update /
delete_files. State machine: stopped -> running -> paused -> running -> stopped.
"""
from __future__ import annotations

import asyncio
import time
from collections import deque
from pathlib import Path
from typing import Callable

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from .chunkers import is_indexable
from .indexer import Indexer

ActivityEntry = dict
_DEBOUNCE_MS = 500
_FLUSH_INTERVAL_S = 3.0
_HEALTH_CHECK_INTERVAL_S = 300.0
_LOG_BUFFER_SIZE = 50


class Watcher:
    """One per cwd. Owns Observer + asyncio flush task + activity log."""

    def __init__(self, indexer: Indexer):
        self.indexer = indexer
        self.cwd = indexer.cwd
        self._observer: Observer | None = None
        self._handler: _WatcherHandler | None = None
        self._state: str = "stopped"   # stopped | running | paused
        self._pause_reason: str = ""
        self._loop: asyncio.AbstractEventLoop | None = None
        self._flush_task: asyncio.Task | None = None
        self._health_task: asyncio.Task | None = None
        self._pending: dict[Path, str] = {}
        self._last_event_at: dict[Path, float] = {}
        self._activity_log: deque[ActivityEntry] = deque(maxlen=_LOG_BUFFER_SIZE)
        self._lock = asyncio.Lock()
        self._was_running_before_manual: bool = False

    def start(self) -> None:
        if self._state != "stopped":
            return
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None
        self._handler = _WatcherHandler(self._on_event)
        self._observer = Observer()
        self._observer.schedule(self._handler, str(self.cwd), recursive=True)
        self._observer.start()
        self._state = "running"
        self._log({"stage": "watcher_started"})
        if self._loop is not None:
            self._flush_task = self._loop.create_task(self._flush_loop())
            self._health_task = self._loop.create_task(self.health_check_loop())

    def stop(self) -> None:
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=2.0)
            self._observer = None
        if self._flush_task:
            self._flush_task.cancel()
            self._flush_task = None
        if self._health_task:
            self._health_task.cancel()
            self._health_task = None
        self._state = "stopped"
        self._log({"stage": "watcher_stopped"})

    def pause(self, reason: str) -> None:
        if self._state == "running":
            self._state = "paused"
            self._pause_reason = reason
            self._log({"stage": "watcher_paused", "reason": reason})

    def resume(self) -> None:
        if self._state == "paused":
            self._state = "running"
            self._pause_reason = ""
            self._log({"stage": "watcher_resumed"})

    @property
    def state(self) -> dict:
        return {"state": self._state, "reason": self._pause_reason,
                "pending": len(self._pending)}

    @property
    def activity(self) -> list[ActivityEntry]:
        return list(self._activity_log)

    def _log(self, entry: ActivityEntry) -> None:
        entry = {**entry, "ts": time.time()}
        self._activity_log.appendleft(entry)

    def _on_event(self, event: FileSystemEvent) -> None:
        """Called from watchdog thread; only marks pending state (thread-safe)."""
        if event.is_directory:
            return
        path = Path(event.src_path)
        kind = "deleted" if event.event_type == "deleted" else "modified"
        if kind == "modified" and not is_indexable(path):
            return
        now = time.time()
        self._last_event_at[path] = now
        self._pending[path] = kind

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(_FLUSH_INTERVAL_S)
            if self._state != "running":
                continue
            async with self._lock:
                await self._flush_once()

    async def health_check_loop(self) -> None:
        """Every 5min, check provider health. 3 consecutive fails -> pause."""
        consecutive_fails = 0
        while True:
            await asyncio.sleep(_HEALTH_CHECK_INTERVAL_S)
            if self._state == "stopped":
                return
            ok, msg = await self.indexer.provider.health_check()
            if ok:
                consecutive_fails = 0
                if self._state == "paused" and self._pause_reason.startswith("provider"):
                    self.resume()
            else:
                consecutive_fails += 1
                self._log({"stage": "health_fail", "msg": msg,
                           "consecutive": consecutive_fails})
                if consecutive_fails >= 3 and self._state == "running":
                    self.pause(f"provider unavailable: {msg}")

    def pause_for_manual(self) -> None:
        """Pause watcher while a manual rebuild is running."""
        if self._state == "running":
            self.pause("manual rebuild in progress")
            self._was_running_before_manual = True
        else:
            self._was_running_before_manual = False

    def resume_after_manual(self) -> None:
        if self._was_running_before_manual:
            self.resume()
        self._was_running_before_manual = False

    async def _flush_once(self) -> None:
        now = time.time()
        ready: dict[Path, str] = {}
        for p, last in list(self._last_event_at.items()):
            if (now - last) * 1000 >= _DEBOUNCE_MS:
                if p in self._pending:
                    ready[p] = self._pending.pop(p)
                self._last_event_at.pop(p, None)
        if not ready:
            return
        modified = [p for p, k in ready.items() if k == "modified"]
        deleted = [p for p, k in ready.items() if k == "deleted"]
        if deleted:
            try:
                await self.indexer.delete_files(deleted)
                self._log({"stage": "auto_delete", "count": len(deleted)})
            except Exception as exc:
                self._log({"stage": "auto_delete_error", "error": str(exc)})
        if modified:
            try:
                await self.indexer.update(modified, source="auto")
                self._log({"stage": "auto_update", "count": len(modified)})
            except Exception as exc:
                self._log({"stage": "auto_update_error", "error": str(exc)})


class _WatcherHandler(FileSystemEventHandler):
    def __init__(self, on_event: Callable[[FileSystemEvent], None]):
        self._cb = on_event

    def on_any_event(self, event: FileSystemEvent) -> None:
        self._cb(event)
