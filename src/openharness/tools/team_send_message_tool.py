"""Tool for sending a message to a swarm team member via their run-specific mailbox."""

from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from openharness.swarm.mailbox import TeammateMailbox, create_user_message
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

logger = logging.getLogger(__name__)


class TeamSendMessageInput(BaseModel):
    """Arguments for sending a message to a team member."""

    team: str = Field(description="Template team name")
    member: str = Field(description="Member name (e.g. 'investment-researcher')")
    message: str = Field(description="Message content to send to the member")
    run_id: str = Field(
        description=(
            "run_id from team_create_run (required). Format: '{team}/{goal_slug}'. "
            "Ensures the message is delivered to the member's run-specific inbox, "
            "not the template team directory."
        ),
    )


class TeamSendMessageTool(BaseTool):
    """Send a follow-up message or instruction to a running team member.

    Writes to the member's run-specific inbox (teams-tasks/).
    The member reads this message from their mailbox during the next turn.
    run_id is required to route to the correct run mailbox.
    """

    name = "team_send_message"
    description = (
        "Send a message or follow-up instruction to a team member. "
        "Requires run_id to write to the correct run-specific member inbox. "
        "The member will receive this message via their inbox on their next turn."
    )
    input_model = TeamSendMessageInput

    async def execute(self, arguments: TeamSendMessageInput, context: ToolExecutionContext) -> ToolResult:
        del context
        agent_id = f"{arguments.member}@{arguments.team}"

        try:
            from openharness.swarm.mailbox import get_team_task_mailbox_dir
            _t, _s = arguments.run_id.split("/", 1)
            member_inbox = get_team_task_mailbox_dir(_t, _s, agent_id)
            mailbox = TeammateMailbox(arguments.team, agent_id, inbox_dir=member_inbox)
            msg = create_user_message("leader", agent_id, arguments.message)
            await mailbox.write(msg)
            return ToolResult(
                output=f"Message sent to {agent_id} (run_id={arguments.run_id})",
                metadata={"agent_id": agent_id, "message_id": msg.id, "run_id": arguments.run_id},
            )
        except Exception as exc:
            logger.error("Failed to send message to %s: %s", agent_id, exc)
            return ToolResult(output=str(exc), is_error=True)
