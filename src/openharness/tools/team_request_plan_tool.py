"""Tool for requesting a teammate to submit an execution plan."""

from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from openharness.swarm.mailbox import TeammateMailbox, create_plan_approval_request_message
from openharness.swarm.protocol import ProtocolRequestState, new_request_id, pending_requests
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

logger = logging.getLogger(__name__)


class TeamRequestPlanInput(BaseModel):
    team: str = Field(description="Template team name")
    member: str = Field(description="Member name to request plan from (e.g. 'researcher')")
    task: str = Field(description="Task description to include in the plan request")
    run_id: str = Field(description="run_id from team_create_run (format: '{team}/{goal_slug}')")


class TeamRequestPlanTool(BaseTool):
    """Request a teammate to submit an execution plan for review before proceeding.

    Sends a plan_approval_request message to the member's run-specific mailbox.
    Returns request_id to pass to team_review_plan for approval/rejection.
    """

    name = "team_request_plan"
    description = (
        "Ask a team member to submit an execution plan before starting work. "
        "Use before team_spawn_member when the task is complex and you want to review the approach first. "
        "Returns request_id; call team_review_plan to approve or reject the plan."
    )
    input_model = TeamRequestPlanInput

    async def execute(self, arguments: TeamRequestPlanInput, context: ToolExecutionContext) -> ToolResult:
        del context
        agent_id = f"{arguments.member}@{arguments.team}"

        req_id = new_request_id()
        pending_requests[req_id] = ProtocolRequestState(
            request_id=req_id,
            type="plan_approval",
            sender="leader",
            target=agent_id,
            status="pending",
            payload=arguments.task,
        )

        try:
            from openharness.swarm.mailbox import get_team_task_mailbox_dir
            _t, _s = arguments.run_id.split("/", 1)
            member_inbox = get_team_task_mailbox_dir(_t, _s, agent_id)
            mailbox = TeammateMailbox(arguments.team, agent_id, inbox_dir=member_inbox)
            msg = create_plan_approval_request_message(
                sender="leader",
                recipient=agent_id,
                task=arguments.task,
                request_id=req_id,
            )
            await mailbox.write(msg)
        except Exception as exc:
            pending_requests.pop(req_id, None)
            logger.error("team_request_plan: failed to send to %s: %s", agent_id, exc)
            return ToolResult(output=str(exc), is_error=True)

        return ToolResult(
            output=f"Plan request sent to {agent_id}. request_id={req_id}",
            metadata={"request_id": req_id, "agent_id": agent_id},
        )
