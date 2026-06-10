"""Ollama provider — respx mocks."""
import pytest
import respx
from httpx import Response

from services.rag.providers.ollama_provider import OllamaProvider


@pytest.mark.asyncio
async def test_embed_one_per_text():
    p = OllamaProvider(base_url="http://localhost:11434",
                       model="nomic-embed-text", dimensions=768)
    with respx.mock() as r:
        route = r.post("http://localhost:11434/api/embeddings").mock(
            return_value=Response(200, json={"embedding": [0.1] * 768}),
        )
        out = await p.embed(["a", "b"])
    assert len(out) == 2
    assert route.call_count == 2


@pytest.mark.asyncio
async def test_health_check_ok():
    p = OllamaProvider(base_url="http://localhost:11434", model="m", dimensions=768)
    with respx.mock() as r:
        r.get("http://localhost:11434/api/tags").mock(
            return_value=Response(200, json={"models": []}),
        )
        ok, msg = await p.health_check()
    assert ok is True


@pytest.mark.asyncio
async def test_health_check_fail():
    p = OllamaProvider(base_url="http://localhost:11434", model="m", dimensions=768)
    with respx.mock() as r:
        r.get("http://localhost:11434/api/tags").mock(
            return_value=Response(500, json={"error": "down"}),
        )
        ok, msg = await p.health_check()
    assert ok is False


@pytest.mark.asyncio
async def test_list_models():
    p = OllamaProvider(base_url="http://localhost:11434", model="m", dimensions=768)
    with respx.mock() as r:
        r.get("http://localhost:11434/api/tags").mock(
            return_value=Response(200, json={
                "models": [{"name": "nomic-embed-text:latest", "size": 274,
                            "digest": "abc"}]
            }),
        )
        models = await p.list_models()
    assert models[0]["name"] == "nomic-embed-text:latest"


def test_estimate_cost_zero():
    p = OllamaProvider(base_url="x", model="x", dimensions=1)
    assert p.estimate_cost(1_000_000) == 0.0
