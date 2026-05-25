"""Tests for the coordinator-mode async-agent drain helper."""

from __future__ import annotations

import pytest

from openharness.ui import coordinator_drain
from openharness.ui.coordinator_drain import (
    drain_coordinator_async_agents,
    pending_async_agent_entries,
)


def test_pending_async_agent_entries_skips_notified_and_missing_id():
    metadata = {
        "async_agent_tasks": [
            {"task_id": "t1", "agent_id": "a1"},
            {"task_id": "t2", "agent_id": "a2", "notification_sent": True},
            {"task_id": "", "agent_id": "a3"},
            "not-a-dict",
        ]
    }
    pending = pending_async_agent_entries(metadata)
    assert [entry["task_id"] for entry in pending] == ["t1"]


def test_pending_async_agent_entries_handles_missing_metadata():
    assert pending_async_agent_entries(None) == []
    assert pending_async_agent_entries({}) == []
    assert pending_async_agent_entries({"async_agent_tasks": "not a list"}) == []


@pytest.mark.asyncio
async def test_drain_returns_immediately_when_no_pending_entries():
    """No pending entries = no follow-up turn, no `Waiting for...` message."""

    class _FakeEngine:
        tool_metadata: dict[str, object] = {}

    class _FakeBundle:
        engine = _FakeEngine()

    announcements: list[str] = []

    async def _print(message: str) -> None:
        announcements.append(message)

    async def _render(_event):  # pragma: no cover - never called in this scenario
        raise AssertionError("render_event must not be invoked when no work is pending")

    await drain_coordinator_async_agents(
        _FakeBundle(),
        prompt_seed="hi",
        print_system=_print,
        render_event=_render,
    )
    assert announcements == []


@pytest.mark.asyncio
async def test_drain_returns_when_bundle_has_no_engine():
    class _NoEngineBundle:
        pass

    async def _print(_message: str) -> None:  # pragma: no cover
        raise AssertionError("print_system must not be invoked")

    async def _render(_event):  # pragma: no cover
        raise AssertionError("render_event must not be invoked")

    await drain_coordinator_async_agents(
        _NoEngineBundle(),
        prompt_seed="hi",
        print_system=_print,
        render_event=_render,
    )


def test_drain_module_exposes_public_api():
    """The drain helpers must keep the public names other modules import."""
    assert callable(coordinator_drain.drain_coordinator_async_agents)
    assert callable(coordinator_drain.pending_async_agent_entries)
    assert callable(coordinator_drain.wait_for_completed_async_agent_entries)
    assert callable(coordinator_drain.format_completed_task_notifications)
    assert callable(coordinator_drain.submit_follow_up)
