"""Tool for listing swarm team members and their status."""

from __future__ import annotations

import json

from pydantic import BaseModel, Field

from openharness.swarm.team_lifecycle import read_team_file
from openharness.tasks.manager import get_task_manager
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult


class SwarmListMembersInput(BaseModel):
    """Arguments for listing swarm team members."""

    team: str = Field(description="Template team name")
    run_id: str | None = Field(
        default=None,
        description="Optional run_id ('{team}/{goal_slug}'). When provided, reads from teams-tasks/.",
    )


class SwarmListMembersTool(BaseTool):
    """List all members of a swarm team and their current status.

    Combines team file info with live task status so the status is accurate.
    """

    name = "swarm_list_members"
    description = "List all members of a swarm team with their actual status (running/completed/failed/not_started)."
    input_model = SwarmListMembersInput

    async def execute(self, arguments: SwarmListMembersInput, context: ToolExecutionContext) -> ToolResult:
        del context
        # Read from teams-tasks/ when run_id is provided; fall back to template team
        if arguments.run_id:
            from openharness.config.paths import get_config_dir
            try:
                _t, _s = arguments.run_id.split("/", 1)
                run_team_file = get_config_dir() / "teams-tasks" / _t / _s / "team.json"
                if run_team_file.exists():
                    from openharness.swarm.team_lifecycle import TeamFile
                    tf = TeamFile.load(run_team_file)
                else:
                    return ToolResult(output=f"Run '{arguments.run_id}' not found.", is_error=True)
            except Exception as exc:
                return ToolResult(output=str(exc), is_error=True)
        else:
            tf = read_team_file(arguments.team)
            if tf is None:
                return ToolResult(output=f"Team '{arguments.team}' not found.", is_error=True)

        task_mgr = get_task_manager()
        all_tasks = task_mgr.list_tasks()
        result = []
        for agent_id, member in tf.members.items():
            # Find the most recent task for this agent
            task_match = None
            for t in reversed(all_tasks):
                if f"Teammate: {agent_id}" in (t.description or ""):
                    task_match = t
                    break

            # Determine real status from task, not just team.json
            if task_match is None:
                real_status = "not_started"
            elif task_match.status == "running":
                real_status = "running"
            elif task_match.status == "completed":
                real_status = "completed"
            elif task_match.status in ("failed", "killed"):
                real_status = task_match.status
            else:
                real_status = task_match.status

            entry: dict = {
                "agent_id": agent_id,
                "name": member.name,
                "status": real_status,
                "task_id": task_match.id if task_match else None,
                "task_status": task_match.status if task_match else None,
                "session_id": member.session_id,
            }
            result.append(entry)

        if not result:
            return ToolResult(output=f"Team '{arguments.team}' has no members.")
        return ToolResult(output=json.dumps(result, ensure_ascii=False, indent=2))
