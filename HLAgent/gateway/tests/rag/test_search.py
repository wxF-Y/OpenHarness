"""Hybrid search: BM25 + vector + RRF fusion + dimension check."""
from pathlib import Path

import pytest

from services.rag.search import Searcher, IndexDimMismatchError
from services.rag.store import RagStore


class FakeProvider:
    name = "openai"
    dimensions = 4

    async def embed_query(self, text):
        if text == "auth":
            return [1.0, 0.0, 0.0, 0.0]
        return [0.0, 0.0, 1.0, 0.0]


@pytest.fixture
def populated(tmp_path):
    s = RagStore(tmp_path / "z.db", dimensions=4)
    s.init_schema()
    data = [
        ("a.py", "validateUser", "validateUser auth password", [1.0, 0.0, 0.0, 0.0]),
        ("b.py", "loadConfig", "loadConfig load config", [0.0, 0.0, 1.0, 0.0]),
        ("c.py", "checkPassword", "checkPassword check Password auth", [0.5, 0.0, 0.5, 0.0]),
    ]
    for file, sym, tokens_split, vec in data:
        ch = {"file": file, "lang": "python", "kind": "function",
              "symbol": sym, "parent": None,
              "content": f"def {sym}(): pass",
              "tokens_split": tokens_split,
              "hash": sym, "start_line": 1, "end_line": 1}
        s.upsert_chunks(file, [ch], [vec], file_sha=sym, mtime=1.0,
                        provider="openai", model="m")
    yield s
    s.close()


@pytest.mark.asyncio
async def test_hybrid_returns_top_k(populated):
    se = Searcher(store=populated, provider=FakeProvider())
    results = await se.hybrid_search("auth", top_k=2)
    assert len(results) == 2
    assert all("score" in r for r in results)
    assert all("file" in r for r in results)


@pytest.mark.asyncio
async def test_hybrid_orders_by_rrf(populated):
    se = Searcher(store=populated, provider=FakeProvider())
    results = await se.hybrid_search("auth", top_k=3)
    files = [r["file"] for r in results]
    assert "b.py" not in files[:2]


@pytest.mark.asyncio
async def test_dim_mismatch_raises(tmp_path):
    s = RagStore(tmp_path / "zz.db", dimensions=4)
    s.init_schema()
    se = Searcher(store=s, provider=FakeProvider())
    s.conn.execute(
        "INSERT INTO file_meta(file,sha,mtime,chunk_count,provider,model,dimensions,last_indexed,in_progress) "
        "VALUES('x',?,1,1,'openai','m',1024,1,0)", ("h",))
    with pytest.raises(IndexDimMismatchError):
        await se.hybrid_search("auth")
    s.close()
