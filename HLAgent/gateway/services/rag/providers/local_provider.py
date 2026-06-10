"""Local sentence-transformers provider.

M5 minimal: structural skeleton + lazy import. Users must install the
``embed-local`` optional dependency group (sentence-transformers + torch)
to use it. The UI surfaces the install command; this module degrades
gracefully when the dependency is missing.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

from .base import Vector


class LocalProvider:
    name = "local"
    max_batch_tokens = 8192

    def __init__(self, *, model: str, dimensions: int, device: str = "auto",
                 cache_dir: str | None = None, idle_seconds: int = 3600):
        self.model = model
        self.dimensions = dimensions
        self.device = device
        self.cache_dir = cache_dir
        self._idle_seconds = idle_seconds
        self._impl: Any = None
        self._last_use: float = 0.0
        self._lock = asyncio.Lock()

    async def _ensure_loaded(self) -> None:
        if self._impl is not None:
            return
        async with self._lock:
            if self._impl is not None:
                return
            try:
                from sentence_transformers import SentenceTransformer  # type: ignore
            except ImportError as exc:
                raise RuntimeError(
                    "Local provider requires sentence-transformers. "
                    "Install: pip install hlagent-gateway[embed-local]"
                ) from exc
            device = self._detect_device()
            self._impl = SentenceTransformer(
                self.model, device=device, cache_folder=self.cache_dir,
            )

    def _detect_device(self) -> str:
        if self.device != "auto":
            return self.device
        try:
            import torch  # type: ignore
            if torch.cuda.is_available():
                return "cuda"
            if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                return "mps"
        except ImportError:
            pass
        return "cpu"

    async def embed(self, texts: list[str]) -> list[Vector]:
        await self._ensure_loaded()
        self._last_use = time.time()
        loop = asyncio.get_running_loop()
        out = await loop.run_in_executor(
            None,
            lambda: self._impl.encode(
                texts, normalize_embeddings=True,
                convert_to_numpy=True, show_progress_bar=False,
            ),
        )
        return [v.tolist() for v in out]

    async def health_check(self) -> tuple[bool, str]:
        try:
            await self._ensure_loaded()
            await self.embed(["ping"])
            return True, "ok"
        except RuntimeError as exc:
            return False, str(exc)
        except Exception as exc:  # pragma: no cover - defensive
            return False, f"{type(exc).__name__}: {exc}"

    def estimate_cost(self, tokens: int) -> float:
        return 0.0
