"""Tool for spawning a named swarm team member into a file-based team."""

from __future__ import annotations

import logging
import uuid

from pydantic import BaseModel, Field

from openharness.swarm.registry import get_backend_registry
from openharness.swarm.team_lifecycle import TeamLifecycleManager, TeamMember, read_team_file
from openharness.swarm.types import TeammateSpawnConfig
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

logger = logging.getLogger(__name__)


class TeamSpawnMemberInput(BaseModel):
    """Arguments for spawning a named team member."""

    team: str = Field(description="Template team name")
    member: str = Field(description="Member name (e.g. 'creative-strategist', 'auditor')")
    task: str = Field(description="Initial task/prompt for this member")
    model: str | None = Field(default=None, description="Model override")
    run_id: str = Field(
        description=(
            "run_id from team_create_run (required). Format: '{team}/{goal_slug}'. "
            "Member state is written to teams-tasks/ and idle_notification "
            "goes to the run's own mailbox (enables concurrent runs without collision)."
        ),
    )


class TeamSpawnMemberTool(BaseTool):
    """Spawn a named member of a team and start their task.

    Uses the member's pre-configured role prompt from the team definition.
    The member can receive messages via send_message(task_id='member@team', ...)
    and will send idle_notification to the leader mailbox when done.
    """

    name = "team_spawn_member"
    description = (
        "Spawn a named member of a team and start their work. "
        "Requires run_id from team_create_run for proper mailbox isolation. "
        "The member's agent_id is 'member@team'. "
        "Use team_send_message(member='member', run_id=run_id, message='...') to send follow-up instructions. "
        "Use team_read_mailbox(team='...') to receive their completion notifications."
    )
    input_model = TeamSpawnMemberInput

    async def execute(self, arguments: TeamSpawnMemberInput, context: ToolExecutionContext) -> ToolResult:
        tf = read_team_file(arguments.team)
        if tf is None:
            return ToolResult(output=f"Team '{arguments.team}' not found.", is_error=True)

        # run_id is required for correct mailbox isolation and session tracking.
        # Without it, idle_notifications won't reach the leader and transcripts won't be found.
        resolved_run_id = arguments.run_id
        if not resolved_run_id:
            return ToolResult(
                output=(
                    "run_id is required for team_spawn_member. "
                    "Call team_create_run first to get a run_id, then pass it here."
                ),
                is_error=True,
            )

        agent_id = f"{arguments.member}@{arguments.team}"
        member = tf.members.get(agent_id)
        role_prompt = member.prompt if member else None

        # Sanitize role_prompt: remove surrogate characters that break UTF-8 API encoding
        if role_prompt:
            role_prompt = role_prompt.encode("utf-8", errors="replace").decode("utf-8")

        # Build system prompt for this member based on their role
        member_system = (
            f"You are '{arguments.member}', a member of swarm team '{arguments.team}'.\n"
            + (f"Your role: {role_prompt}\n\n" if role_prompt else "")
            + "Complete the assigned task and report completion. "
            "You may receive follow-up instructions via your inbox. "
            "When your work is finished, summarize your output clearly."
        )

        session_id = uuid.uuid4().hex
        registry = get_backend_registry()
        member_backend = (member.backend_type if member else None) or "in_process"
        executor = registry.get_executor(member_backend)

        resolved_model = (
            arguments.model
            or (member.model if member else None)
            or None
        )

        # Use on_status_change from tool context if provided (set by Gateway for push notifications)
        on_status_change = context.metadata.get("swarm_status_callback")
        parent_sid = context.metadata.get("session_id") or "lead"

        config = TeammateSpawnConfig(
            name=arguments.member,
            team=arguments.team,
            prompt=arguments.task,
            cwd=str(context.cwd),
            parent_session_id=parent_sid,
            model=resolved_model,
            system_prompt=member_system,
            session_id=session_id,
            mailbox_team_path=resolved_run_id,
            on_status_change=on_status_change,  # push swarm_status WS event on completion
        )

        try:
            result = await executor.spawn(config)
        except Exception as exc:
            logger.error("Failed to spawn member %s: %s", agent_id, exc)
            return ToolResult(output=str(exc), is_error=True)

        if not result.success:
            return ToolResult(output=result.error or "Failed to spawn", is_error=True)

        # Write session_id and task_id only to the run's team.json (never to template)
        # This keeps the template team clean (no session_ids) so SwarmPage always shows "configured"
        if resolved_run_id:
            try:
                import time as _time
                _t, _s = arguments.run_id.split("/", 1)
                from openharness.config.paths import get_config_dir as _gcd
                from openharness.swarm.team_lifecycle import TeamFile, TeamMember as _TM
                run_team_file = _gcd() / "teams-tasks" / _t / _s / "team.json"
                if run_team_file.exists():
                    run_tf = TeamFile.load(run_team_file)
                    run_member = run_tf.members.get(agent_id)
                    if run_member:
                        run_tf.members[agent_id] = _TM(**{
                            **run_member.__dict__,
                            "session_id": result.session_id or session_id,
                            "task_id": result.task_id,
                            "status": "active",
                            "cwd": str(context.cwd),
                        })
                    else:
                        run_tf.members[agent_id] = _TM(
                            agent_id=agent_id,
                            name=arguments.member,
                            backend_type="subprocess",
                            joined_at=_time.time(),
                            session_id=result.session_id or session_id,
                            task_id=result.task_id,
                            status="active",
                            cwd=str(context.cwd),
                        )
                    run_tf.save(run_team_file)

                    # Immediately emit swarm_status so frontend opens SSE BEFORE member finishes
                    # This is the key to true real-time streaming (not batched after completion)
                    if on_status_change is not None:
                        with __import__('contextlib').suppress(Exception):
                            members_data = [m.to_dict() for m in run_tf.members.values()]
                            on_status_change(members_data)
            except Exception as exc:
                logger.warning("Could not update run team member session: %s", exc)

        return ToolResult(
            output=f"Spawned {agent_id} (task_id={result.task_id}, run_id={resolved_run_id})",
            metadata={
                "agent_id": agent_id,
                "task_id": result.task_id,
                "member": arguments.member,
                "team": arguments.team,
                "run_id": resolved_run_id,
            },
        )
