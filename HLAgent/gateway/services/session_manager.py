"""Gateway session manager — maps external session IDs to WebBackendHost instances."""

from __future__ import annotations

from uuid import uuid4

from hlagent_sdk import AgentSessionConfig, WebBackendHost, create_host


class SessionManager:
    """Manages all active WebBackendHost instances keyed by external session_id."""

    def __init__(self) -> None:
        self._sessions: dict[str, WebBackendHost] = {}

    def create(self, config: AgentSessionConfig) -> tuple[str, WebBackendHost]:
        """Create a new session, returning (session_id, host). Host is NOT started yet."""
        session_id = uuid4().hex
        host = create_host(config)
        self._sessions[session_id] = host
        return session_id, host

    def get(self, session_id: str) -> WebBackendHost | None:
        return self._sessions.get(session_id)

    def remove(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def list_ids(self) -> list[str]:
        return list(self._sessions.keys())

    def get_all_ready(self) -> list[tuple[str, WebBackendHost]]:
        return [(sid, h) for sid, h in self._sessions.items() if h.is_ready]


session_mgr = SessionManager()
