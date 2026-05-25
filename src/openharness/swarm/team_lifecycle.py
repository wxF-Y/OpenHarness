"""Persistent team lifecycle management for OpenHarness swarms.

Teams are stored as JSON files on disk:
    <config_dir>/teams/<name>/team.json

This module re-exports data models from models.py and persistence helpers
from persistence.py, and provides TeamLifecycleManager plus cleanup utilities.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from openharness.config.paths import get_config_dir
from openharness.swarm.models import (
    AllowedPath,
    TeamFile,
    TeamMember,
    TeamRunState,
    sanitize_agent_name,
    sanitize_name,
)
from openharness.swarm.persistence import (
    _TEAM_FILE_NAME,
    get_team_file_path,
    read_team_file,
    read_team_file_async,
    write_team_file,
    write_team_file_async,
)

# Re-export so existing imports like ``from openharness.swarm.team_lifecycle import X`` work
__all__ = [
    "AllowedPath",
    "TeamFile",
    "TeamLifecycleManager",
    "TeamMember",
    "TeamRunState",
    "add_hidden_pane_id",
    "cleanup_session_teams",
    "cleanup_team_directories",
    "get_team_file_path",
    "read_team_file",
    "read_team_file_async",
    "register_team_for_session_cleanup",
    "remove_hidden_pane_id",
    "remove_member_by_agent_id",
    "remove_member_from_team",
    "remove_teammate_from_team_file",
    "sanitize_agent_name",
    "sanitize_name",
    "set_member_active",
    "set_member_mode",
    "set_multiple_member_modes",
    "sync_teammate_mode",
    "unregister_team_for_session_cleanup",
    "write_team_file",
    "write_team_file_async",
]


# ---------------------------------------------------------------------------
# Member management helpers (standalone functions)
# ---------------------------------------------------------------------------


def remove_teammate_from_team_file(
    team_name: str,
    identifier: dict[str, str | None],
) -> bool:
    """Remove a teammate from the team file by agent_id or name."""
    agent_id = identifier.get("agent_id")
    name = identifier.get("name")
    if not agent_id and not name:
        return False

    team_file = read_team_file(team_name)
    if not team_file:
        return False

    original_len = len(team_file.members)
    to_remove = [
        k
        for k, m in team_file.members.items()
        if (agent_id and m.agent_id == agent_id) or (name and m.name == name)
    ]
    for k in to_remove:
        del team_file.members[k]

    if len(team_file.members) == original_len:
        return False

    write_team_file(team_name, team_file)
    return True


def add_hidden_pane_id(team_name: str, pane_id: str) -> bool:
    """Add *pane_id* to the hidden panes list in the team file."""
    team_file = read_team_file(team_name)
    if not team_file:
        return False

    if pane_id not in team_file.hidden_pane_ids:
        team_file.hidden_pane_ids.append(pane_id)
        write_team_file(team_name, team_file)
    return True


def remove_hidden_pane_id(team_name: str, pane_id: str) -> bool:
    """Remove *pane_id* from the hidden panes list in the team file."""
    team_file = read_team_file(team_name)
    if not team_file:
        return False

    try:
        team_file.hidden_pane_ids.remove(pane_id)
        write_team_file(team_name, team_file)
    except ValueError:
        pass
    return True


def remove_member_from_team(team_name: str, tmux_pane_id: str) -> bool:
    """Remove a team member by tmux pane ID."""
    team_file = read_team_file(team_name)
    if not team_file:
        return False

    to_remove = [
        k
        for k, m in team_file.members.items()
        if m.tmux_pane_id == tmux_pane_id
    ]
    if not to_remove:
        return False

    for k in to_remove:
        del team_file.members[k]

    try:
        team_file.hidden_pane_ids.remove(tmux_pane_id)
    except ValueError:
        pass

    write_team_file(team_name, team_file)
    return True


def remove_member_by_agent_id(team_name: str, agent_id: str) -> bool:
    """Remove a team member by agent ID."""
    team_file = read_team_file(team_name)
    if not team_file:
        return False

    if agent_id not in team_file.members:
        return False

    del team_file.members[agent_id]
    write_team_file(team_name, team_file)
    return True


# ---------------------------------------------------------------------------
# Mode and active-status helpers
# ---------------------------------------------------------------------------


def set_member_mode(team_name: str, member_name: str, mode: str) -> bool:
    """Set a team member's permission mode."""
    team_file = read_team_file(team_name)
    if not team_file:
        return False

    member = next(
        (m for m in team_file.members.values() if m.name == member_name), None
    )
    if not member:
        return False

    if member.mode == mode:
        return True

    for k, m in team_file.members.items():
        if m.name == member_name:
            team_file.members[k] = TeamMember(
                **{**m.to_dict(), "mode": mode}  # type: ignore[arg-type]
            )
            break

    write_team_file(team_name, team_file)
    return True


