"""Aggregated security checks - identifiers exist + traversal rejected."""
import json
import types

import pytest


def test_api_key_never_in_profile_response_shape():
    """profile_endpoints redact contract excludes api_key.

    Full assertion in test_profile_endpoints.py - this confirms the
    redact helper continues to enforce the contract.
    """
    from routers.rag import _redact

    out = _redact({"id": "x", "api_key": "secret", "name": "n"})
    assert "api_key" not in out
    assert out["has_api_key"] is True


@pytest.mark.asyncio
async def test_read_file_traversal_rejected(tmp_path):
    """read_file refuses ../ traversal even when normalisation would escape cwd."""
    from services.rag.tools.read_file import read_file

    session = types.SimpleNamespace(cwd=tmp_path)
    out = await read_file(session, path="../etc/passwd")
    payload = json.loads(out)
    assert payload.get("code") == "INVALID_PATH"


@pytest.mark.asyncio
async def test_grep_traversal_rejected(tmp_path):
    """grep_code refuses globs with ../ or absolute paths."""
    from services.rag.tools.grep_code import grep_code

    session = types.SimpleNamespace(cwd=tmp_path)
    out = await grep_code(session, pattern="x", glob="../**/*.py")
    payload = json.loads(out)
    assert payload.get("code") == "INVALID_GLOB"


def test_session_injection_module_imports():
    """Ensures session module remains importable - injection tests live in test_session_injection.py."""
    from services.rag.session import RagSession  # noqa: F401

    assert True
