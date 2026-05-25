"""Tool for creating a named task-run directory under teams-tasks/."""

from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path

from pydantic import BaseModel, Field

from openharness.swarm.team_lifecycle import TeamLifecycleManager, TeamMember, read_team_file
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult


# Characters that are illegal in file/directory names across major OS
_ILLEGAL_PATH_CHARS = re.compile(r'[/\\:*?"<>|]')


def _slugify_goal(goal: str, max_bytes: int = 180) -> str:
    """Convert goal text to a safe directory name.

    Replaces illegal path characters with '-', removes '..' path traversal
    segments, trims whitespace, and truncates to max_bytes.
    """
    slug = _ILLEGAL_PATH_CHARS.sub('-', goal).strip()
    # Prevent path traversal via ".." segments
    slug = re.sub(r'\.\.+', '-', slug)
    # Truncate to max_bytes (UTF-8 encoded length)
    encoded = slug.encode('utf-8')
    if len(encoded) > max_bytes:
        slug = encoded[:max_bytes].decode('utf-8', errors='ignore').rstrip()
    return slug or f"run-{int(time.time())}"


class SwarmCreateRunInput(BaseModel):
    """Arguments for creating a named task-run directory."""

    team: str = Field(description="Template team name (must exist in teams/ directory)")
    goal: str = Field(description="Short English goal slug used as the run directory name (ASCII only, use hyphens, e.g. 'stock-research', 'market-analysis'). MUST be English — no Chinese or Unicode characters.")


class SwarmCreateRunTool(BaseTool):
    """Create an isolated task-run directory under teams-tasks/{team}/{goal}/.

    Clones the template team's member definitions into a fresh run directory.
    Each run has its own team.json (for session tracking) and meta.json (for goal/history).
    Members spawned into this run will write idle_notification to the run's own mailbox,
    enabling concurrent runs of the same team without mailbox interference.

    Returns the run_id in "{team}/{goal_slug}" format.
    Pass this run_id to swarm_spawn_member, swarm_wait, swarm_list_members, etc.
    """

    name = "swarm_create_run"
    description = (
        "Create a named task-run directory for a swarm team. "
        "Returns a run_id ('{team}/{goal_slug}') to pass to swarm_spawn_member and swarm_wait. "
        "Enables concurrent runs of the same team with isolated mailboxes."
    )
    input_model = SwarmCreateRunInput

    async def execute(self, arguments: SwarmCreateRunInput, context: ToolExecutionContext) -> ToolResult:
        # Validate template team exists
        tf = read_team_file(arguments.team)
        if tf is None:
            return ToolResult(output=f"Template team '{arguments.team}' not found.", is_error=True)

        # Build run directory path
        goal_slug = _slugify_goal(arguments.goal)
        from openharness.config.paths import get_config_dir
        run_dir = get_config_dir() / "teams-tasks" / arguments.team / goal_slug

        # Handle name collision with short timestamp suffix
        if run_dir.exists():
            suffix = f"-{int(time.time()) % 100000:05d}"
            goal_slug = goal_slug + suffix
            run_dir = get_config_dir() / "teams-tasks" / arguments.team / goal_slug

        run_dir.mkdir(parents=True, exist_ok=True)

        # Write meta.json with original goal text
        meta = {
            "goal": arguments.goal,
            "team": arguments.team,
            "started_at": time.time(),
            "run_id": f"{arguments.team}/{goal_slug}",
        }
        (run_dir / "meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        # Clone member definitions from template (reset session_id/task_id)
        fresh_members: dict = {}
        for agent_id, m in tf.members.items():
            new_agent_id = agent_id.replace(f"@{arguments.team}", f"@{arguments.team}")
            fresh_members[new_agent_id] = TeamMember(
                agent_id=new_agent_id,
                name=m.name,
                backend_type=m.backend_type,
                joined_at=time.time(),
                agent_type=m.agent_type,
                model=m.model,
                prompt=m.prompt,
                color=m.color,
                plan_mode_required=m.plan_mode_required,
                permissions=list(m.permissions),
                session_id=None,
                task_id=None,
                status="active",
                is_active=True,
            )

        from openharness.swarm.team_lifecycle import TeamFile as _TF
        import time as _time
        run_team = _TF(
            name=f"{arguments.team}/{goal_slug}",
            created_at=_time.time(),
            lead_agent_id="",
            lead_session_id=context.metadata.get("session_id"),
            members=fresh_members,
        )
        team_json_path = run_dir / "team.json"
        run_team.save(team_json_path)

        run_id = f"{arguments.team}/{goal_slug}"
        return ToolResult(
            output=f"Created run '{goal_slug}' for team '{arguments.team}'. run_id={run_id}",
            metadata={"run_id": run_id, "goal_slug": goal_slug, "team": arguments.team},
        )
