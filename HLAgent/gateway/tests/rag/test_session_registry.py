"""SseBroadcaster fanout + RagSession registry per cwd."""
import asyncio

import pytest

from services.rag.registry import RagRegistry
from services.rag.sse import SseBroadcaster


@pytest.mark.asyncio
async def test_broadcaster_multi_subscriber():
    b = SseBroadcaster()
    s1 = b.subscribe()
    s2 = b.subscribe()
    await b.emit({"hello": 1})
    e1 = await asyncio.wait_for(s1.get(), 1.0)
    e2 = await asyncio.wait_for(s2.get(), 1.0)
    assert e1 == e2 == {"hello": 1}


def test_project_hash_uses_realpath(tmp_path):
    reg = RagRegistry()
    h1 = reg.project_hash(tmp_path)
    h2 = reg.project_hash(tmp_path)
    assert h1 == h2
    assert len(h1) == 12
