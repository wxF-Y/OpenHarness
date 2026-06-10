"""Indexer._candidate_files honors .gitignore and .ragignore."""
import pytest

from services.rag.budget import Budget
from services.rag.indexer import Indexer
from services.rag.store import RagStore


class FakeProvider:
    name = "openai"
    dimensions = 4
    max_batch_tokens = 80_000
    model = "m"

    async def embed(self, texts):
        return [[0.1, 0.2, 0.3, 0.4] for _ in texts]

    async def embed_query(self, text):
        return [0.1, 0.2, 0.3, 0.4]

    async def health_check(self):
        return True, "ok"

    def estimate_cost(self, tokens):
        return 0.001


@pytest.fixture
def idx(tmp_path):
    store = RagStore(tmp_path / "i.db", dimensions=4)
    store.init_schema()
    indexer = Indexer(
        store=store,
        provider=FakeProvider(),
        budget=Budget(store, daily_usd=1.0, over_budget_action="pause"),
        cwd=tmp_path,
    )
    yield indexer, tmp_path
    store.close()


def test_gitignore_excludes(idx):
    indexer, cwd = idx
    (cwd / ".gitignore").write_text("secrets.txt\n")
    (cwd / "a.py").write_text("x")
    (cwd / "secrets.txt").write_text("y")
    files = list(indexer._candidate_files())
    names = [f.name for f in files]
    assert "a.py" in names
    assert "secrets.txt" not in names


def test_ragignore_blocks_directory(idx):
    indexer, cwd = idx
    (cwd / ".gitignore").write_text("")
    (cwd / ".ragignore").write_text("private/\n")
    (cwd / "a.py").write_text("x")
    pdir = cwd / "private"
    pdir.mkdir()
    (pdir / "secret.py").write_text("y")
    files = list(indexer._candidate_files())
    rels = [str(f.relative_to(cwd)).replace("\\", "/") for f in files]
    assert "a.py" in rels
    assert all("private" not in r for r in rels)
