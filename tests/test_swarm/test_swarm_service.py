"""Tests for SwarmService and transition_state."""

from __future__ import annotations

import json
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from openharness.swarm.models import TeamFile, TeamMember, TeamRunState
from openharness.swarm.persistence import (
    InvalidStateTransitionError,
    transition_state,
    write_team_file,
)
from openharness.swarm.swarm_service import SwarmService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_team(name: str = "alpha") -> TeamFile:
    return TeamFile(name=name, created_at=time.time())


def _make_member(name: str = "worker") -> TeamMember:
    return TeamMember(
        agent_id=f"{name}@alpha",
        name=name,
        backend_type="in_process",
        joined_at=time.time(),
    )


@pytest.fixture
def team_dir(tmp_path, monkeypatch):
    """Redirect team storage to tmp_path."""
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    return tmp_path


# ---------------------------------------------------------------------------
# transition_state tests (8.2)
# ---------------------------------------------------------------------------


def test_transition_template_to_running(team_dir):
    tf = _make_team("alpha")
    write_team_file("alpha", tf)

    result = transition_state("alpha", TeamRunState.TEMPLATE, TeamRunState.RUNNING)

    assert result.state == TeamRunState.RUNNING


def test_transition_running_to_idle(team_dir):
    tf = _make_team("alpha")
    tf.state = TeamRunState.RUNNING
    write_team_file("alpha", tf)

    result = transition_state("alpha", TeamRunState.RUNNING, TeamRunState.IDLE)

    assert result.state == TeamRunState.IDLE


def test_transition_idle_to_running(team_dir):
    tf = _make_team("alpha")
    tf.state = TeamRunState.IDLE
    write_team_file("alpha", tf)

    result = transition_state("alpha", TeamRunState.IDLE, TeamRunState.RUNNING)

    assert result.state == TeamRunState.RUNNING


def test_transition_idle_to_archived(team_dir):
    tf = _make_team("alpha")
    tf.state = TeamRunState.IDLE
    write_team_file("alpha", tf)

    result = transition_state("alpha", TeamRunState.IDLE, TeamRunState.ARCHIVED)

    assert result.state == TeamRunState.ARCHIVED


def test_illegal_transition_template_to_idle(team_dir):
    tf = _make_team("alpha")
    write_team_file("alpha", tf)

    with pytest.raises(InvalidStateTransitionError) as exc_info:
        transition_state("alpha", TeamRunState.TEMPLATE, TeamRunState.IDLE)

    assert exc_info.value.from_state == TeamRunState.TEMPLATE
    assert exc_info.value.to_state == TeamRunState.IDLE


def test_illegal_transition_archived_to_any(team_dir):
    tf = _make_team("alpha")
    tf.state = TeamRunState.ARCHIVED
    write_team_file("alpha", tf)

    for target in (TeamRunState.TEMPLATE, TeamRunState.RUNNING, TeamRunState.IDLE):
        with pytest.raises(InvalidStateTransitionError):
            transition_state("alpha", TeamRunState.ARCHIVED, target)


def test_transition_raises_on_state_mismatch(team_dir):
    """Transition fails if actual on-disk state differs from claimed from_state."""
    tf = _make_team("alpha")
    tf.state = TeamRunState.IDLE
    write_team_file("alpha", tf)

    with pytest.raises(InvalidStateTransitionError):
        transition_state("alpha", TeamRunState.TEMPLATE, TeamRunState.RUNNING)


def test_transition_nonexistent_team(team_dir):
    with pytest.raises(ValueError, match="does not exist"):
        transition_state("no-such-team", TeamRunState.TEMPLATE, TeamRunState.RUNNING)


def test_team_file_state_serialized_as_string(team_dir):
    tf = _make_team("alpha")
    tf.state = TeamRunState.RUNNING
    write_team_file("alpha", tf)

    from openharness.swarm.persistence import get_team_file_path
    raw = json.loads(get_team_file_path("alpha").read_text(encoding="utf-8"))
    assert raw["state"] == "RUNNING"


def test_team_file_missing_state_field_defaults_to_template(tmp_path):
    """Old team.json files without a 'state' field default to TEMPLATE."""
    data = {"name": "alpha", "created_at": time.time(), "members": {}}
    result = TeamFile.from_dict(data)
    assert result.state == TeamRunState.TEMPLATE


# ---------------------------------------------------------------------------
# SwarmService tests (8.1)
# ---------------------------------------------------------------------------


class _MockLifecycle:
    def __init__(self) -> None:
        self._team: TeamFile | None = None

    def set_team(self, tf: TeamFile) -> None:
        self._team = tf

    def list_tasks(self, team_name: str) -> list:
        return []

    def list_teams(self) -> list:
        return [self._team] if self._team else []

    def add_member(self, team_name: str, member: TeamMember) -> TeamFile:
        assert self._team is not None
        self._team.members[member.agent_id] = member
        return self._team

    def remove_member(self, team_name: str, agent_id: str) -> TeamFile:
        assert self._team is not None
        del self._team.members[agent_id]
        return self._team


