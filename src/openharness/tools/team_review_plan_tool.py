"""Tool for approving or rejecting a teammate's submitted plan."""

from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from openharness.swarm.mailbox import TeammateMailbox, create_plan_approval_response_message
from openharness.swarm.protocol import match_response, pending_requests
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

logger = logging.getLogger(__name__)


class TeamReviewPlanInput(BaseModel):
    team: str = Field(description="Template team name")
    run_id: str = Field(description="run_id from team_create_run (format: '{team}/{goal_slug}')")
    request_id: str = Field(description="request_id returned by team_request_plan")
    approve: bool = Field(description="True to approve the plan, False to reject")
    feedback: str = Field(default="", description="Optional feedback text (especially useful when rejecting)")


class TeamReviewPlanTool(BaseTool):
    """Approve or reject a teammate's execution plan by request_id.

    Sends plan_approval_response to the teammate's mailbox and updates
    the ProtocolRequestState from 'pending' to 'approved' or 'rejected'.
    """

    name = "team_review_plan"
    description = (
        "Approve or reject a team member's submitted plan using request_id from team_request_plan. "
        "Set approve=False with feedback to send the plan back for revision. "
        "Once approved, the member will proceed with execution."
    )
    input_model = TeamReviewPlanInput

    async def execute(self, arguments: TeamReviewPlanInput, context: ToolExecutionContext) -> ToolResult:
        del context
        state = pending_requests.get(arguments.request_id)
        if state is None:
            return ToolResult(
                output=f"Request '{arguments.request_id}' not found. It may have already been resolved or the process restarted.",
                is_error=True,
            )
        if state.status != "pending":
            return ToolResult(
                output=f"Request '{arguments.request_id}' is already {state.status}.",
                is_error=True,
            )

        try:
            from openharness.swarm.mailbox import get_team_task_mailbox_dir
            _t, _s = arguments.run_id.split("/", 1)
            target_inbox = get_team_task_mailbox_dir(_t, _s, state.target)
            mailbox = TeammateMailbox(arguments.team, state.target, inbox_dir=target_inbox)
            msg = create_plan_approval_response_message(
                sender="leader",
                recipient=state.target,
                request_id=arguments.request_id,
                approve=arguments.approve,
                feedback=arguments.feedback,
            )
            await mailbox.write(msg)
        except Exception as exc:
            logger.error("team_review_plan: failed to send response for %s: %s", arguments.request_id, exc)
            return ToolResult(output=str(exc), is_error=True)

        match_response("plan_approval_response", arguments.request_id, arguments.approve)
        verdict = "approved" if arguments.approve else "rejected"
        return ToolResult(
            output=f"Plan {verdict} ({arguments.request_id})" + (f". Feedback: {arguments.feedback}" if arguments.feedback else ""),
            metadata={"request_id": arguments.request_id, "approve": arguments.approve},
        )
