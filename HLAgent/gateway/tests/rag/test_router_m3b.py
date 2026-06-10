"""Smoke tests for M3b new endpoints: /ignore CRUD, /purge, /watcher/toggle."""
import sys

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("HLAGENT_CONFIG_DIR", str(tmp_path / "h"))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-fake")
    for m in list(sys.modules):
        if m.startswith("main") or m.startswith("routers") or m.startswith("services.rag"):
            sys.modules.pop(m, None)
    sys.path.insert(0, "HLAgent/gateway")
    from main import app
    return TestClient(app)


def test_ignore_get_empty_then_put(client, tmp_path):
    r = client.get("/api/rag/ignore", params={"cwd": str(tmp_path)})
    assert r.status_code == 200
    assert r.json() == {"content": "", "exists": False}

    r = client.put(
        "/api/rag/ignore",
        params={"cwd": str(tmp_path)},
        json={"content": "node_modules\ndist\n"},
    )
    assert r.status_code == 200
    assert r.json()["saved"] is True

    r = client.get("/api/rag/ignore", params={"cwd": str(tmp_path)})
    body = r.json()
    assert body["exists"] is True
    assert "node_modules" in body["content"]


def test_purge_deletes_db(client, tmp_path):
    # Single request — first call creates the session, purge tears it down
    # in the same worker thread so the SQLite handle stays thread-affine.
    r = client.post("/api/rag/purge", params={"cwd": str(tmp_path)})
    assert r.status_code == 200
    assert r.json()["purged"] is True


def test_watcher_toggle(client, tmp_path):
    r = client.post(
        "/api/rag/watcher/toggle",
        params={"cwd": str(tmp_path)},
        json={"enabled": True},
    )
    assert r.status_code == 200
    assert r.json()["state"] in ("running", "paused")
    r = client.post(
        "/api/rag/watcher/toggle",
        params={"cwd": str(tmp_path)},
        json={"enabled": False},
    )
    assert r.status_code == 200
    assert r.json()["state"] == "stopped"
