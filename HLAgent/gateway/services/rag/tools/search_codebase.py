"""search_codebase Agent tool wrapper.

Returns a JSON string for both success (array of hits) and failure
({error, code, hint}). Never raises to the caller.
"""
from __future__ import annotations

import json

from ..search import IndexDimMismatchError


SEARCH_CODEBASE_SCHEMA = {
    "type": "function",
    "function": {
        "name": "search_codebase",
        "description": (
            "Semantic + keyword hybrid search over the indexed project "
            "codebase. Returns top matches with file path, line range, "
            "code snippet, and relevance score."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string",
                          "description": "Natural-language or code query."},
                "top_k": {"type": "integer", "default": 8,
                          "description": "Number of results (1-50)."},
            },
            "required": ["query"],
        },
    },
}


async def search_codebase(session, *, query: str, top_k: int = 8) -> str:
    """Execute hybrid_search and return a JSON-encoded result string."""
    top_k = max(1, min(50, int(top_k)))
    try:
        results = await session.searcher.hybrid_search(query, top_k=top_k)
        return json.dumps(results, ensure_ascii=False)
    except IndexDimMismatchError as exc:
        return json.dumps({
            "error": str(exc),
            "code": "INDEX_DIM_MISMATCH",
            "hint": "切换 embed provider 后请在 /rag 页面重建索引。",
        }, ensure_ascii=False)
    except Exception as exc:
        return json.dumps({
            "error": f"{type(exc).__name__}: {exc}",
            "code": "PROVIDER_ERROR",
            "hint": "检查 /rag 页面 provider 健康状态。",
        }, ensure_ascii=False)
