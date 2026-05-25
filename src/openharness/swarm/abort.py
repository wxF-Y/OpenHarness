"""Abort controller for in-process teammates.

Provides dual-signal cancellation: graceful (cancel_event) and force-kill
(force_cancel), mirroring the TypeScript AbortController pattern.
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


class TeammateAbortController:
    """Dual-signal abort controller for in-process teammates.

    Provides both *graceful* cancellation (set ``cancel_event``; the agent
    finishes its current tool use and then exits) and *force* kill (set
    ``force_cancel``; the asyncio Task is immediately cancelled).
    """

    def __init__(self) -> None:
        self.cancel_event: asyncio.Event = asyncio.Event()
        self.force_cancel: asyncio.Event = asyncio.Event()
        self._reason: str | None = None

    @property
    def is_cancelled(self) -> bool:
        """Return True if either cancellation signal has been set."""
        return self.cancel_event.is_set() or self.force_cancel.is_set()

    def request_cancel(self, reason: str | None = None, *, force: bool = False) -> None:
        """Request cancellation of the teammate."""
        self._reason = reason
        if force:
            logger.debug(
                "[TeammateAbortController] Force-cancel requested: %s", reason or "(no reason)"
            )
            self.force_cancel.set()
            self.cancel_event.set()
        else:
            logger.debug(
                "[TeammateAbortController] Graceful cancel requested: %s",
                reason or "(no reason)",
            )
            self.cancel_event.set()

    @property
    def reason(self) -> str | None:
        """The reason provided to the most recent :meth:`request_cancel` call."""
        return self._reason
