"""asyncio.Event-based completion registry for blocked_by dependency scheduling."""

from __future__ import annotations

import asyncio
import logging
from typing import Dict

logger = logging.getLogger(__name__)

_events: Dict[str, asyncio.Event] = {}


def _key(run_id: str, agent_id: str) -> str:
    return f"{run_id}:{agent_id}"


def signal(run_id: str, agent_id: str) -> None:
    """Signal that agent_id in run_id has completed. Idempotent.

    Creates the event if it doesn't exist yet, so signal-before-wait works correctly.
    """
    k = _key(run_id, agent_id)
    ev = _events.setdefault(k, asyncio.Event())
    ev.set()
    logger.debug("completion_events: signalled %s", k)


async def wait_for_completion(run_id: str, agent_id: str, timeout: float) -> bool:
    """Wait for agent_id to complete. Returns True=done, False=timeout."""
    k = _key(run_id, agent_id)
    ev = _events.setdefault(k, asyncio.Event())
    try:
        await asyncio.wait_for(asyncio.shield(ev.wait()), timeout=timeout)
        return True
    except asyncio.TimeoutError:
        return False


def reset(run_id: str, agent_id: str) -> None:
    """Remove event entry. Call after run completes to prevent memory leak."""
    _events.pop(_key(run_id, agent_id), None)
