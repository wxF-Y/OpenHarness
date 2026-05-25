"""Data models for the OpenHarness swarm subsystem.

Contains all dataclasses and enums shared across team_lifecycle,
persistence, and swarm_service modules.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal

from openharness.swarm.types import BackendType


# ---------------------------------------------------------------------------
# Name sanitisation (matching TS sanitizeName / sanitizeAgentName)
# ---------------------------------------------------------------------------


def sanitize_name(name: str) -> str:
    """Replace all non-alphanumeric characters with hyphens and lowercase."""
    import re
    return re.sub(r"[^a-zA-Z0-9]", "-", name).lower()


def sanitize_agent_name(name: str) -> str:
    """Replace ``@`` with ``-`` to avoid ambiguity in agentName@teamName format."""
    return name.replace("@", "-")


# ---------------------------------------------------------------------------
# TeamRunState state machine
# ---------------------------------------------------------------------------


class TeamRunState(str, Enum):
    """Explicit lifecycle states for a team run.

    TEMPLATE  — team configuration only, never been run
    RUNNING   — Leader session is executing
    IDLE      — Leader completed, members may still be alive
    ARCHIVED  — finalized, no further runs allowed
    """

    TEMPLATE = "TEMPLATE"
    RUNNING = "RUNNING"
    IDLE = "IDLE"
    ARCHIVED = "ARCHIVED"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class AllowedPath:
    """A path that all team members can edit without asking for permission."""

    path: str
    """Absolute directory path."""

    tool_name: str
    """The tool this applies to (e.g. 'Edit', 'Write')."""

    added_by: str
    """Agent name who added this rule."""

    added_at: float = field(default_factory=time.time)
    """Timestamp when the rule was added."""

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "tool_name": self.tool_name,
            "added_by": self.added_by,
            "added_at": self.added_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AllowedPath":
        return cls(
            path=data["path"],
            tool_name=data.get("tool_name", data.get("toolName", "")),
            added_by=data.get("added_by", data.get("addedBy", "")),
            added_at=data.get("added_at", data.get("addedAt", time.time())),
        )


@dataclass
class TeamMember:
    """A member of a swarm team."""

    agent_id: str
    name: str
    backend_type: BackendType
    joined_at: float

    agent_type: str | None = None
    model: str | None = None
    prompt: str | None = None
    color: str | None = None
    plan_mode_required: bool = False
    session_id: str | None = None
    task_id: str | None = None
    subscriptions: list[str] = field(default_factory=list)
    is_active: bool = True
    mode: str | None = None
    tmux_pane_id: str = ""
    cwd: str = ""
    worktree_path: str | None = None
    permissions: list[str] = field(default_factory=list)
    status: Literal["active", "idle", "stopped"] = "active"

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "name": self.name,
            "backend_type": self.backend_type,
            "joined_at": self.joined_at,
            "agent_type": self.agent_type,
            "model": self.model,
            "prompt": self.prompt,
            "color": self.color,
            "plan_mode_required": self.plan_mode_required,
            "session_id": self.session_id,
            "task_id": self.task_id,
            "subscriptions": self.subscriptions,
            "is_active": self.is_active,
            "mode": self.mode,
            "tmux_pane_id": self.tmux_pane_id,
            "cwd": self.cwd,
            "worktree_path": self.worktree_path,
            "permissions": self.permissions,
            "status": self.status,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TeamMember":
        def _clean(s: str | None) -> str | None:
            if s is None:
                return None
            return s.encode("utf-8", errors="replace").decode("utf-8")

        return cls(
            agent_id=data["agent_id"],
            name=data["name"],
            backend_type=data["backend_type"],
            joined_at=data["joined_at"],
            agent_type=data.get("agent_type"),
            model=data.get("model"),
            prompt=_clean(data.get("prompt")),
            color=data.get("color"),
            plan_mode_required=data.get("plan_mode_required", False),
            session_id=data.get("session_id"),
            task_id=data.get("task_id"),
            subscriptions=data.get("subscriptions", []),
            is_active=data.get("is_active", True),
            mode=data.get("mode"),
            tmux_pane_id=data.get("tmux_pane_id", ""),
            cwd=data.get("cwd", ""),
            worktree_path=data.get("worktree_path"),
            permissions=data.get("permissions", []),
            status=data.get("status", "active"),
        )


@dataclass
class TeamFile:
    """Persistent team metadata stored as team.json inside the team directory."""

    name: str
    created_at: float

    description: str = ""
    lead_agent_id: str = ""
    lead_session_id: str | None = None
    hidden_pane_ids: list[str] = field(default_factory=list)
    members: dict[str, TeamMember] = field(default_factory=dict)
    team_allowed_paths: list[AllowedPath] = field(default_factory=list)
    allowed_paths: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    state: TeamRunState = TeamRunState.TEMPLATE

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "created_at": self.created_at,
            "lead_agent_id": self.lead_agent_id,
            "lead_session_id": self.lead_session_id,
            "hidden_pane_ids": self.hidden_pane_ids,
            "members": {k: v.to_dict() for k, v in self.members.items()},
            "team_allowed_paths": [p.to_dict() for p in self.team_allowed_paths],
            "allowed_paths": self.allowed_paths,
            "metadata": self.metadata,
            "state": self.state.value,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TeamFile":
        members = {
            k: TeamMember.from_dict(v)
            for k, v in data.get("members", {}).items()
        }
        team_allowed_paths = [
            AllowedPath.from_dict(p)
            for p in data.get("team_allowed_paths", [])
        ]
        raw_state = data.get("state", TeamRunState.TEMPLATE.value)
        try:
            state = TeamRunState(raw_state)
        except ValueError:
            state = TeamRunState.TEMPLATE
        return cls(
            name=data["name"],
            description=data.get("description", ""),
            created_at=data["created_at"],
            lead_agent_id=data.get("lead_agent_id", ""),
            lead_session_id=data.get("lead_session_id"),
            hidden_pane_ids=data.get("hidden_pane_ids", []),
            members=members,
            team_allowed_paths=team_allowed_paths,
            allowed_paths=data.get("allowed_paths", []),
            metadata=data.get("metadata", {}),
            state=state,
        )

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, path: "Path") -> None:
        """Atomically write this team file to *path*."""
        import json
        from pathlib import Path as _Path
        _Path(path).parent.mkdir(parents=True, exist_ok=True)
        tmp = _Path(path).with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    @classmethod
    def load(cls, path: "Path") -> "TeamFile":
        """Load a TeamFile from *path*.

        Raises:
            FileNotFoundError: if *path* does not exist.
            json.JSONDecodeError: if the file is not valid JSON.
        """
        import json
        from pathlib import Path as _Path
        data = json.loads(_Path(path).read_text(encoding="utf-8"))
        return cls.from_dict(data)
