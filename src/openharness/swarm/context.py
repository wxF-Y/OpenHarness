"""Per-teammate context isolation via ContextVar.

Each asyncio Task running a teammate gets its own copy of TeammateContext,
accessible via get_teammate_context() / set_teammate_context().
"""

from __future__ import annotations

import asyncio
import time
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Literal

from openharness.swarm.abort import TeammateAbortController
from openharness.swarm.types import TeammateMessage

TeammateStatus = Literal["starting", "running", "idle", "stopping", "stopped"]


@dataclass
class TeammateContext:
    """All per-teammate state isolated across concurrent agents via ContextVar."""

    agent_id: str
    agent_name: str
    team_name: str

    parent_session_id: str | None = None
    color: str | None = None
    plan_mode_required: bool = False

    abort_controller: TeammateAbortController = field(
        default_factory=TeammateAbortController
    )
    message_queue: asyncio.Queue[TeammateMessage] = field(
        default_factory=asyncio.Queue
    )

    status: TeammateStatus = "starting"
    started_at: float = field(default_factory=time.time)
    tool_use_count: int = 0
    total_tokens: int = 0
    last_assistant_message: str | None = None

    @property
    def cancel_event(self) -> asyncio.Event:
        """Graceful cancellation event (delegates to abort_controller)."""
        return self.abort_controller.cancel_event


_teammate_context_var: ContextVar[TeammateContext | None] = ContextVar(
    "_teammate_context_var", default=None
)


def get_teammate_context() -> TeammateContext | None:
    """Return the TeammateContext for the currently-running teammate task."""
    return _teammate_context_var.get()


def set_teammate_context(ctx: TeammateContext) -> None:
    """Bind *ctx* to the current async context (task-local)."""
    _teammate_context_var.set(ctx)
