"""Local provider — structural smoke (sentence-transformers may be absent)."""
import pytest

from services.rag.providers.local_provider import LocalProvider


@pytest.mark.asyncio
async def test_health_check_without_extras_returns_false():
    """When extras aren't installed, health_check fails gracefully."""
    p = LocalProvider(model="BAAI/bge-small-en", dimensions=384)
    ok, msg = await p.health_check()
    if not ok:
        assert "sentence-transformers" in msg or "embed-local" in msg


def test_default_device_auto():
    p = LocalProvider(model="x", dimensions=1)
    d = p._detect_device()
    assert d in {"cpu", "cuda", "mps"}


def test_estimate_cost_zero():
    p = LocalProvider(model="x", dimensions=1)
    assert p.estimate_cost(1_000_000) == 0.0
