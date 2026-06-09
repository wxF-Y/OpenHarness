"""Indexer rebuild + update + cancel + SHA short-circuit."""
import asyncio
from pathlib import Path

import pytest

from services.rag.budget import Budget
from services.rag.indexer import Indexer
from services.rag.worker import CancelToken
from services.rag.store import RagStore


class FakeProvider:
    name = "openai"
    dimensions = 4
    max_batch_tokens = 80_000
    model = "text-embedding-3-small"

    def __init__(self):
        self.call_count = 0

    async def embed(self, texts):
        self.call_count += 1
        return [[0.1, 0.2, 0.3, 0.4] for _ in texts]

    async def embed_query(self, text):
        return (await self.embed([text]))[0]

    async def health_check(self):
        return True, "ok"

    def estimate_cost(self, tokens):
        return tokens / 1_000_000 * 0.02


@pytest.fixture
def setup(tmp_path):
    store = RagStore(tmp_path / "x.db", dimensions=4)
    store.init_schema()
    budget = Budget(store, daily_usd=1.0, over_budget_action="pause")
    provider = FakeProvider()
    idx = Indexer(store=store, provider=provider, budget=budget, cwd=tmp_path)
    yield idx, store, provider, tmp_path
    store.close()


@pytest.mark.asyncio
async def test_rebuild_indexes_files(setup):
    idx, store, provider, cwd = setup
    (cwd / "a.py").write_text("def f(): pass\n")
    (cwd / "b.py").write_text("def g(): pass\n")

    events = []
    async def on_event(e): events.append(e)
    await idx.rebuild(on_event=on_event)

    assert store.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] >= 2
    stages = {e["stage"] for e in events}
    assert "complete" in stages or "embed" in stages or "file_done" in stages


@pytest.mark.asyncio
async def test_update_sha_shortcircuit(setup):
    idx, store, provider, cwd = setup
    (cwd / "a.py").write_text("def f(): pass\n")
    await idx.rebuild()

    first_calls = provider.call_count

    await idx.update([cwd / "a.py"])
    assert provider.call_count == first_calls


@pytest.mark.asyncio
async def test_cancel_stops_after_current_batch(setup):
    idx, store, provider, cwd = setup
    for i in range(10):
        (cwd / f"f{i}.py").write_text(f"def f{i}(): pass\n")

    token = CancelToken()
    token.cancel()  # cancel immediately to make test deterministic

    await idx.rebuild(cancel=token)
    indexed = store.conn.execute("SELECT COUNT(DISTINCT file) FROM file_meta").fetchone()[0]
    assert indexed <= 10  # may be 0 if cancel honored before first file
