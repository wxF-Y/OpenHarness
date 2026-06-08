"""Tool for creating local cron-style jobs."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from openharness.services.cron import (
    build_cron_job_dict,
    upsert_cron_job,
    validate_cron_expression,
    validate_timezone,
)
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult


class CronCreateToolInput(BaseModel):
    """Arguments for cron job creation."""

    name: str = Field(description="Unique cron job name")
    schedule: str = Field(
        description=(
            "Cron schedule expression. Use ONLY these simple forms so the UI can display a friendly label:\n"
            "  - Every day at HH:MM          →  'MM HH * * *'          e.g. '0 9 * * *'\n"
            "  - Weekdays (Mon-Fri) at HH:MM →  'MM HH * * 1-5'        e.g. '30 8 * * 1-5'\n"
            "  - Specific weekdays at HH:MM  →  'MM HH * * D[,D]'      e.g. '0 10 * * 1,3,5'\n"
            "  - Monthly on day N at HH:MM   →  'MM HH D * *'          e.g. '0 9 15 * *'\n"
            "Do NOT use step intervals (*/N), hour ranges (A-B), or other complex fields. "
            "If a request implies 'every N hours', choose a fixed daily time instead."
        ),
    )
    command: str | None = Field(default=None, description="Shell command to run when triggered")
    message: str | None = Field(default=None, description="Instruction for an agent_turn cron job")
    timezone: str | None = Field(default=None, description="IANA timezone for interpreting cron schedule")
    cwd: str | None = Field(default=None, description="Optional working directory override")
    enabled: bool = Field(default=True, description="Whether the job is active")
    payload: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Optional nanobot-style payload. Example: "
            "{'kind': 'agent_turn', 'message': 'check GitHub', 'deliver': True, 'channel': 'feishu', 'to': 'ou_xxx'}."
        ),
    )
    notify: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Optional notification target. Example: "
            "{'type': 'feishu_dm', 'user_open_id': 'ou_xxx'} to send job output to a Feishu private chat."
        ),
    )


class CronCreateTool(BaseTool):
    """Create or replace a local cron job."""

    name = "cron_create"
    description = (
        "Create or replace a local cron job with a standard cron expression. "
        "Use 'oh cron start' to run the scheduler daemon."
    )
    input_model = CronCreateToolInput

    async def execute(
        self,
        arguments: CronCreateToolInput,
        context: ToolExecutionContext,
    ) -> ToolResult:
        if not validate_cron_expression(arguments.schedule):
            return ToolResult(
                output=(
                    f"Invalid cron expression: {arguments.schedule!r}\n"
                    "Use standard 5-field format: minute hour day month weekday\n"
                    "Examples: '*/5 * * * *' (every 5 min), '0 9 * * 1-5' (weekdays 9am)"
                ),
                is_error=True,
            )
        if not validate_timezone(arguments.timezone):
            return ToolResult(output=f"Invalid timezone: {arguments.timezone!r}", is_error=True)

        # Build notify-enriched payload so feishu routing is consistent with HTTP router
        notify_for_payload: dict[str, Any] | None = None
        if arguments.notify is not None:
            notify_type = str(arguments.notify.get("type") or "").strip().lower()
            if notify_type == "feishu_dm":
                notify_for_payload = {
                    "deliver": True,
                    "channel": "feishu",
                    "to": arguments.notify.get("user_open_id") or arguments.notify.get("open_id"),
                }

        merged_payload: dict[str, Any] | None = None
        if arguments.payload or notify_for_payload:
            merged_payload = dict(arguments.payload or {})
            if notify_for_payload:
                merged_payload.update({k: v for k, v in notify_for_payload.items() if k not in merged_payload})

        job = build_cron_job_dict(
            name=arguments.name,
            schedule=arguments.schedule,
            command=arguments.command,
            message=arguments.message,
            tz_name=arguments.timezone,
            cwd=arguments.cwd or str(context.cwd),
            enabled=arguments.enabled,
            payload=merged_payload,
            notify=arguments.notify,
        )

        if not job.get("command") and not job.get("payload"):
            return ToolResult(output="Cron job requires command or message.", is_error=True)

        upsert_cron_job(job)
        status = "enabled" if arguments.enabled else "disabled"
        return ToolResult(
            output=f"Created cron job '{arguments.name}' [{arguments.schedule}] ({status})"
        )
