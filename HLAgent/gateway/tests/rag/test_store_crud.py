"""Chunk CRUD + per-batch transaction + SHA short-circuit."""
import pytest

from services.rag.store import RagStore


@pytest.fixture
def store(tmp_path):
    s = RagStore(tmp_path / "index.db", dimensions=4)
    s.init_schema()
    yield s
    s.close()


def _chunk(file="a.py", symbol="f", hash="h1", content="def f(): pass"):
    return {
        "file": file,
        "lang": "python",
        "kind": "function",
        "symbol": symbol,
        "parent": None,
        "content": content,
        "tokens_split": "def f",
        "hash": hash,
        "start_line": 1,
        "end_line": 1,
    }


def test_upsert_inserts_chunks_and_vectors(store):
    chunks = [_chunk()]
    vectors = [[0.1, 0.2, 0.3, 0.4]]
    store.upsert_chunks(
        "a.py", chunks, vectors,
        file_sha="aaa", mtime=1.0,
        provider="openai", model="text-embedding-3-small",
    )
    assert store.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == 1
    assert store.conn.execute("SELECT COUNT(*) FROM vec_chunks").fetchone()[0] == 1
    row = store.conn.execute(
        "SELECT sha, chunk_count, in_progress FROM file_meta WHERE file='a.py'"
    ).fetchone()
    assert row == ("aaa", 1, 0)


def test_delete_file_removes_all_rows(store):
    chunks = [_chunk(), _chunk(symbol="g", hash="h2", content="def g(): pass")]
    vectors = [[0.1, 0.2, 0.3, 0.4], [0.5, 0.6, 0.7, 0.8]]
    store.upsert_chunks("a.py", chunks, vectors,
                        file_sha="aaa", mtime=1.0,
                        provider="openai", model="m")
    store.delete_file("a.py")
    assert store.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == 0
    assert store.conn.execute("SELECT COUNT(*) FROM vec_chunks").fetchone()[0] == 0
    assert store.conn.execute("SELECT COUNT(*) FROM file_meta").fetchone()[0] == 0


def test_purge_all_empties_tables(store):
    chunks = [_chunk()]
    vectors = [[0.1, 0.2, 0.3, 0.4]]
    store.upsert_chunks("a.py", chunks, vectors,
                        file_sha="aaa", mtime=1.0,
                        provider="openai", model="m")
    store.purge_all()
    assert store.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == 0
    assert store.conn.execute("SELECT COUNT(*) FROM file_meta").fetchone()[0] == 0


def test_stats(store):
    chunks = [_chunk()]
    vectors = [[0.1, 0.2, 0.3, 0.4]]
    store.upsert_chunks("a.py", chunks, vectors,
                        file_sha="aaa", mtime=1.0,
                        provider="openai", model="m")
    s = store.stats()
    assert s["files"] == 1
    assert s["chunks"] == 1


def test_orphan_in_progress_detection(store):
    store.conn.execute(
        "INSERT INTO file_meta(file,sha,mtime,chunk_count,provider,model,dimensions,last_indexed,in_progress) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        ("b.py", "bbb", 1.0, 0, "openai", "m", 4, 1.0, 1),
    )
    orphans = store.list_in_progress_files()
    assert orphans == ["b.py"]
