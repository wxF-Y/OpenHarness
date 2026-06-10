"""Watcher state machine + debounce + flush."""
import asyncio
from pathlib import Path

import pytest

from services.rag.budget import Budget
from services.rag.indexer import Indexer
from services.rag.store import RagStore
from services.rag.watcher import Watcher


class FakeProvider:
    name = "openai"
    dimensions = 4
    max_batch_tokens = 80_000
    model = "text-embedding-3-small"
    call_count = 0

    async def embed(self, texts):
        FakeProvider.call_count += 1
        return [[0.1, 0.2, 0.3, 0.4] for _ in texts]

    async def embed_query(self, text):
        return [0.1, 0.2, 0.3, 0.4]

    async def health_check(self):
        return True, "ok"

    def estimate_cost(self, tokens):
        return tokens / 1_000_000 * 0.02


@pytest.fixture
def setup(tmp_path):
    store = RagStore(tmp_path / "w.db", dimensions=4)
    store.init_schema()
    idx = Indexer(store=store, provider=FakeProvider(),
                  budget=Budget(store, daily_usd=1.0, over_budget_action="pause"),
                  cwd=tmp_path)
    w = Watcher(idx)
    yield w, tmp_path
    w.stop()
    store.close()


def test_state_transitions(setup):
    w, _ = setup
    assert w.state["state"] == "stopped"
    w.start()
    assert w.state["state"] == "running"
    w.pause("test")
    assert w.state["state"] == "paused"
    assert w.state["reason"] == "test"
    w.resume()
    assert w.state["state"] == "running"
    w.stop()
    assert w.state["state"] == "stopped"


def test_activity_log_recent_first(setup):
    w, _ = setup
    w.start()
    w.pause("x")
    w.resume()
    w.stop()
    entries = w.activity
    assert len(entries) >= 3
    assert entries[0]["stage"] in {"watcher_stopped", "watcher_resumed", "watcher_paused"}


@pytest.mark.asyncio
async def test_modify_triggers_update(setup):
    w, cwd = setup
    w.start()
    await asyncio.sleep(0.1)
    f = cwd / "a.py"
    f.write_text("def f(): pass\n")
    await asyncio.sleep(4.0)
    rows = w.indexer.store.conn.execute(
        "SELECT COUNT(*) FROM file_meta WHERE file='a.py'"
    ).fetchone()
    assert rows[0] >= 1
    w.stop()
