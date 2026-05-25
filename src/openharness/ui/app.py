"""Interactive session entry points."""

from __future__ import annotations

import asyncio
import json
import os
import sys

from openharness.coordinator.coordinator_mode import is_coordinator_mode

from openharness.api.client import SupportsStreamingMessages
from openharness.engine.stream_events import StreamEvent
from openharness.ui.backend_host import run_backend_host
from openharness.ui.coordinator_drain import drain_coordinator_async_agents
from openharness.ui.react_launcher import launch_react_tui
from openharness.ui.runtime import build_runtime, close_runtime, handle_line, start_runtime


async def _send_task_worker_idle_notification() -> None:
    """Send idle_notification to leader mailbox when subprocess task completes.

    Uses OPENHARNESS_MAILBOX_TEAM_PATH env var for run-specific mailbox isolation.
    Falls back to CLAUDE_CODE_TEAM_NAME / CLAUDE_CODE_AGENT_NAME for template mailbox.
    No-op if team identity env vars are not set.
    """
    try:
        team_name = os.environ.get("CLAUDE_CODE_TEAM_NAME")
        agent_name = os.environ.get("CLAUDE_CODE_AGENT_NAME")
        if not team_name or not agent_name:
            return
        agent_id = f"{agent_name}@{team_name}"
        mailbox_team_path = os.environ.get("OPENHARNESS_MAILBOX_TEAM_PATH")

        from openharness.swarm.mailbox import TeammateMailbox, create_idle_notification, get_team_task_mailbox_dir
        idle_msg = create_idle_notification(
            sender=agent_id,
            recipient="leader",
            summary=f"{agent_name} finished",
        )
        if mailbox_team_path:
            _t, _s = mailbox_team_path.split("/", 1)
            inbox_path = get_team_task_mailbox_dir(_t, _s, "leader")
            leader_mailbox = TeammateMailbox(team_name, "leader", inbox_dir=inbox_path)
        else:
            leader_mailbox = TeammateMailbox(team_name=team_name, agent_id="leader")
        await leader_mailbox.write(idle_msg)
    except Exception:
        pass  # Non-critical — swarm_wait also checks task status


def _decode_task_worker_line(raw: str) -> str:
    """Normalize one stdin line for the headless task worker.

    Task-manager driven agent workers receive either:
    - a plain text line (initial prompt or simple follow-up), or
    - a JSON object from ``send_message`` / teammate backends with a ``text`` field.
    """
    stripped = raw.strip()
    if not stripped:
        return ""
    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError:
        return stripped
    if isinstance(payload, dict):
        text = payload.get("text")
        if isinstance(text, str):
            return text.strip()
    return stripped


async def run_repl(
    *,
    prompt: str | None = None,
    cwd: str | None = None,
    model: str | None = None,
    max_turns: int | None = None,
    base_url: str | None = None,
    system_prompt: str | None = None,
    api_key: str | None = None,
    api_format: str | None = None,
    api_client: SupportsStreamingMessages | None = None,
    backend_only: bool = False,
    restore_messages: list[dict] | None = None,
    restore_tool_metadata: dict[str, object] | None = None,
    permission_mode: str | None = None,
) -> None:
    """Run the default OpenHarness interactive application (React TUI)."""
    if backend_only:
        await run_backend_host(
            cwd=cwd,
            model=model,
            max_turns=max_turns,
            base_url=base_url,
            system_prompt=system_prompt,
            api_key=api_key,
            api_format=api_format,
            api_client=api_client,
            restore_messages=restore_messages,
            restore_tool_metadata=restore_tool_metadata,
            enforce_max_turns=max_turns is not None,
            permission_mode=permission_mode,
        )
        return

    exit_code = await launch_react_tui(
        prompt=prompt,
        cwd=cwd,
        model=model,
        max_turns=max_turns,
        base_url=base_url,
        system_prompt=system_prompt,
        api_key=api_key,
        api_format=api_format,
        permission_mode=permission_mode,
    )
    if exit_code != 0:
        raise SystemExit(exit_code)


async def run_task_worker(
    *,
    cwd: str | None = None,
    model: str | None = None,
    max_turns: int | None = None,
    base_url: str | None = None,
    system_prompt: str | None = None,
    api_key: str | None = None,
    api_format: str | None = None,
    api_client: SupportsStreamingMessages | None = None,
    permission_mode: str | None = None,
) -> None:
    """Run a stdin-driven headless worker for background agent tasks.

    This mode exists for subprocess teammates and other task-manager managed
    agent processes. It intentionally avoids the React TUI / Ink path so it
    can run without a controlling TTY.
    """

    async def _noop_permission(_tool_name: str, _reason: str) -> bool:
        return True

    async def _noop_ask(_question: str, _options: list | None = None, _multi_select: bool = False) -> str:
        return ""

    async def _print_system(message: str) -> None:
        print(message, flush=True)

    async def _render_event(event: StreamEvent) -> None:
        from openharness.engine.stream_events import AssistantTextDelta, AssistantTurnComplete, ErrorEvent, StatusEvent

        if isinstance(event, AssistantTextDelta):
            sys.stdout.write(event.text)
            sys.stdout.flush()
        elif isinstance(event, AssistantTurnComplete):
            sys.stdout.write("\n")
            sys.stdout.flush()
        elif isinstance(event, ErrorEvent):
            print(event.message, flush=True)
        elif isinstance(event, StatusEvent) and event.message:
            print(event.message, flush=True)

    async def _clear_output() -> None:
        return None

    bundle = await build_runtime(
        cwd=cwd,
        model=model,
        max_turns=max_turns,
        base_url=base_url,
        system_prompt=system_prompt,
        api_key=api_key,
        api_format=api_format,
        api_client=api_client,
        permission_prompt=_noop_permission,
        ask_user_prompt=_noop_ask,
        enforce_max_turns=max_turns is not None,
        permission_mode=permission_mode,
    )
    await start_runtime(bundle)
    try:
        while True:
            raw = await asyncio.to_thread(sys.stdin.readline)
            if raw == "":
                break
            line = _decode_task_worker_line(raw)
            if not line:
                continue
            await handle_line(
                bundle,
                line,
                print_system=_print_system,
                render_event=_render_event,
                clear_output=_clear_output,
            )
            # Background agent tasks are one-shot workers. If the coordinator
            # needs to send a follow-up later, BackgroundTaskManager already
            # knows how to restart the task and write the next stdin payload.
            break
    finally:
        await close_runtime(bundle)
        # Send idle_notification to leader after task completes.
        # Writes to run-specific mailbox if OPENHARNESS_MAILBOX_TEAM_PATH is set.
        await _send_task_worker_idle_notification()