def sync_teammate_mode(mode: str, team_name_override: str | None = None) -> None:
    """Sync the current agent's permission mode to the team config file."""
    team_name = team_name_override or os.environ.get("CLAUDE_CODE_TEAM_NAME")
    agent_name = os.environ.get("CLAUDE_CODE_AGENT_NAME")
    if team_name and agent_name:
        set_member_mode(team_name, agent_name, mode)


def set_multiple_member_modes(team_name: str, mode_updates: list[dict[str, str]]) -> bool:
    """Set multiple team members' permission modes in a single atomic write."""
    team_file = read_team_file(team_name)
    if not team_file:
        return False

    update_map = {u["member_name"]: u["mode"] for u in mode_updates}
    any_changed = False

    for k, m in list(team_file.members.items()):
        new_mode = update_map.get(m.name)
        if new_mode is not None and m.mode != new_mode:
            team_file.members[k] = TeamMember(
                **{**m.to_dict(), "mode": new_mode}  # type: ignore[arg-type]
            )
            any_changed = True

    if any_changed:
        write_team_file(team_name, team_file)
    return True


async def set_member_active(team_name: str, member_name: str, is_active: bool) -> None:
    """Set a team member's active status (async)."""
    team_file = await read_team_file_async(team_name)
    if not team_file:
        return

    member = next(
        (m for m in team_file.members.values() if m.name == member_name), None
    )
    if not member:
        return

    if member.is_active == is_active:
        return

    for k, m in list(team_file.members.items()):
        if m.name == member_name:
            team_file.members[k] = TeamMember(
                **{**m.to_dict(), "is_active": is_active}  # type: ignore[arg-type]
            )
            break

    await write_team_file_async(team_name, team_file)


# ---------------------------------------------------------------------------
# Session cleanup tracking
# ---------------------------------------------------------------------------

_session_created_teams: set[str] = set()


def register_team_for_session_cleanup(team_name: str) -> None:
    """Mark a team as created this session so it gets cleaned up on exit."""
    _session_created_teams.add(team_name)


def unregister_team_for_session_cleanup(team_name: str) -> None:
    """Remove a team from session cleanup tracking."""
    _session_created_teams.discard(team_name)


async def _kill_orphaned_teammate_panes(team_name: str) -> None:
    """Best-effort kill of all pane-backed teammate panes for a team."""
    from openharness.swarm.registry import get_backend_registry
    from openharness.swarm.spawn_utils import is_inside_tmux
    from openharness.swarm.types import is_pane_backend

    team_file = read_team_file(team_name)
    if not team_file:
        return

    pane_members = [
        m
        for m in team_file.members.values()
        if m.name != "team-lead"
        and m.tmux_pane_id
        and m.backend_type
        and is_pane_backend(m.backend_type)
    ]
    if not pane_members:
        return

    registry = get_backend_registry()
    use_external_session = not is_inside_tmux()

    async def _kill_one(member: TeamMember) -> None:
        try:
            executor = registry.get_executor(member.backend_type)
            await executor.kill_pane(
                member.tmux_pane_id,
                use_external_session=use_external_session,
            )
        except Exception:
            pass

    await asyncio.gather(*(_kill_one(m) for m in pane_members), return_exceptions=True)


