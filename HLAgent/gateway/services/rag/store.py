"""SQLite + sqlite-vec + FTS5 storage for the RAG index.

This module owns the on-disk schema for the local RAG store: an FTS5
virtual table for lexical search (`chunks`), a sqlite-vec virtual table
for vector search (`vec_chunks`), and supporting bookkeeping tables for
file metadata (`file_meta`), embedding token/cost ledger (`embed_ledger`),
and a generic `meta` key/value table (schema_version, dimensions, ...).

The `RagStore` class opens the database with WAL journaling, loads the
sqlite-vec extension, and creates all schema objects idempotently.
"""
import sqlite3
import struct
from pathlib import Path
from typing import Iterable

import sqlite_vec

CURRENT_SCHEMA_VERSION = 1


def _vec_to_blob(vec: list[float]) -> bytes:
    """Pack a float32 vector into the binary blob layout sqlite-vec expects."""
    return struct.pack(f"{len(vec)}f", *vec)


class RagStore:
    """Owns the SQLite connection and schema for the local RAG index."""

    def __init__(self, db_path: Path, dimensions: int) -> None:
        self.db_path = Path(db_path)
        self.dimensions = dimensions
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        self.conn = sqlite3.connect(str(self.db_path), isolation_level=None)
        self.conn.enable_load_extension(True)
        sqlite_vec.load(self.conn)
        self.conn.enable_load_extension(False)

        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA synchronous = NORMAL")

    def init_schema(self) -> None:
        """Create all tables/indices idempotently and seed meta rows."""
        cur = self.conn

        cur.execute(
            "CREATE TABLE IF NOT EXISTS meta ("
            "k TEXT PRIMARY KEY, "
            "v TEXT NOT NULL"
            ")"
        )
        cur.execute(
            "INSERT OR IGNORE INTO meta(k, v) VALUES (?, ?)",
            ("schema_version", str(CURRENT_SCHEMA_VERSION)),
        )
        cur.execute(
            "INSERT OR IGNORE INTO meta(k, v) VALUES (?, ?)",
            ("dimensions", str(self.dimensions)),
        )

        cur.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5("
            "file UNINDEXED, "
            "lang UNINDEXED, "
            "kind UNINDEXED, "
            "symbol, "
            "parent, "
            "content, "
            "tokens_split, "
            "hash UNINDEXED, "
            "start_line UNINDEXED, "
            "end_line UNINDEXED, "
            "tokenize='porter unicode61'"
            ")"
        )

        cur.execute(
            f"CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0("
            f"embedding float[{self.dimensions}]"
            f")"
        )

        cur.execute(
            "CREATE TABLE IF NOT EXISTS file_meta ("
            "file TEXT PRIMARY KEY, "
            "sha TEXT NOT NULL, "
            "mtime REAL NOT NULL, "
            "chunk_count INTEGER NOT NULL DEFAULT 0, "
            "provider TEXT NOT NULL, "
            "model TEXT NOT NULL, "
            "dimensions INTEGER NOT NULL, "
            "last_indexed REAL NOT NULL, "
            "in_progress INTEGER NOT NULL DEFAULT 0"
            ")"
        )

        cur.execute(
            "CREATE TABLE IF NOT EXISTS embed_ledger ("
            "ts REAL NOT NULL, "
            "tokens INTEGER NOT NULL, "
            "cost_usd REAL NOT NULL, "
            "source TEXT NOT NULL"
            ")"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_ledger_ts ON embed_ledger(ts)"
        )

    def check_dim_consistency(self, dimensions: int) -> bool:
        """Return True if no stored dimension yet, or it matches the given one."""
        row = self.conn.execute(
            "SELECT v FROM meta WHERE k='dimensions'"
        ).fetchone()
        if row is None:
            return True
        try:
            stored = int(row[0])
        except (TypeError, ValueError):
            return False
        return stored == dimensions

    def close(self) -> None:
        self.conn.close()
