"""Tool for gracefully shutting down a swarm team member."""

from __future__ import annotations

from pydantic import BaseModel, Field

from openharness.swarm.mailbox import TeammateMailbox, create_shutdown_request
from openharness.swarm.registry import get_backend_registry
from openharness.swarm.team_lifecycle import TeamLifecycleManager, read_team_file
from openharness.tasks.manager import get_task_manager
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult


class TeamShutdownMemberInput(BaseModel):
    """Arguments for shutting down a team member."""

    team: str = Field(description="Team name")
    member: str = Field(description="Member name (e.g. 'creative-strategist')")
    force: bool = Field(default=False, description="Force kill instead of graceful shutdown")


class TeamShutdownMemberTool(BaseTool):
    """Send a graceful shutdown request to a team member.

    Sends a shutdown_request message to the member's mailbox (matching s10 protocol).
    With force=True, immediately kills the underlying task.
    """

    name = "team_shutdown_member"
    description = (
        "Stop a team member: graceful (completes current step then exits) or force=True (immediate kill). "
        "For confirmed acknowledgment of shutdown, use team_request_shutdown instead. "
        "The member's transcript remains accessible after shutdown."
    )
    input_model = TeamShutdownMemberInput

    async def execute(self, arguments: TeamShutdownMemberInput, context: ToolExecutionContext) -> ToolResult:
        del context
        agent_id = f"{arguments.member}@{arguments.team}"
        tf = read_team_file(arguments.team)
        if tf is None:
            return ToolResult(output=f"Team '{arguments.team}' not found.", is_error=True)
        if agent_id not in tf.members:
            return ToolResult(output=f"Member '{agent_id}' not found in team.", is_error=True)

        if arguments.force:
            # Force kill via task manager
            task_mgr = get_task_manager()
            tasks = task_mgr.list_tasks(status="running")
            killed = False
            for t in tasks:
                if f"Teammate: {agent_id}" in (t.description or ""):
                    try:
                        await task_mgr.stop_task(t.id)
                        killed = True
                    except Exception as exc:
                        return ToolResult(output=f"Failed to stop task {t.id}: {exc}", is_error=True)
            if not killed:
                return ToolResult(output=f"No running task found for {agent_id}.")
        else:
            # Graceful: send shutdown_request to member's mailbox
            mailbox = TeammateMailbox(arguments.team, agent_id)
            msg = create_shutdown_request(sender="lead", recipient=agent_id)
            try:
                await mailbox.write(msg)
            except Exception as exc:
                return ToolResult(output=f"Failed to send shutdown request: {exc}", is_error=True)

        # Update team member status
        try:
            mgr = TeamLifecycleManager()
            member = tf.members[agent_id]
            from openharness.swarm.team_lifecycle import TeamMember
            updated = TeamMember(**{**member.__dict__, "status": "stopped", "is_active": False})
            mgr.add_member(arguments.team, updated)
        except Exception:
            pass

        action = "Force killed" if arguments.force else "Shutdown request sent to"
        return ToolResult(output=f"{action} {agent_id}")
