"""EmbedProvider abstraction.

M1 includes only OpenAIProvider; M4 adds Ollama / Local / OpenAI-Compatible.
"""
from __future__ import annotations

import secrets
from typing import Protocol, runtime_checkable

from pydantic import BaseModel, Field


Vector = list[float]


@runtime_checkable
class EmbedProvider(Protocol):
    name: str
    dimensions: int
    max_batch_tokens: int

    async def embed(self, texts: list[str]) -> list[Vector]: ...
    async def health_check(self) -> tuple[bool, str]: ...
    def estimate_cost(self, tokens: int) -> float: ...


class ProviderConfig(BaseModel):
    id: str = Field(..., pattern=r"^emb_[a-z\-]+_[0-9a-f]{6}$")
    name: str
    provider: str
    model: str
    dimensions: int
    api_base: str | None = None
    api_key_enc: str | None = None
    extras: dict = Field(default_factory=dict)


def gen_profile_id(provider: str) -> str:
    """`emb_<provider>_<6 hex>`. Collision-resistant (2^-24 per draw)."""
    return f"emb_{provider}_{secrets.token_hex(3)}"
