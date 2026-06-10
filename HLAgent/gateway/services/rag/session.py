"""RagSession: per-cwd facade combining store, provider, indexer, sse."""
from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from .budget import Budget
from .indexer import Indexer
from .providers import CachedProvider
from .sse import SseBroadcaster
from .store import RagStore

if TYPE_CHECKING:
    from .search import Searcher
    from .watcher import Watcher


class RagSession:
    def __init__(self, cwd: Path, store: RagStore, provider: CachedProvider,
                 budget: Budget):
        self.cwd = cwd
        self.store = store
        self.provider = provider
        self.budget = budget
        self.sse = SseBroadcaster()
        self.indexer = Indexer(store=store, provider=provider,
                                budget=budget, cwd=cwd)
        self.watcher: "Watcher | None" = None
        # lazy import to avoid circular dependency during T14 (before T15 lands)
        from .search import Searcher  # noqa: WPS433
        self.searcher = Searcher(store=store, provider=provider)

    async def emit(self, event: dict) -> None:
        await self.sse.emit(event)

    def close(self) -> None:
        self.store.close()
