"""POST /api/rag/cancel toggles the active CancelToken."""
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


def test_cancel_no_active_job(client, tmp_path):
    r = client.post("/api/rag/cancel", params={"cwd": str(tmp_path)})
    assert r.status_code == 200
    body = r.json()
    assert body["cancelled"] is False


def test_cancel_endpoint_exists(client, tmp_path):
    r = client.post("/api/rag/cancel", params={"cwd": str(tmp_path)})
    assert r.status_code in (200, 409)
