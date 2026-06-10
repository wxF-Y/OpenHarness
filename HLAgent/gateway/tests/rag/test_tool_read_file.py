"""read_file tool: range, safety, truncation."""
import json
from pathlib import Path

import pytest

from services.rag.tools.read_file import READ_FILE_SCHEMA, read_file


class FakeSession:
    def __init__(self, cwd: Path):
        self.cwd = cwd


@pytest.fixture
def session(tmp_path):
    (tmp_path / "a.py").write_text("\n".join(f"line {i}" for i in range(1, 11)))
    return FakeSession(tmp_path)


def test_schema_shape():
    s = READ_FILE_SCHEMA
    assert s["function"]["name"] == "read_file"
    assert "path" in s["function"]["parameters"]["properties"]


@pytest.mark.asyncio
async def test_read_whole_file(session):
    out = await read_file(session, path="a.py")
    payload = json.loads(out)
    assert payload["total_lines"] == 10
    assert payload["content"].startswith("line 1")
    assert payload["content"].endswith("line 10")


@pytest.mark.asyncio
async def test_read_range(session):
    out = await read_file(session, path="a.py", start_line=3, end_line=5)
    payload = json.loads(out)
    assert payload["start_line"] == 3
    assert payload["end_line"] == 5
    assert payload["content"] == "line 3\nline 4\nline 5"


@pytest.mark.asyncio
async def test_rejects_traversal(session):
    out = await read_file(session, path="../etc/passwd")
    payload = json.loads(out)
    assert payload.get("code") == "INVALID_PATH"


@pytest.mark.asyncio
async def test_nonexistent_returns_not_found(session):
    out = await read_file(session, path="missing.py")
    payload = json.loads(out)
    assert payload.get("code") == "NOT_FOUND"
