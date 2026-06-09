"""Query LRU cache wrapper around EmbedProvider."""
import pytest
import respx
from httpx import Response

from services.rag.providers import make_cached_provider
from services.rag.providers.openai_provider import OpenAIProvider


@pytest.mark.asyncio
async def test_query_cache_hits_second_call():
    inner = OpenAIProvider(api_key="sk", api_base="https://api.openai.com/v1",
                           model="text-embedding-3-small", dimensions=4)
    cached = make_cached_provider(inner, profile_id="emb_openai_aaa111", maxsize=10)
    fake = {"data": [{"embedding": [1.0, 2.0, 3.0, 4.0], "index": 0}],
            "model": "m", "usage": {"prompt_tokens": 1, "total_tokens": 1}}
    with respx.mock() as r:
        route = r.post("https://api.openai.com/v1/embeddings").mock(
            return_value=Response(200, json=fake)
        )
        v1 = await cached.embed_query("hello")
        v2 = await cached.embed_query("hello")
    assert v1 == v2
    assert route.call_count == 1


@pytest.mark.asyncio
async def test_batch_bypasses_cache():
    inner = OpenAIProvider(api_key="sk", api_base="https://api.openai.com/v1",
                           model="text-embedding-3-small", dimensions=4)
    cached = make_cached_provider(inner, profile_id="emb_openai_bbb222", maxsize=10)
    fake = {"data": [
                {"embedding": [1.0, 2.0, 3.0, 4.0], "index": 0},
                {"embedding": [5.0, 6.0, 7.0, 8.0], "index": 1},
            ],
            "model": "m", "usage": {"prompt_tokens": 2, "total_tokens": 2}}
    with respx.mock() as r:
        route = r.post("https://api.openai.com/v1/embeddings").mock(
            return_value=Response(200, json=fake)
        )
        await cached.embed(["a", "b"])
        await cached.embed(["a", "b"])
    assert route.call_count == 2