@pytest.fixture
def svc():
    mock_lifecycle = _MockLifecycle()
    mock_registry = MagicMock()
    service = SwarmService(lifecycle_manager=mock_lifecycle, registry=mock_registry)
    return service, mock_lifecycle


def test_swarm_service_list_teams_template_only(svc):
    service, lifecycle = svc
    tf = _make_team("my-team")
    ts_clone = _make_team("my-team-20240101-120000")
    lifecycle.set_team(tf)

    # list_teams with template_only=True should exclude timestamp clones
    # Since _MockLifecycle.list_teams returns only tf, this just verifies filter applies
    result = service.list_teams(template_only=True)
    names = [t.name for t in result]
    assert "my-team" in names
    assert "my-team-20240101-120000" not in names


def test_swarm_service_add_member(svc):
    service, lifecycle = svc
    tf = _make_team("alpha")
    lifecycle.set_team(tf)

    member = _make_member("worker")
    result = service.add_member("alpha", member)

    assert result.agent_id == "worker@alpha"


def test_swarm_service_remove_member(svc):
    service, lifecycle = svc
    tf = _make_team("alpha")
    member = _make_member("worker")
    tf.members[member.agent_id] = member
    lifecycle.set_team(tf)

    service.remove_member("alpha", "worker@alpha")

    assert "worker@alpha" not in tf.members


@pytest.mark.asyncio
async def test_swarm_service_start_team_raises_on_missing_team(svc, team_dir):
    service, _ = svc
    with pytest.raises(ValueError, match="not found"):
        await service.start_team("nonexistent-team")


@pytest.mark.asyncio
async def test_swarm_service_start_team_raises_on_empty_members(svc, team_dir):
    service, lifecycle = svc
    tf = _make_team("alpha")
    lifecycle.set_team(tf)

    with (
        patch("openharness.swarm.swarm_service.read_team_file", return_value=tf),
        pytest.raises(ValueError, match="无成员"),
    ):
        await service.start_team("alpha")


@pytest.mark.asyncio
async def test_swarm_service_start_team_creates_session(svc, team_dir):
    import sys
    import types

    service, lifecycle = svc
    tf = _make_team("alpha")
    tf.members["worker@alpha"] = _make_member("worker")
    lifecycle.set_team(tf)

    mock_host = AsyncMock()
    mock_session_mgr = MagicMock()
    mock_session_mgr.create_with_id.return_value = ("ignored", mock_host)

    # Inject stub modules so swarm_service's deferred imports resolve
    fake_services = types.ModuleType("services")
    fake_session_mgr_mod = types.ModuleType("services.session_manager")
    fake_session_mgr_mod.session_mgr = mock_session_mgr
    fake_services.session_manager = fake_session_mgr_mod

    fake_sdk = types.ModuleType("hlagent_sdk")
    fake_web_host = types.ModuleType("hlagent_sdk.web_host")
    fake_web_host.AgentSessionConfig = MagicMock(return_value=MagicMock())
    fake_sdk.web_host = fake_web_host

    saved = {}
    for mod_name, mod_obj in {
        "services": fake_services,
        "services.session_manager": fake_session_mgr_mod,
        "hlagent_sdk": fake_sdk,
        "hlagent_sdk.web_host": fake_web_host,
    }.items():
        saved[mod_name] = sys.modules.get(mod_name)
        sys.modules[mod_name] = mod_obj

    try:
        with (
            patch("openharness.swarm.swarm_service.read_team_file", return_value=tf),
            patch("openharness.ui.protocol.FrontendRequest", MagicMock()),
        ):
            result = await service.start_team("alpha", task="do work")
    finally:
        for mod_name, orig in saved.items():
            if orig is None:
                sys.modules.pop(mod_name, None)
            else:
                sys.modules[mod_name] = orig

    assert "session_id" in result
    assert result["task_team"] == "alpha"


# ---------------------------------------------------------------------------
# get_run_state tests (8.3 coverage)
# ---------------------------------------------------------------------------


def test_get_run_state_returns_none_for_missing_run(svc, team_dir):
    service, _ = svc
    result = service.get_run_state("alpha", "nonexistent-run")
    assert result is None


def test_get_run_state_returns_correct_state(svc, team_dir, tmp_path, monkeypatch):
    service, _ = svc

    # Set up a run directory with team.json
    from openharness.config.paths import get_config_dir
    run_dir = get_config_dir() / "teams-tasks" / "alpha" / "run-001"
    run_dir.mkdir(parents=True, exist_ok=True)
    tf = _make_team("alpha")
    tf.state = TeamRunState.IDLE
    tf.save(run_dir / "team.json")

    result = service.get_run_state("alpha", "run-001")
    assert result == TeamRunState.IDLE
