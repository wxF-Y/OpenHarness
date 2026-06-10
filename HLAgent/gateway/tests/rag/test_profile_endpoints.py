"""Profile CRUD + embed/test smoke."""
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


def test_profile_lifecycle(client):
    # initially empty
    r = client.get("/api/rag/profiles")
    assert r.status_code == 200
    assert r.json() == []

    # create
    r = client.post("/api/rag/profiles", json={
        "name": "My OpenAI", "provider": "openai",
        "model": "text-embedding-3-small", "dimensions": 1536,
        "api_key": "sk-secret",
    })
    assert r.status_code == 200
    body = r.json()
    pid = body["id"]
    assert pid.startswith("emb_openai_")
    assert body.get("has_api_key") is True
    assert "api_key" not in body

    # list
    r = client.get("/api/rag/profiles")
    assert any(p["id"] == pid for p in r.json())

    # patch (rename)
    r = client.patch(f"/api/rag/profiles/{pid}", json={"name": "renamed"})
    assert r.status_code == 200
    assert r.json()["name"] == "renamed"

    # delete
    r = client.delete(f"/api/rag/profiles/{pid}")
    assert r.status_code == 200
    r = client.get("/api/rag/profiles")
    assert all(p["id"] != pid for p in r.json())


def test_embed_test_endpoint_no_provider_key(client):
    r = client.post("/api/rag/embed/test", json={
        "provider": "openai", "model": "text-embedding-3-small",
        "dimensions": 1536,
    })
    body = r.json()
    assert body["ok"] is False  # missing api_key → ValueError caught
