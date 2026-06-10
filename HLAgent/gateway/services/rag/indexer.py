"""Orchestrates chunkers + provider + store + budget for rebuild / update.

M1 simplifications:
  - No watcher integration (M3)
  - No .gitignore / .ragignore filtering (M3)
  - Single asyncio task per call; no shared global queue yet (M3 adds Worker)

Emits progress events via the `on_event` async callback.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import time
from pathlib import Path
from typing import Awaitable, Callable

import tiktoken

from .budget import Budget
from .chunkers import is_indexable, iter_chunks
from .providers.base import EmbedProvider
from .store import RagStore
from .worker import CancelToken

_ENC = tiktoken.get_encoding("cl100k_base")
EventHandler = Callable[[dict], Awaitable[None]]


async def _noop(_event: dict) -> None:
    return None


class Indexer:
    def __init__(
        self,
        *,
        store: RagStore,
        provider: EmbedProvider,
        budget: Budget,
        cwd: Path,
    ):
        self.store = store
        self.provider = provider
        self.budget = budget
        self.cwd = cwd
        self._lock = asyncio.Lock()

    async def rebuild(
        self,
        *,
        on_event: EventHandler = _noop,
        cancel: CancelToken | None = None,
    ) -> None:
        async with self._lock:
            self.store.purge_all()
            await on_event({"stage": "purged", "source": "rebuild"})
            await self._index_paths(
                list(self._candidate_files()),
                source="rebuild",
                on_event=on_event,
                cancel=cancel or CancelToken(),
            )

    async def update(
        self,
        paths: list[Path],
        *,
        on_event: EventHandler = _noop,
        cancel: CancelToken | None = None,
        source: str = "manual",
    ) -> None:
        async with self._lock:
            await self._index_paths(paths, source=source,
                                    on_event=on_event,
                                    cancel=cancel or CancelToken())

    async def delete_files(self, paths: list[Path], *,
                           on_event: EventHandler = _noop) -> None:
        async with self._lock:
            for p in paths:
                rel = str(p.relative_to(self.cwd)).replace(os.sep, "/")
                self.store.delete_file(rel)
                await on_event({"stage": "deleted", "file": rel})

    def _candidate_files(self):
        """Walk cwd, yield indexable files. M1: no .gitignore/.ragignore."""
        for root, dirs, files in os.walk(self.cwd):
            dirs[:] = [d for d in dirs if d not in {
                "node_modules", ".git", "__pycache__", ".venv",
                "dist", "build", ".openharness", ".hlagent",
            }]
            for fname in files:
                p = Path(root) / fname
                if is_indexable(p):
                    yield p

    async def _index_paths(
        self,
        paths: list[Path],
        *,
        source: str,
        on_event: EventHandler,
        cancel: CancelToken,
    ) -> None:
        total = len(paths)
        done = 0
        await on_event({
            "stage": "start", "source": source,
            "done": 0, "total": total,
        })
        for path in paths:
            if cancel:
                await on_event({
                    "stage": "cancelled", "source": source,
                    "done": done, "total": total,
                })
                return
            try:
                await self._index_single_file(path, source=source,
                                              on_event=on_event)
            except Exception as exc:
                await on_event({
                    "stage": "error", "source": source,
                    "file": str(path), "error": f"{type(exc).__name__}: {exc}",
                })
            done += 1
        await on_event({
            "stage": "complete", "source": source,
            "done": done, "total": total,
        })

    async def _index_single_file(self, path: Path, *,
                                 source: str, on_event: EventHandler) -> None:
        rel = str(path.relative_to(self.cwd)).replace(os.sep, "/")

        content = path.read_bytes()
        file_sha = hashlib.sha256(content).hexdigest()
        existing_sha = self.store.get_file_sha(rel)
        if existing_sha == file_sha:
            await on_event({"stage": "skip_file", "file": rel, "reason": "sha_match"})
            return

        chunks = list(iter_chunks(path, rel_path=rel))
        if not chunks:
            return

        tokens = sum(len(_ENC.encode(c["content"])) for c in chunks)
        cost = self.provider.estimate_cost(tokens)
        if self.budget.would_exceed(cost):
            await on_event({
                "stage": "budget_exceeded", "source": source,
                "file": rel,
                "cost_estimate": cost,
                "today_total": self.budget.today_total_usd(),
                "action": self.budget.over_budget_action,
            })
            if self.budget.over_budget_action == "hard_stop":
                raise RuntimeError("Daily embed budget exceeded")
            if self.budget.over_budget_action == "pause":
                await on_event({"stage": "watcher_pause_request",
                                "reason": "budget exceeded"})
                return
            # warn: proceed with embedding

        texts = [c["content"] for c in chunks]
        vectors = await self.provider.embed(texts)
        self.budget.charge(tokens=tokens, cost_usd=cost, source=source)
        mtime = path.stat().st_mtime
        self.store.upsert_chunks(
            rel, chunks, vectors,
            file_sha=file_sha, mtime=mtime,
            provider=self.provider.name,
            model=getattr(self.provider, "model", "unknown"),
        )

        await on_event({
            "stage": "file_done", "source": source, "file": rel,
            "chunks": len(chunks),
        })
