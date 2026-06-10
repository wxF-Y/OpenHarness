"""OpenAI-compatible provider (DeepSeek/SiliconFlow/vLLM)."""
import pytest
import respx
from httpx import Response

from services.rag.providers.compat_provider import CompatProvider


@pytest.mark.asyncio
async def test_embed_via_compat_endpoint():
    p = CompatProvider(api_key="sk", api_base="https://api.example.com/v1",
                       model="any", dimensions=4)
    with respx.mock() as r:
        r.post("https://api.example.com/v1/embeddings").mock(
            return_value=Response(200, json={
                "data": [{"embedding": [0.1, 0.2, 0.3, 0.4], "index": 0}],
                "model": "any", "usage": {"prompt_tokens": 1, "total_tokens": 1},
            }),
        )
        out = await p.embed(["hi"])
    assert out == [[0.1, 0.2, 0.3, 0.4]]


def test_estimate_cost_zero():
    p = CompatProvider(api_key="x", api_base="x", model="x", dimensions=1)
    assert p.estimate_cost(1_000_000) == 0.0
