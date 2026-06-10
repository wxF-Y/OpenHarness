"""Provider registry + Query LRU cache wrapper."""
from __future__ import annotations

import hashlib

from cachetools import TTLCache

from .base import EmbedProvider, ProviderConfig, Vector
from .ollama_provider import OllamaProvider
from .openai_provider import OpenAIProvider


def make_provider(cfg: ProviderConfig, *, api_key: str | None = None) -> EmbedProvider:
    if cfg.provider == "openai":
        if not api_key:
            raise ValueError("api_key required for openai provider")
        return OpenAIProvider(
            api_key=api_key,
            api_base=cfg.api_base or "https://api.openai.com/v1",
            model=cfg.model,
            dimensions=cfg.dimensions,
        )
    if cfg.provider == "ollama":
        return OllamaProvider(
            base_url=cfg.api_base or "http://localhost:11434",
            model=cfg.model,
            dimensions=cfg.dimensions,
        )
    raise NotImplementedError(f"provider {cfg.provider!r} added in later milestone")


class CachedProvider:
    """Wraps an EmbedProvider with an LRU cache for single-query calls."""

    def __init__(self, inner: EmbedProvider, profile_id: str, maxsize: int = 2048,
                 ttl_seconds: int = 86400):
        self.inner = inner
        self.profile_id = profile_id
        self.dimensions = inner.dimensions
        self.name = inner.name
        self._cache: TTLCache = TTLCache(maxsize=maxsize, ttl=ttl_seconds)

    def _key(self, text: str) -> str:
        h = hashlib.sha256(text.encode("utf-8")).hexdigest()
        return f"{self.profile_id}:{self.dimensions}:{h}"

    async def embed_query(self, text: str) -> Vector:
        key = self._key(text)
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        out = await self.inner.embed([text])
        if out:
            self._cache[key] = out[0]
            return out[0]
        return []

    async def embed(self, texts: list[str]) -> list[Vector]:
        return await self.inner.embed(texts)

    async def health_check(self) -> tuple[bool, str]:
        return await self.inner.health_check()

    def estimate_cost(self, tokens: int) -> float:
        return self.inner.estimate_cost(tokens)


def make_cached_provider(inner: EmbedProvider, *, profile_id: str,
                         maxsize: int = 2048) -> CachedProvider:
    return CachedProvider(inner, profile_id=profile_id, maxsize=maxsize)
