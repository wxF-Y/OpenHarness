"""OpenAI embed provider — uses respx to mock HTTP."""
import pytest
import respx
from httpx import Response

from services.rag.providers.openai_provider import OpenAIProvider


@pytest.mark.asyncio
async def test_embed_returns_vectors():
    p = OpenAIProvider(
        api_key="sk-test",
        api_base="https://api.openai.com/v1",
        model="text-embedding-3-small",
        dimensions=4,
    )
    fake = {
        "data": [
            {"embedding": [0.1, 0.2, 0.3, 0.4], "index": 0},
            {"embedding": [0.5, 0.6, 0.7, 0.8], "index": 1},
        ],
        "model": "text-embedding-3-small",
        "usage": {"prompt_tokens": 10, "total_tokens": 10},
    }
    with respx.mock(assert_all_called=True) as r:
        r.post("https://api.openai.com/v1/embeddings").mock(
            return_value=Response(200, json=fake)
        )
        out = await p.embed(["hello", "world"])
    assert len(out) == 2
    assert out[0] == [0.1, 0.2, 0.3, 0.4]


@pytest.mark.asyncio
async def test_health_check_ok():
    p = OpenAIProvider(
        api_key="sk-test",
        api_base="https://api.openai.com/v1",
        model="text-embedding-3-small",
        dimensions=4,
    )
    with respx.mock() as r:
        r.post("https://api.openai.com/v1/embeddings").mock(
            return_value=Response(200, json={
                "data": [{"embedding": [0]*4, "index": 0}],
                "model": "m", "usage": {"prompt_tokens": 1, "total_tokens": 1},
            })
        )
        ok, msg = await p.health_check()
    assert ok is True


@pytest.mark.asyncio
async def test_health_check_401():
    p = OpenAIProvider(
        api_key="bad", api_base="https://api.openai.com/v1",
        model="text-embedding-3-small", dimensions=4,
    )
    with respx.mock() as r:
        r.post("https://api.openai.com/v1/embeddings").mock(
            return_value=Response(401, json={"error": "Unauthorized"})
        )
        ok, msg = await p.health_check()
    assert ok is False
    assert "401" in msg or "Unauthorized" in msg


def test_estimate_cost_text_embedding_3_small():
    p = OpenAIProvider(api_key="x", api_base="x", model="text-embedding-3-small",
                      dimensions=1536)
    assert abs(p.estimate_cost(1_000_000) - 0.02) < 1e-9
