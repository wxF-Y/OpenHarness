"""RagStore opens DB, loads sqlite-vec, creates all required tables."""
from pathlib import Path

import pytest

from services.rag.store import RagStore


def test_store_creates_required_tables(tmp_path):
    db_path = tmp_path / "index.db"
    store = RagStore(db_path, dimensions=1536)
    store.init_schema()

    tables = {row[0] for row in store.conn.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') OR sql LIKE '%VIRTUAL%'"
    ).fetchall()}
    assert "chunks" in tables
    assert "vec_chunks" in tables
    assert "file_meta" in tables
    assert "embed_ledger" in tables
    assert "meta" in tables

    v = store.conn.execute("SELECT v FROM meta WHERE k='schema_version'").fetchone()
    assert v == ("1",)

    store.close()


def test_store_dim_consistency_check(tmp_path):
    store = RagStore(tmp_path / "a.db", dimensions=1536)
    store.init_schema()
    assert store.check_dim_consistency(1536) is True
    assert store.check_dim_consistency(1024) is False
    store.close()
