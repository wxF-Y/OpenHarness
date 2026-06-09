"""Hybrid retrieval: BM25 + vector, fused with RRF.

Returns top-K with normalized score in [0, 1]. Raises on dimension mismatch
between active provider and stored vectors.
"""
from __future__ import annotations


class IndexDimMismatchError(Exception):
    """Raised when active provider's dim differs from stored vectors' dim."""


class Searcher:
    def __init__(self, *, store, provider):
        self.store = store
        self.provider = provider

    async def hybrid_search(self, query: str, top_k: int = 8) -> list[dict]:
        rows = self.store.conn.execute(
            "SELECT DISTINCT dimensions FROM file_meta"
        ).fetchall()
        if rows:
            stored_dims = {r[0] for r in rows}
            if self.provider.dimensions not in stored_dims:
                raise IndexDimMismatchError(
                    f"Provider dim {self.provider.dimensions} not in stored dims {stored_dims}"
                )

        # sqlite3 connections are single-threaded; keep DB calls on this loop's thread.
        bm25 = self.store.bm25_search(query, 50)
        query_vec = await self.provider.embed_query(query)
        vector = self.store.vector_search(query_vec, 50)

        fused: dict[int, float] = {}
        k = 60
        for rank, r in enumerate(bm25):
            fused[r["rowid"]] = fused.get(r["rowid"], 0.0) + 1.0 / (k + rank)
        for rank, r in enumerate(vector):
            fused[r["rowid"]] = fused.get(r["rowid"], 0.0) + 1.0 / (k + rank)
        meta = {r["rowid"]: r for r in (bm25 + vector)}
        ordered = sorted(fused.items(), key=lambda x: x[1], reverse=True)[:top_k]
        max_score = ordered[0][1] if ordered else 1.0
        out = []
        for rowid, score in ordered:
            m = meta[rowid]
            out.append({
                "file": m["file"], "lang": m["lang"], "kind": m["kind"],
                "symbol": m["symbol"], "parent": m.get("parent"),
                "start_line": m["start_line"], "end_line": m["end_line"],
                "content": m["content"],
                "score": round(score / max_score, 4),
            })
        return out
