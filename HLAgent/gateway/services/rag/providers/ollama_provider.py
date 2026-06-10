"""Ollama HTTP client for embeddings + model discovery + pull."""
from __future__ import annotations

from typing import AsyncIterator

import httpx

from .base import Vector


class OllamaProvider:
    name = "ollama"
    max_batch_tokens = 8192   # ollama embeds one at a time; batches loop

    def __init__(self, *, base_url: str, model: str, dimensions: int,
                 timeout_s: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.dimensions = dimensions
        self._client = httpx.AsyncClient(timeout=timeout_s)

    async def embed(self, texts: list[str]) -> list[Vector]:
        out: list[Vector] = []
        for t in texts:
            r = await self._client.post(
                f"{self.base_url}/api/embeddings",
                json={"model": self.model, "prompt": t},
            )
            r.raise_for_status()
            out.append(r.json()["embedding"])
        return out

    async def health_check(self) -> tuple[bool, str]:
        try:
            r = await self._client.get(f"{self.base_url}/api/tags", timeout=5.0)
            r.raise_for_status()
            return True, "ok"
        except httpx.ConnectError as exc:
            return False, f"ECONNREFUSED {self.base_url}: {exc}"
        except httpx.HTTPError as exc:
            return False, str(exc)

    def estimate_cost(self, tokens: int) -> float:
        return 0.0   # local

    async def list_models(self) -> list[dict]:
        r = await self._client.get(f"{self.base_url}/api/tags")
        r.raise_for_status()
        return r.json().get("models", [])

    async def pull_model(self, name: str) -> AsyncIterator[dict]:
        """Stream pull progress as dicts. Caller forwards into SSE."""
        async with self._client.stream(
            "POST", f"{self.base_url}/api/pull",
            json={"name": name, "stream": True},
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line.strip():
                    continue
                import json as _json
                try:
                    yield _json.loads(line)
                except _json.JSONDecodeError:
                    yield {"raw": line}

    async def aclose(self) -> None:
        await self._client.aclose()