async def run_print_mode(
    *,
    prompt: str,
    output_format: str = "text",
    cwd: str | None = None,
    model: str | None = None,
    base_url: str | None = None,
    system_prompt: str | None = None,
    append_system_prompt: str | None = None,
    api_key: str | None = None,
    api_format: str | None = None,
    api_client: SupportsStreamingMessages | None = None,
    permission_mode: str | None = None,
    max_turns: int | None = None,
) -> None:
    """Non-interactive mode: submit prompt, stream output, exit."""
    from openharness.engine.stream_events import (
        AssistantTextDelta,
        AssistantTurnComplete,
        CompactProgressEvent,
        ErrorEvent,
        StatusEvent,
        ToolExecutionCompleted,
        ToolExecutionStarted,
    )

    async def _noop_permission(tool_name: str, reason: str) -> bool:
        return True

    async def _noop_ask(question: str) -> str:
        return ""

    bundle = await build_runtime(
        prompt=prompt,
        cwd=cwd,
        model=model,
        max_turns=max_turns,
        base_url=base_url,
        system_prompt=system_prompt,
        api_key=api_key,
        api_format=api_format,
        enforce_max_turns=True,
        api_client=api_client,
        permission_prompt=_noop_permission,
        ask_user_prompt=_noop_ask,
    )
    await start_runtime(bundle)

    collected_text = ""
    events_list: list[dict] = []

    try:
        async def _print_system(message: str) -> None:
            nonlocal collected_text
            if output_format == "text":
                print(message, file=sys.stderr)
            elif output_format == "stream-json":
                obj = {"type": "system", "message": message}
                print(json.dumps(obj), flush=True)
                events_list.append(obj)

        async def _render_event(event: StreamEvent) -> None:
            nonlocal collected_text
            if isinstance(event, AssistantTextDelta):
                collected_text += event.text
                if output_format == "text":
                    sys.stdout.write(event.text)
                    sys.stdout.flush()
                elif output_format == "stream-json":
                    obj = {"type": "assistant_delta", "text": event.text}
                    print(json.dumps(obj), flush=True)
                    events_list.append(obj)
            elif isinstance(event, AssistantTurnComplete):
                if output_format == "text":
                    sys.stdout.write("\n")
                    sys.stdout.flush()
                elif output_format == "stream-json":
                    obj = {"type": "assistant_complete", "text": event.message.text.strip()}
                    print(json.dumps(obj), flush=True)
                    events_list.append(obj)
            elif isinstance(event, ToolExecutionStarted):
                if output_format == "stream-json":
                    obj = {"type": "tool_started", "tool_name": event.tool_name, "tool_input": event.tool_input}
                    print(json.dumps(obj), flush=True)
                    events_list.append(obj)
            elif isinstance(event, ToolExecutionCompleted):
                if output_format == "stream-json":
                    obj = {"type": "tool_completed", "tool_name": event.tool_name, "output": event.output, "is_error": event.is_error}
                    print(json.dumps(obj), flush=True)
                    events_list.append(obj)
            elif isinstance(event, ErrorEvent):
                if output_format == "text":
                    print(event.message, file=sys.stderr)
                elif output_format == "stream-json":
                    obj = {"type": "error", "message": event.message, "recoverable": event.recoverable}
                    print(json.dumps(obj), flush=True)
                    events_list.append(obj)
            elif isinstance(event, CompactProgressEvent):
                if output_format == "text" and event.message:
                    print(event.message, file=sys.stderr)
                elif output_format == "stream-json":
                    obj = {
                        "type": "compact_progress",
                        "phase": event.phase,
                        "trigger": event.trigger,
                        "attempt": event.attempt,
                        "message": event.message,
                    }
                    print(json.dumps(obj), flush=True)
                    events_list.append(obj)
            elif isinstance(event, StatusEvent):
                if output_format == "text":
                    print(event.message, file=sys.stderr)
                elif output_format == "stream-json":
                    obj = {"type": "status", "message": event.message}
                    print(json.dumps(obj), flush=True)
                    events_list.append(obj)

        async def _clear_output() -> None:
            pass

        await handle_line(
            bundle,
            prompt,
            print_system=_print_system,
            render_event=_render_event,
            clear_output=_clear_output,
        )
        if is_coordinator_mode():
            await drain_coordinator_async_agents(
                bundle,
                prompt_seed=prompt,
                print_system=_print_system,
                render_event=_render_event,
                announce_waiting=output_format == "text",
            )

        if output_format == "json":
            result = {"type": "result", "text": collected_text.strip()}
            print(json.dumps(result))
    finally:
        await close_runtime(bundle)
