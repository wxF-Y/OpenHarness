"""OpenAI /v1/embeddings client."""
from __future__ import annotations

import asyncio

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .base import Vector

_PRICING = {
    "text-embedding-3-small": 0.02,
    "text-embedding-3-large": 0.13,
    "text-embedding-ada-002": 0.10,
}


class OpenAIProvider:
    name = "openai"
    max_batch_tokens = 80_000

    def __init__(
        self,
        *,
        api_key: str,
        api_base: str,
        model: str,
        dimensions: int,
        timeout_s: float = 30.0,
        max_concurrency: int = 8,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.model = model
        self.dimensions = dimensions
        self._client = httpx.AsyncClient(timeout=timeout_s)
        self._sem = asyncio.Semaphore(max_concurrency)

    async def embed(self, texts: list[str]) -> list[Vector]:
        if not texts:
            return []
        async with self._sem:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(5),
                wait=wait_exponential(multiplier=1, min=1, max=30),
                retry=retry_if_exception_type((httpx.HTTPError,)),
                reraise=True,
            ):
                with attempt:
                    resp = await self._client.post(
                        f"{self.api_base}/embeddings",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        json={
                            "model": self.model,
                            "input": texts,
                            "dimensions": self.dimensions,
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()["data"]
                    data.sort(key=lambda d: d["index"])
                    return [d["embedding"] for d in data]
        return []

    async def health_check(self) -> tuple[bool, str]:
        try:
            vec = await self.embed(["ping"])
            if not vec or len(vec[0]) != self.dimensions:
                return False, f"unexpected embedding dim {len(vec[0]) if vec else 0}"
            return True, "ok"
        except httpx.HTTPStatusError as exc:
            return False, f"{exc.response.status_code} {exc.response.reason_phrase}"
        except httpx.HTTPError as exc:
            return False, str(exc)
        except Exception as exc:
            return False, f"{type(exc).__name__}: {exc}"

    def estimate_cost(self, tokens: int) -> float:
        per_million = _PRICING.get(self.model, 0.05)
        return tokens / 1_000_000 * per_million

    async def aclose(self) -> None:
        await self._client.aclose()
