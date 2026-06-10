"""grep_code tool: regex search, glob/path safety, result cap."""
import json
from pathlib import Path

import pytest

from services.rag.tools.grep_code import GREP_CODE_SCHEMA, grep_code


class FakeSession:
    def __init__(self, cwd: Path):
        self.cwd = cwd


@pytest.fixture
def session(tmp_path):
    (tmp_path / "a.py").write_text("def login(): pass\ndef logout(): pass\n")
    (tmp_path / "b.txt").write_text("foo\nbar baz\n")
    return FakeSession(tmp_path)


def test_schema_shape():
    s = GREP_CODE_SCHEMA
    assert s["function"]["name"] == "grep_code"
    assert "pattern" in s["function"]["parameters"]["properties"]


@pytest.mark.asyncio
async def test_finds_python_identifier(session):
    out = await grep_code(session, pattern=r"\blogin\b")
    hits = json.loads(out)
    assert isinstance(hits, list)
    assert any("a.py" in h["file"] and h["line"] == 1 for h in hits)


@pytest.mark.asyncio
async def test_glob_restricts(session):
    out = await grep_code(session, pattern="foo", glob="*.py")
    hits = json.loads(out)
    assert hits == []  # b.txt is excluded


@pytest.mark.asyncio
async def test_rejects_traversal_glob(session):
    out = await grep_code(session, pattern="x", glob="../*.py")
    payload = json.loads(out)
    assert payload.get("code") == "INVALID_GLOB"


@pytest.mark.asyncio
async def test_invalid_regex_returns_error(session):
    out = await grep_code(session, pattern="[unclosed")
    payload = json.loads(out)
    assert payload.get("code") == "INVALID_PATTERN"


@pytest.mark.asyncio
async def test_max_results_cap(session):
    big = session.cwd / "many.py"
    big.write_text("\n".join(["xxx"] * 10))
    out = await grep_code(session, pattern="xxx", max_results=3)
    assert len(json.loads(out)) == 3
