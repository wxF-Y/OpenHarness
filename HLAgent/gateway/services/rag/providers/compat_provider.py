"""OpenAI-compatible provider — for DeepSeek, SiliconFlow, vLLM, etc."""
from __future__ import annotations

from .openai_provider import OpenAIProvider


class CompatProvider(OpenAIProvider):
    """Subclasses OpenAIProvider; only overrides `name` and skips OpenAI-pricing."""

    name = "openai-compatible"

    def estimate_cost(self, tokens: int) -> float:
        # Caller can override per-deployment via extras; default 0 (unknown).
        return 0.0
