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

    def upsert_chunks(
        self,
        file: str,
        chunks: list[dict],
        vectors: list[list[float]],
        *,
        file_sha: str,
        mtime: float,
        provider: str,
        model: str,
    ) -> None:
        """Upsert chunks for one file in a single transaction.

        Crash recovery: file_meta.in_progress is set to 1 before chunk writes
        and cleared at COMMIT. Orphans (in_progress=1) detected at startup
        via list_in_progress_files() and reindexed.
        """
        import time
        assert len(chunks) == len(vectors), "chunks/vectors length mismatch"

        c = self.conn
        c.execute("BEGIN")
        try:
            c.execute(
                "INSERT INTO file_meta(file,sha,mtime,chunk_count,provider,model,dimensions,last_indexed,in_progress) "
                "VALUES(?,?,?,?,?,?,?,?,1) "
                "ON CONFLICT(file) DO UPDATE SET in_progress=1",
                (file, file_sha, mtime, len(chunks), provider, model, self.dimensions, time.time()),
            )
            old_ids = [
                r[0] for r in c.execute(
                    "SELECT rowid FROM chunks WHERE file=?", (file,)
                ).fetchall()
            ]
            for rid in old_ids:
                c.execute("DELETE FROM chunks WHERE rowid=?", (rid,))
                c.execute("DELETE FROM vec_chunks WHERE rowid=?", (rid,))

            for ch, vec in zip(chunks, vectors):
                cur = c.execute(
                    "INSERT INTO chunks(file,lang,kind,symbol,parent,content,tokens_split,hash,start_line,end_line) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (ch["file"], ch["lang"], ch["kind"], ch.get("symbol"),
                     ch.get("parent"), ch["content"], ch.get("tokens_split", ""),
                     ch["hash"], ch["start_line"], ch["end_line"]),
                )
                rid = cur.lastrowid
                c.execute(
                    "INSERT INTO vec_chunks(rowid, embedding) VALUES(?, ?)",
                    (rid, _vec_to_blob(vec)),
                )

            c.execute(
                "UPDATE file_meta SET sha=?, mtime=?, chunk_count=?, "
                "provider=?, model=?, dimensions=?, last_indexed=?, in_progress=0 "
                "WHERE file=?",
                (file_sha, mtime, len(chunks), provider, model,
                 self.dimensions, time.time(), file),
            )
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise

    def delete_file(self, file: str) -> None:
        c = self.conn
        c.execute("BEGIN")
        try:
            old_ids = [
                r[0] for r in c.execute(
                    "SELECT rowid FROM chunks WHERE file=?", (file,)
                ).fetchall()
            ]
            for rid in old_ids:
                c.execute("DELETE FROM chunks WHERE rowid=?", (rid,))
                c.execute("DELETE FROM vec_chunks WHERE rowid=?", (rid,))
            c.execute("DELETE FROM file_meta WHERE file=?", (file,))
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise

    def purge_all(self) -> None:
        c = self.conn
        c.execute("BEGIN")
        try:
            c.execute("DELETE FROM chunks")
            c.execute("DELETE FROM vec_chunks")
            c.execute("DELETE FROM file_meta")
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise

    def stats(self) -> dict:
        c = self.conn
        files = c.execute("SELECT COUNT(*) FROM file_meta").fetchone()[0]
        chunks = c.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
        last = c.execute("SELECT MAX(last_indexed) FROM file_meta").fetchone()[0]
        return {
            "files": files,
            "chunks": chunks,
            "dimensions": self.dimensions,
            "last_indexed": last,
            "db_path": str(self.db_path),
        }

    def list_in_progress_files(self) -> list[str]:
        return [
            r[0] for r in self.conn.execute(
                "SELECT file FROM file_meta WHERE in_progress=1"
            ).fetchall()
        ]

    def get_file_sha(self, file: str) -> str | None:
        row = self.conn.execute(
            "SELECT sha FROM file_meta WHERE file=?", (file,)
        ).fetchone()
        return row[0] if row else None

    def get_chunk_hashes(self, file: str) -> set[str]:
        return {
            r[0] for r in self.conn.execute(
                "SELECT hash FROM chunks WHERE file=?", (file,)
            ).fetchall()
        }

    def bm25_search(self, query: str, limit: int = 50) -> list[dict]:
        """FTS5 BM25 search across content + tokens_split."""
        safe = '"' + query.replace('"', '""') + '"'
        rows = self.conn.execute(
            "SELECT rowid, file, lang, kind, symbol, parent, content, "
            "start_line, end_line, bm25(chunks) AS score "
            "FROM chunks WHERE chunks MATCH ? "
            "ORDER BY score LIMIT ?",
            (safe, limit),
        ).fetchall()
        cols = ["rowid", "file", "lang", "kind", "symbol", "parent",
                "content", "start_line", "end_line", "score"]
        out = []
        for r in rows:
            d = dict(zip(cols, r))
            d["score"] = -d["score"]
            out.append(d)
        return out

    def vector_search(self, query_vec: list[float], limit: int = 50) -> list[dict]:
        """sqlite-vec cosine KNN. Returns rows with distance (lower = closer)."""
        blob = _vec_to_blob(query_vec)
        try:
            rows = self.conn.execute(
                "SELECT v.rowid AS rid, v.distance AS dist, "
                "c.file, c.lang, c.kind, c.symbol, c.parent, "
                "c.content, c.start_line, c.end_line "
                "FROM vec_chunks v "
                "JOIN chunks c ON c.rowid = v.rowid "
                "WHERE v.embedding MATCH ? AND k = ? "
                "ORDER BY v.distance",
                (blob, limit),
            ).fetchall()
        except sqlite3.OperationalError:
            # Fallback for sqlite-vec versions that don't accept the `k` clause.
            rows = self.conn.execute(
                "SELECT v.rowid AS rid, v.distance AS dist, "
                "c.file, c.lang, c.kind, c.symbol, c.parent, "
                "c.content, c.start_line, c.end_line "
                "FROM vec_chunks v "
                "JOIN chunks c ON c.rowid = v.rowid "
                "WHERE v.embedding MATCH ? "
                "ORDER BY v.distance LIMIT ?",
                (blob, limit),
            ).fetchall()
        cols = ["rowid", "distance", "file", "lang", "kind", "symbol",
                "parent", "content", "start_line", "end_line"]
        return [dict(zip(cols, r)) for r in rows]

    def close(self) -> None:
        self.conn.close()
