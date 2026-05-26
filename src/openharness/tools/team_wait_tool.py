"""Tool for waiting until all swarm team members complete their tasks."""

from __future__ import annotations

import asyncio
import json
import time

from pydantic import BaseModel, Field

from openharness.swarm.mailbox import TeammateMailbox
from openharness.swarm.team_lifecycle import read_team_file
from openharness.tasks.manager import get_task_manager
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult


class TeamWaitInput(BaseModel):
    """Arguments for waiting on team completion."""

    team: str = Field(description="Template team name to wait for")
    timeout: int = Field(
        default=30,
        description=(
            "Max seconds to wait before returning a status report (default 30). "
            "For long-running tasks, call team_wait again after reviewing status."
        ),
    )
    poll_interval: float = Field(default=3.0, description="Seconds between polls (default 3)")
    run_id: str | None = Field(
        default=None,
        description=(
            "Optional run_id from team_create_run (format: '{team}/{goal_slug}'). "
            "When provided, reads idle_notification from the run's own mailbox "
            "under teams-tasks/ instead of the template team mailbox."
        ),
    )


class TeamWaitTool(BaseTool):
    """Wait for team members to complete, checking BOTH task status AND mailbox.

    Polls in two ways:
    1. Task manager: checks if subprocess tasks have completed/failed
    2. Mailbox: checks for idle_notification from InProcess members

    Short default timeout (30s) so the Leader gets frequent status updates.
    The Leader can call team_wait again for members that are still running.
    """

    name = "team_wait"
    description = (
        "Wait for team members to complete their tasks. "
        "Returns a status report after timeout (default 30s). "
        "Call again for members still running. "
        "Checks both subprocess task completion and mailbox notifications."
    )
    input_model = TeamWaitInput

    async def execute(self, arguments: TeamWaitInput, context: ToolExecutionContext) -> ToolResult:
        del context
        tf = read_team_file(arguments.team)
        if tf is None:
            return ToolResult(output=f"Team '{arguments.team}' not found.", is_error=True)

        members = list(tf.members.keys())  # agent_ids like "name@team"
        if not members:
            return ToolResult(output="Team has no members.")

        task_mgr = get_task_manager()

        # run_id is required to read from the correct run mailbox.
        # Without it, idle_notifications from members won't be found.
        if not arguments.run_id:
            return ToolResult(
                output=(
                    "run_id is required for team_wait. "
                    "Pass the run_id returned by team_create_run."
                ),
                is_error=True,
            )

        from openharness.swarm.mailbox import get_team_task_mailbox_dir
        try:
            _t, _s = arguments.run_id.split("/", 1)
            inbox_path = get_team_task_mailbox_dir(_t, _s, "leader")
            mailbox = TeammateMailbox(arguments.team, "leader", inbox_dir=inbox_path)
        except Exception:
            mailbox = TeammateMailbox(arguments.team, "leader")

        completed: dict[str, str] = {}
        failed: dict[str, str] = {}
        deadline = time.time() + arguments.timeout

        def _find_task(agent_id: str):
            """Find the most recent task for this agent."""
            all_tasks = task_mgr.list_tasks()
            for t in reversed(all_tasks):
                if f"Teammate: {agent_id}" in (t.description or ""):
                    return t
            return None

        while len(completed) + len(failed) < len(members) and time.time() < deadline:
            # 1. Check mailbox for idle_notification (InProcess members)
            try:
                messages = await mailbox.read_all(unread_only=True)
                for msg in messages:
                    if msg.type == "idle_notification":
                        sender = msg.sender
                        if sender in members and sender not in completed and sender not in failed:
                            completed[sender] = str(msg.payload.get("summary", "completed"))
            except Exception:
                pass

            # 2. Check task manager for subprocess members
            for agent_id in members:
                if agent_id in completed or agent_id in failed:
                    continue
                t = _find_task(agent_id)
                if t is None:
                    continue
                if t.status == "completed":
                    summary = "completed"
                    try:
                        if t.output_file and t.output_file.exists():
                            raw = t.output_file.read_text(encoding="utf-8", errors="replace").strip()
                            lines = raw.splitlines()
                            last_lines = "\n".join(lines[-5:]) if lines else "completed"
                            summary = last_lines
                    except Exception:
                        pass
                    completed[agent_id] = summary
                    # Signal completion event (fallback for subprocess members)
                    if arguments.run_id:
                        from openharness.swarm.completion_events import signal as _sig
                        _sig(arguments.run_id, agent_id)
                elif t.status in ("failed", "killed"):
                    failed[agent_id] = f"task {t.status}: {t.return_code}"

            if len(completed) + len(failed) < len(members):
                await asyncio.sleep(arguments.poll_interval)

        # Final status of still-running members
        still_running = []
        for agent_id in members:
            if agent_id not in completed and agent_id not in failed:
                t = _find_task(agent_id)
                still_running.append({
                    "agent_id": agent_id,
                    "task_status": t.status if t else "not_found",
                    "task_id": t.id if t else None,
                })

        all_done = len(still_running) == 0
        result = {
            "all_done": all_done,
            "completed": completed,
            "failed": failed,
            "still_running": still_running,
            "total": len(members),
            "done_count": len(completed) + len(failed),
            "hint": "Call team_wait again if members are still running." if still_running else "All members done.",
        }
        return ToolResult(output=json.dumps(result, ensure_ascii=False, indent=2))
