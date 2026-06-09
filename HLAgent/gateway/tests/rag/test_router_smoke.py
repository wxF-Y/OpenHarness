"""Smoke test: router endpoints respond with sensible status codes."""
import sys

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("HLAGENT_CONFIG_DIR", str(tmp_path / "hlagent"))
    # ensure clean re-import each session
    for mod in list(sys.modules):
        if mod.startswith("main") or mod.startswith("routers") or mod.startswith("services.rag"):
            sys.modules.pop(mod, None)
    sys.path.insert(0, "HLAgent/gateway")
    from main import app
    return TestClient(app)


def test_status_returns_some_response(client, tmp_path):
    r = client.get("/api/rag/status", params={"cwd": str(tmp_path)})
    # Without OPENAI_API_KEY, expect 409
    assert r.status_code in (200, 400, 409)


def test_search_returns_409_when_no_key(client, tmp_path):
    r = client.post("/api/rag/search", params={"cwd": str(tmp_path)},
                    json={"query": "test"})
    assert r.status_code in (400, 409)


def test_stream_endpoint_exists(client, tmp_path):
    # Just confirm the route exists; SSE streaming under TestClient is awkward,
    # so we settle for status<500 or 409 (no profile).
    r = client.get("/api/rag/stream", params={"cwd": str(tmp_path)},
                   timeout=2.0)
    # Either streaming response (200), or 409 if no profile.
    assert r.status_code in (200, 400, 409)