async def cleanup_session_teams() -> None:
    """Clean up all teams created this session that weren't explicitly deleted."""
    if not _session_created_teams:
        return

    teams = list(_session_created_teams)
    await asyncio.gather(
        *(_kill_orphaned_teammate_panes(t) for t in teams),
        return_exceptions=True,
    )
    await asyncio.gather(
        *(cleanup_team_directories(t) for t in teams),
        return_exceptions=True,
    )
    _session_created_teams.clear()


# ---------------------------------------------------------------------------
# Worktree cleanup
# ---------------------------------------------------------------------------


async def _destroy_worktree(worktree_path: str) -> None:
    """Best-effort removal of a git worktree."""
    wt = Path(worktree_path)
    git_file = wt / ".git"
    main_repo_path: str | None = None

    try:
        content = git_file.read_text(encoding="utf-8").strip()
        match = re.match(r"^gitdir:\s*(.+)$", content)
        if match:
            worktree_git_dir = match.group(1)
            main_git_dir = Path(worktree_git_dir) / ".." / ".."
            main_repo_path = str(main_git_dir / "..")
    except OSError:
        pass

    if main_repo_path:
        try:
            result = subprocess.run(
                ["git", "worktree", "remove", "--force", worktree_path],
                cwd=main_repo_path,
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode == 0:
                return
            if "not a working tree" in (result.stderr or ""):
                return
        except (subprocess.SubprocessError, OSError):
            pass

    try:
        shutil.rmtree(worktree_path, ignore_errors=True)
    except OSError:
        pass


async def cleanup_team_directories(team_name: str) -> None:
    """Clean up team and task directories for *team_name*."""
    team_file = read_team_file(team_name)
    worktree_paths: list[str] = []
    if team_file:
        for member in team_file.members.values():
            if member.worktree_path:
                worktree_paths.append(member.worktree_path)

    for wt_path in worktree_paths:
        await _destroy_worktree(wt_path)

    from openharness.swarm.mailbox import get_team_dir
    team_dir = get_team_dir(team_name)
    try:
        shutil.rmtree(team_dir, ignore_errors=True)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# TeamLifecycleManager
# ---------------------------------------------------------------------------


class TeamLifecycleManager:
    """Manage the on-disk lifecycle of swarm teams.

    Stateless: every method reads from and writes to disk directly.
    """

    # ------------------------------------------------------------------
    # Team CRUD
    # ------------------------------------------------------------------

    def create_team(self, name: str, description: str = "") -> TeamFile:
        """Create a new team and persist it to disk."""
        path = get_team_file_path(name)
        if path.exists():
            raise ValueError(f"Team '{name}' already exists at {path}")

        team = TeamFile(
            name=name,
            description=description,
            created_at=time.time(),
        )
        team.save(path)
        return team

    def delete_team(self, name: str) -> None:
        """Remove a team directory and all its contents."""
        from openharness.swarm.mailbox import get_team_dir
        team_dir = get_team_dir(name)
        team_file = team_dir / _TEAM_FILE_NAME
        if not team_file.exists():
            raise ValueError(f"Team '{name}' does not exist")
        shutil.rmtree(team_dir)

    def get_team(self, name: str) -> TeamFile | None:
        """Return the TeamFile for *name*, or ``None`` if it does not exist."""
        path = get_team_file_path(name)
        if not path.exists():
            return None
        try:
            return TeamFile.load(path)
        except (json.JSONDecodeError, KeyError):
            return None

    def list_teams(self) -> list[TeamFile]:
        """Return all teams found in ``<config_dir>/teams/``, sorted by name."""
        base = get_config_dir() / "teams"
        if not base.exists():
            return []

        teams: list[TeamFile] = []
        for team_dir in sorted(base.iterdir()):
            team_file = team_dir / _TEAM_FILE_NAME
            if not team_file.exists():
                continue
            try:
                teams.append(TeamFile.load(team_file))
            except (json.JSONDecodeError, KeyError):
                continue
        return teams

    def list_templates(self) -> list[TeamFile]:
        """Return only template teams (alias for list_teams)."""
        return self.list_teams()

    def list_tasks(self, team_name: str) -> list[dict]:
        """Return all task-run records for a given template team."""
        base = get_config_dir() / "teams-tasks" / team_name
        if not base.exists():
            return []

        results = []
        for run_dir in sorted(base.iterdir(), reverse=True):
            if not run_dir.is_dir():
                continue
            team_file = run_dir / _TEAM_FILE_NAME
            if not team_file.exists():
                continue
            entry: dict = {"run_slug": run_dir.name, "goal": "", "started_at": None, "member_count": 0}
            meta_file = run_dir / "meta.json"
            if meta_file.exists():
                try:
                    meta = json.loads(meta_file.read_text(encoding="utf-8"))
                    entry["goal"] = meta.get("goal", "")
                    entry["started_at"] = meta.get("started_at")
                except Exception:
                    pass
            try:
                tf = TeamFile.load(team_file)
                entry["member_count"] = len(tf.members)
            except Exception:
                pass
            results.append(entry)
        return results

    # ------------------------------------------------------------------
    # Member management
    # ------------------------------------------------------------------

    def add_member(self, team_name: str, member: TeamMember) -> TeamFile:
        """Add *member* to *team_name* and persist."""
        path = get_team_file_path(team_name)
        team = self._require_team(team_name, path)
        team.members[member.agent_id] = member
        team.save(path)
        return team

    def remove_member(self, team_name: str, agent_id: str) -> TeamFile:
        """Remove the member with *agent_id* from *team_name* and persist."""
        path = get_team_file_path(team_name)
        team = self._require_team(team_name, path)
        if agent_id not in team.members:
            raise ValueError(
                f"Agent '{agent_id}' is not a member of team '{team_name}'"
            )
        del team.members[agent_id]
        team.save(path)
        return team

    # ------------------------------------------------------------------
    # Mode helpers (proxy to standalone functions)
    # ------------------------------------------------------------------

    def set_member_mode(self, team_name: str, member_name: str, mode: str) -> bool:
        """Set a team member's permission mode."""
        return set_member_mode(team_name, member_name, mode)

    def update_member_session(self, team_name: str, agent_id: str, session_id: str) -> TeamFile:
        """Set session_id on an existing TeamMember and persist."""
        path = get_team_file_path(team_name)
        team = self._require_team(team_name, path)
        if agent_id not in team.members:
            raise ValueError(f"Agent '{agent_id}' is not a member of team '{team_name}'")
        member = team.members[agent_id]
        team.members[agent_id] = TeamMember(
            **{**member.__dict__, "session_id": session_id}
        )
        team.save(path)
        return team

    async def set_member_active(self, team_name: str, member_name: str, is_active: bool) -> None:
        """Set a team member's active status."""
        await set_member_active(team_name, member_name, is_active)

    def clone_team(self, source_name: str, new_name: str) -> TeamFile:
        """Clone a template team into a new task-run copy."""
        source_path = get_team_file_path(source_name)
        source = self._require_team(source_name, source_path)

        fresh_members = {}
        for agent_id, m in source.members.items():
            new_agent_id = agent_id.replace(f"@{source_name}", f"@{new_name}")
            fresh_members[new_agent_id] = TeamMember(
                agent_id=new_agent_id,
                name=m.name,
                backend_type=m.backend_type,
                joined_at=time.time(),
                agent_type=m.agent_type,
                model=m.model,
                prompt=m.prompt,
                color=m.color,
                plan_mode_required=m.plan_mode_required,
                permissions=list(m.permissions),
                session_id=None,
                task_id=None,
                status="active",
                is_active=True,
            )

        new_team = TeamFile(
            name=new_name,
            created_at=time.time(),
            lead_agent_id=source.lead_agent_id.replace(
                f"@{source_name}", f"@{new_name}"
            ) if source.lead_agent_id else "",
            members=fresh_members,
        )
        new_path = get_team_file_path(new_name)
        new_path.parent.mkdir(parents=True, exist_ok=True)
        new_team.save(new_path)
        return new_team

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _require_team(self, name: str, path: Path) -> TeamFile:
        if not path.exists():
            raise ValueError(f"Team '{name}' does not exist")
        return TeamFile.load(path)
