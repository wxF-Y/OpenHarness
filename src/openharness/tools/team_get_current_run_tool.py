"""Tool for querying the current active run of a team."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from openharness.tools.base import BaseTool, ToolResult

if TYPE_CHECKING:
    from openharness.tools.base import ToolExecutionContext

logger = logging.getLogger(__name__)


class TeamGetCurrentRunInput(BaseModel):
    """Input schema for team_get_current_run tool."""

    team: str = Field(description="团队名称")


class TeamGetCurrentRunTool(BaseTool):
    """Query the most recent run state of a team.

    Returns run_id, goal, and member status including session_ids.
    """

    name = "team_get_current_run"
    description = "查询团队最近的 run 状态，返回 run_id、goal 和 members 信息"
    input_model = TeamGetCurrentRunInput

    async def execute(self, arguments: TeamGetCurrentRunInput, context: ToolExecutionContext) -> ToolResult:
        """Execute the tool to get current run state."""
        from openharness.config.paths import get_config_dir
        from openharness.swarm.team_lifecycle import TeamFile

        team_name = arguments.team

        # Find the most recent run in teams-tasks/{team}/
        tasks_dir = get_config_dir() / "teams-tasks" / team_name
        if not tasks_dir.exists():
            return ToolResult(
                output=f'{{"run_id": null, "goal": null, "members": {{}}, "message": "No runs found for team {team_name}"}}'
            )

        # List all run directories (subdirectories of tasks_dir)
        run_dirs = [d for d in tasks_dir.iterdir() if d.is_dir()]
        if not run_dirs:
            return ToolResult(
                output=f'{{"run_id": null, "goal": null, "members": {{}}, "message": "No runs found for team {team_name}"}}'
            )

        # Sort by modification time (most recent first)
        run_dirs.sort(key=lambda d: d.stat().st_mtime, reverse=True)
        latest_run_dir = run_dirs[0]

        # Load team.json from the run directory
        team_json_path = latest_run_dir / "team.json"
        if not team_json_path.exists():
            return ToolResult(
                output=f'{{"run_id": null, "goal": null, "members": {{}}, "message": "team.json not found in latest run"}}'
            )

        try:
            tf = TeamFile.load(team_json_path)
            run_id = f"{team_name}/{latest_run_dir.name}"

            # Build members dict with status and session_id
            members_data = {}
            for agent_id, member in tf.members.items():
                members_data[agent_id] = {
                    "status": member.status,
                    "session_id": member.session_id if member.session_id else None,
                }

            import json
            result = {
                "run_id": run_id,
                "goal": latest_run_dir.name,  # goal is the run directory name
                "members": members_data,
            }

            return ToolResult(output=json.dumps(result, ensure_ascii=False, indent=2))

        except Exception as e:
            logger.error(f"Failed to load team.json from {team_json_path}: {e}")
            return ToolResult(
                output=f'{{"run_id": null, "goal": null, "members": {{}}, "error": "Failed to load run state: {str(e)}"}}'
            )
