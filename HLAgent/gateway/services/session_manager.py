"""Gateway session manager — maps external session IDs to WebBackendHost instances."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from uuid import uuid4

from hlagent_sdk import AgentSessionConfig, WebBackendHost, create_host


@dataclass
class SessionEntry:
    host: WebBackendHost
    created_at: float = field(default_factory=time.time)
    cwd: str | None = None
    model: str | None = None
    expert_role: str | None = None
    expert_role_label: str | None = None
    active_profile: str | None = None


class SessionManager:
    """Manages all active WebBackendHost instances keyed by external session_id."""

    def __init__(self) -> None:
        self._sessions: dict[str, SessionEntry] = {}

    def create(self, config: AgentSessionConfig) -> tuple[str, WebBackendHost]:
        """Create a new session, returning (session_id, host). Host is NOT started yet."""
        session_id = uuid4().hex
        return self.create_with_id(session_id, config)

    def create_with_id(self, session_id: str, config: AgentSessionConfig,
                       expert_role: str | None = None,
                       expert_role_label: str | None = None) -> tuple[str, WebBackendHost]:
        """Create a new session with a pre-generated session_id."""
        host = create_host(config)
        self._sessions[session_id] = SessionEntry(
            host=host,
            cwd=config.cwd,
            model=config.model,
            expert_role=expert_role,
            expert_role_label=expert_role_label,
        )
        return session_id, host

    def get(self, session_id: str) -> WebBackendHost | None:
        entry = self._sessions.get(session_id)
        return entry.host if entry else None

    def get_entry(self, session_id: str) -> SessionEntry | None:
        return self._sessions.get(session_id)

    def remove(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def list_ids(self) -> list[str]:
        return list(self._sessions.keys())

    def get_all_ready(self) -> list[tuple[str, WebBackendHost]]:
        return [(sid, e.host) for sid, e in self._sessions.items() if e.host.is_ready]


session_mgr = SessionManager()
