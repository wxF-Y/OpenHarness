"""Cancellation token shared by indexer and watcher to abort jobs cooperatively."""
from __future__ import annotations


class CancelToken:
    """Cooperative cancel signal. Per-batch granularity in the indexer."""

    def __init__(self):
        self._cancelled = False

    def cancel(self) -> None:
        self._cancelled = True

    @property
    def cancelled(self) -> bool:
        return self._cancelled

    def __bool__(self) -> bool:
        return self._cancelled
