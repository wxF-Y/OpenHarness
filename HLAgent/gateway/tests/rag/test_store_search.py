"""BM25 + vector search on RagStore."""
import pytest

from services.rag.store import RagStore


@pytest.fixture
def store_with_data(tmp_path):
    s = RagStore(tmp_path / "i.db", dimensions=4)
    s.init_schema()
    rows = [
        {"file": "a.py", "symbol": "validateUser", "hash": "h1",
         "content": "def validateUser(password): return True",
         "tokens_split": "def validateUser validate User password"},
        {"file": "b.py", "symbol": "checkPassword", "hash": "h2",
         "content": "def checkPassword(): return False",
         "tokens_split": "def checkPassword check Password"},
        {"file": "c.py", "symbol": "loadConfig", "hash": "h3",
         "content": "def loadConfig(): return {}",
         "tokens_split": "def loadConfig load Config"},
    ]
    vecs = [
        [1.0, 0.0, 0.0, 0.0],
        [0.9, 0.1, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
    ]
    for r, v in zip(rows, vecs):
        chunk = {**r, "lang": "python", "kind": "function", "parent": None,
                 "start_line": 1, "end_line": 1}
        s.upsert_chunks(r["file"], [chunk], [v], file_sha=r["hash"],
                        mtime=1.0, provider="openai", model="m")
    yield s
    s.close()


def test_bm25_search_camelcase_via_tokens_split(store_with_data):
    """BM25 hits 'User' via tokens_split column."""
    results = store_with_data.bm25_search("User", limit=10)
    files = [r["file"] for r in results]
    assert "a.py" in files, f"expected a.py in {files}"


def test_bm25_search_returns_rank_and_meta(store_with_data):
    results = store_with_data.bm25_search("password", limit=10)
    assert len(results) >= 1
    r = results[0]
    assert "rowid" in r
    assert "score" in r
    assert "file" in r


def test_vector_search_returns_distance_sorted(store_with_data):
    """Query near a.py's vector returns it first."""
    results = store_with_data.vector_search([1.0, 0.0, 0.0, 0.0], limit=2)
    assert len(results) == 2
    assert results[0]["file"] == "a.py"
