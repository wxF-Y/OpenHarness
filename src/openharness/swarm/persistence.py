"""File I/O for swarm team.json persistence.

Provides atomic read/write helpers for TeamFile objects.
All disk operations use tmp-then-replace for crash safety.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from openharness.swarm.models import TeamFile, TeamRunState

_TEAM_FILE_NAME = "team.json"


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------


def get_team_file_path(team_name: str) -> Path:
    """Return the path to the team.json for *team_name*."""
    from openharness.swarm.mailbox import get_team_dir
    return get_team_dir(team_name) / _TEAM_FILE_NAME


# ---------------------------------------------------------------------------
# Synchronous read/write
# ---------------------------------------------------------------------------


def read_team_file(team_name: str) -> TeamFile | None:
    """Read and return the TeamFile for *team_name*, or ``None`` if missing."""
    path = get_team_file_path(team_name)
    if not path.exists():
        return None
    try:
        return TeamFile.load(path)
    except (json.JSONDecodeError, KeyError):
        return None


def write_team_file(team_name: str, team_file: TeamFile) -> None:
    """Persist *team_file* to disk (synchronous, atomic)."""
    team_file.save(get_team_file_path(team_name))


# ---------------------------------------------------------------------------
# Async read/write
# ---------------------------------------------------------------------------


async def read_team_file_async(team_name: str) -> TeamFile | None:
    """Async wrapper around :func:`read_team_file`."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, read_team_file, team_name)


async def write_team_file_async(team_name: str, team_file: TeamFile) -> None:
    """Async wrapper around :func:`write_team_file`."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, write_team_file, team_name, team_file)


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------

_VALID_TRANSITIONS: dict[TeamRunState, set[TeamRunState]] = {
    TeamRunState.TEMPLATE: {TeamRunState.RUNNING},
    TeamRunState.RUNNING: {TeamRunState.IDLE},
    TeamRunState.IDLE: {TeamRunState.RUNNING, TeamRunState.ARCHIVED},
    TeamRunState.ARCHIVED: set(),
}


class InvalidStateTransitionError(ValueError):
    """Raised when an illegal TeamRunState transition is attempted."""

    def __init__(self, from_state: TeamRunState, to_state: TeamRunState) -> None:
        super().__init__(
            f"Invalid state transition: {from_state.value} → {to_state.value}"
        )
        self.from_state = from_state
        self.to_state = to_state


def transition_state(team_name: str, from_state: TeamRunState, to_state: TeamRunState) -> TeamFile:
    """Atomically transition team *team_name* from *from_state* to *to_state*.

    Raises:
        ValueError: if the team does not exist.
        InvalidStateTransitionError: if the transition is not permitted.
    """
    allowed = _VALID_TRANSITIONS.get(from_state, set())
    if to_state not in allowed:
        raise InvalidStateTransitionError(from_state, to_state)

    team_file = read_team_file(team_name)
    if team_file is None:
        raise ValueError(f"Team '{team_name}' does not exist")

    if team_file.state != from_state:
        raise InvalidStateTransitionError(team_file.state, to_state)

    team_file.state = to_state
    write_team_file(team_name, team_file)
    return team_file
