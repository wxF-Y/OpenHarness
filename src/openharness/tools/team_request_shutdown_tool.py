"""Tool for sending a graceful shutdown request with request_id tracking."""

from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from openharness.swarm.mailbox import TeammateMailbox, create_shutdown_request_with_tracking
from openharness.swarm.protocol import ProtocolRequestState, new_request_id, pending_requests
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

logger = logging.getLogger(__name__)


class TeamRequestShutdownInput(BaseModel):
    team: str = Field(description="Template team name")
    member: str = Field(description="Member name to shut down (e.g. 'researcher')")
    run_id: str = Field(description="run_id from team_create_run (format: '{team}/{goal_slug}')")


class TeamRequestShutdownTool(BaseTool):
    """Send a graceful shutdown request with request_id for confirmation tracking.

    Unlike team_shutdown_member (which sends a plain shutdown), this tool tracks
    whether the teammate acknowledged the shutdown via ProtocolRequestState.
    Check pending_requests[request_id].status to see if the teammate confirmed.
    """

    name = "team_request_shutdown"
    description = (
        "Send a graceful shutdown request to a team member with acknowledgment tracking. "
        "Unlike team_shutdown_member, this returns a request_id so you can confirm the member received and accepted the shutdown. "
        "Use team_shutdown_member(force=True) for immediate termination without confirmation."
    )
    input_model = TeamRequestShutdownInput

    async def execute(self, arguments: TeamRequestShutdownInput, context: ToolExecutionContext) -> ToolResult:
        del context
        agent_id = f"{arguments.member}@{arguments.team}"

        req_id = new_request_id()
        pending_requests[req_id] = ProtocolRequestState(
            request_id=req_id,
            type="shutdown",
            sender="leader",
            target=agent_id,
            status="pending",
            payload="",
        )

        try:
            from openharness.swarm.mailbox import get_team_task_mailbox_dir
            _t, _s = arguments.run_id.split("/", 1)
            member_inbox = get_team_task_mailbox_dir(_t, _s, agent_id)
            mailbox = TeammateMailbox(arguments.team, agent_id, inbox_dir=member_inbox)
            msg = create_shutdown_request_with_tracking(
                sender="leader",
                recipient=agent_id,
                request_id=req_id,
            )
            await mailbox.write(msg)
        except Exception as exc:
            pending_requests.pop(req_id, None)
            logger.error("team_request_shutdown: failed to send to %s: %s", agent_id, exc)
            return ToolResult(output=str(exc), is_error=True)

        return ToolResult(
            output=f"Shutdown request sent to {agent_id}. request_id={req_id} (check status with team_read_mailbox)",
            metadata={"request_id": req_id, "agent_id": agent_id},
        )
