"""Protocol state machine for Leader-Teammate request/response tracking."""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Literal

log = logging.getLogger(__name__)


@dataclass
class ProtocolRequestState:
    request_id: str
    type: Literal["plan_approval", "shutdown"]
    sender: str
    target: str
    status: Literal["pending", "approved", "rejected"]
    payload: str
    created_at: float = field(default_factory=time.time)


# In-process dict: session-level, not persisted.
# asyncio single-thread: no Lock needed.
pending_requests: Dict[str, ProtocolRequestState] = {}


def new_request_id() -> str:
    return f"req_{uuid.uuid4().hex[:12]}"


def match_response(response_type: str, request_id: str, approve: bool) -> None:
    """Correlate a response to its original request via request_id.

    Validates type match and guards against duplicate responses.
    """
    state = pending_requests.get(request_id)
    if not state:
        log.warning("match_response: unknown request_id %s", request_id)
        return
    expected = {
        "plan_approval": "plan_approval_response",
        "shutdown": "shutdown_response",
    }.get(state.type)
    if expected and response_type != expected:
        log.warning(
            "match_response: type mismatch for %s (expected %s, got %s)",
            request_id, expected, response_type,
        )
        return
    if state.status != "pending":
        log.debug("match_response: %s already %s, ignoring duplicate", request_id, state.status)
        return
    state.status = "approved" if approve else "rejected"
    log.info("match_response: %s → %s", request_id, state.status)
