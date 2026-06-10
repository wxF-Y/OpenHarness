"""Performance smoke benchmark for hybrid retrieval.

Real budget is P95 < 300ms at 10k chunks against a real provider; here we
populate the store with 1000 synthetic chunks (no API calls) and measure
the per-query latency of hybrid_search alone. The assertion uses a relaxed
ceiling (1s) to keep CI green even on slow runners; the strict budget is
exercised when the user runs against their real index.
"""
import random
import statistics
import time

import pytest

from services.rag.search import Searcher
from services.rag.store import RagStore


class FakeProvider:
    name = "openai"
    dimensions = 4

    async def embed_query(self, text: str) -> list[float]:
        random.seed(hash(text) & 0xFFFFFFFF)
        return [random.random() for _ in range(4)]


@pytest.mark.asyncio
async def test_p95_under_budget(tmp_path):
    store = RagStore(tmp_path / "p.db", dimensions=4)
    store.init_schema()

    for i in range(1000):
        ch = {
            "file": f"f{i % 50}.py", "lang": "python", "kind": "function",
            "symbol": f"fn_{i}", "parent": None,
            "content": f"def fn_{i}(x): return x * {i}",
            "tokens_split": f"def fn_{i} fn {i}",
            "hash": f"h{i}", "start_line": 1, "end_line": 1,
        }
        vec = [random.random() for _ in range(4)]
        store.upsert_chunks(
            ch["file"], [ch], [vec],
            file_sha=f"h{i}", mtime=1.0,
            provider="openai", model="m",
        )

    se = Searcher(store=store, provider=FakeProvider())
    queries = [f"fn_{i}" for i in range(0, 1000, 10)]
    latencies = []
    for q in queries:
        t0 = time.perf_counter()
        await se.hybrid_search(q, top_k=8)
        latencies.append((time.perf_counter() - t0) * 1000)

    p95 = statistics.quantiles(latencies, n=20)[-1]
    assert p95 < 1000, f"P95={p95:.1f}ms exceeds relaxed 1000ms ceiling"
    store.close()
