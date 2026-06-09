"""search_codebase tool returns structured JSON on success / error."""
import json

import pytest

from services.rag.tools.search_codebase import (
    SEARCH_CODEBASE_SCHEMA,
    search_codebase,
)


class FakeSession:
    def __init__(self, results=None, err=None):
        self._results = results or []
        self._err = err

    class _Searcher:
        def __init__(self, results, err):
            self._results = results
            self._err = err

        async def hybrid_search(self, query, top_k=8):
            if self._err:
                raise self._err
            return self._results

    @property
    def searcher(self):
        return self._Searcher(self._results, self._err)


@pytest.mark.asyncio
async def test_search_codebase_returns_json_array():
    sess = FakeSession(results=[
        {"file": "a.py", "lang": "python", "kind": "function",
         "symbol": "f", "start_line": 1, "end_line": 2,
         "content": "def f(): pass", "score": 1.0},
    ])
    out = await search_codebase(sess, query="f", top_k=8)
    arr = json.loads(out)
    assert isinstance(arr, list) and len(arr) == 1
    assert arr[0]["file"] == "a.py"


@pytest.mark.asyncio
async def test_search_codebase_returns_error_envelope_on_failure():
    sess = FakeSession(err=RuntimeError("oops"))
    out = await search_codebase(sess, query="x", top_k=8)
    payload = json.loads(out)
    assert "error" in payload
    assert "code" in payload


def test_tool_schema_shape():
    s = SEARCH_CODEBASE_SCHEMA
    assert s["type"] == "function"
    assert s["function"]["name"] == "search_codebase"
    props = s["function"]["parameters"]["properties"]
    assert "query" in props
    assert "top_k" in props
