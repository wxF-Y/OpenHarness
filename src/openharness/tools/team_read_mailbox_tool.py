"""Tool for reading a swarm team's leader mailbox."""

from __future__ import annotations

import json

from pydantic import BaseModel, Field

from openharness.swarm.mailbox import TeammateMailbox
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult


class TeamReadMailboxToolInput(BaseModel):
    """Arguments for reading the team leader mailbox."""

    team: str = Field(description="Team name to read inbox for")
    run_id: str | None = Field(
        default=None,
        description=(
            "run_id from team_create_run (format: '{team}/{goal_slug}'). "
            "When provided, reads from the run-specific leader mailbox in teams-tasks/ "
            "instead of the template team directory. "
            "Always provide run_id to avoid creating stale directories in the template team."
        ),
    )
    unread_only: bool = Field(default=True, description="Only return unread messages")


class TeamReadMailboxTool(BaseTool):
    """Read messages sent to the team leader's inbox.

    Sub-agents send idle_notification and plan_approval messages here.
    Always pass run_id to read from the correct run-specific mailbox.
    """

    name = "team_read_mailbox"
    description = (
        "Read messages in the team leader inbox (idle_notification, plan_approval_request, etc.). "
        "Use this for real-time message checking or when you want to process messages one by one. "
        "To wait until all members finish, use team_wait instead."
    )
    input_model = TeamReadMailboxToolInput

    async def execute(self, arguments: TeamReadMailboxToolInput, context: ToolExecutionContext) -> ToolResult:
        del context
        try:
            if arguments.run_id:
                # Use run-specific mailbox (correct path, no template dir pollution)
                from openharness.swarm.mailbox import get_team_task_mailbox_dir
                try:
                    _t, _s = arguments.run_id.split("/", 1)
                    inbox_path = get_team_task_mailbox_dir(_t, _s, "leader")
                    mailbox = TeammateMailbox(arguments.team, "leader", inbox_dir=inbox_path)
                except Exception:
                    mailbox = TeammateMailbox(arguments.team, "leader")
            else:
                # Fallback: auto-detect latest run to avoid creating template inbox
                from openharness.config.paths import get_config_dir
                from openharness.swarm.mailbox import get_team_task_mailbox_dir
                try:
                    task_root = get_config_dir() / "teams-tasks" / arguments.team
                    if task_root.exists():
                        run_dirs = sorted(
                            [d for d in task_root.iterdir() if d.is_dir()],
                            key=lambda d: d.stat().st_mtime, reverse=True,
                        )
                        if run_dirs:
                            inbox_path = get_team_task_mailbox_dir(
                                arguments.team, run_dirs[0].name, "leader"
                            )
                            mailbox = TeammateMailbox(arguments.team, "leader", inbox_dir=inbox_path)
                        else:
                            mailbox = TeammateMailbox(arguments.team, "leader")
                    else:
                        mailbox = TeammateMailbox(arguments.team, "leader")
                except Exception:
                    mailbox = TeammateMailbox(arguments.team, "leader")

            messages = await mailbox.read_all(unread_only=arguments.unread_only)
            if not messages:
                return ToolResult(output="(no messages)")
            return ToolResult(output=json.dumps([m.to_dict() for m in messages], ensure_ascii=False, indent=2))
        except Exception as exc:
            return ToolResult(output=str(exc), is_error=True)
