"""In-process teammate execution backend.

Runs teammate agents as asyncio Tasks inside the current Python process,
using :mod:`contextvars` for per-teammate context isolation.

Architecture summary
--------------------
* :class:`~openharness.swarm.abort.TeammateAbortController` – dual-signal abort.
* :class:`~openharness.swarm.context.TeammateContext` – per-task isolated state.
* :func:`start_in_process_teammate` – coroutine driving the query engine loop.
* :class:`InProcessBackend` – implements TeammateExecutor, manages live Tasks.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from openharness.swarm.abort import TeammateAbortController
from openharness.swarm.context import (
    TeammateContext,
    TeammateStatus,
    get_teammate_context,
    set_teammate_context,
)
from openharness.swarm.mailbox import (
    TeammateMailbox,
    create_idle_notification,
)
from openharness.engine.stream_events import (
    AssistantTextDelta,
    AssistantThinkingDelta,
    AssistantTurnComplete,
    ErrorEvent,
    ToolExecutionStarted,
    ToolExecutionCompleted,
)
from openharness.swarm.types import (
    BackendType,
    SpawnResult,
    TeammateMessage,
    TeammateSpawnConfig,
)

logger = logging.getLogger(__name__)

_member_notify_callbacks: dict[str, Any] = {}
_notify_lock = asyncio.Lock()


async def register_notify_callback(parent_session_id: str, callback: Any) -> None:
    """Register a swarm_status callback for a Leader session."""
    async with _notify_lock:
        _member_notify_callbacks[parent_session_id] = callback


async def unregister_notify_callback(parent_session_id: str) -> None:
    """Remove a registered callback."""
    async with _notify_lock:
        _member_notify_callbacks.pop(parent_session_id, None)
# Queue items: str (text delta) | None (stream done) | dict (tool event)
# ---------------------------------------------------------------------------

_member_stream_queues: dict[str, asyncio.Queue] = {}
_member_stream_lock = asyncio.Lock()


async def get_or_create_stream_queue(session_id: str) -> asyncio.Queue:
    """Return (creating if necessary) the streaming queue for a member session."""
    async with _member_stream_lock:
        if session_id not in _member_stream_queues:
            _member_stream_queues[session_id] = asyncio.Queue(maxsize=512)
        return _member_stream_queues[session_id]


async def cleanup_stream_queue(session_id: str) -> None:
    """Remove the streaming queue after stream is done."""
    async with _member_stream_lock:
        _member_stream_queues.pop(session_id, None)


# ---------------------------------------------------------------------------
# Agent execution loop
# ---------------------------------------------------------------------------


async def start_in_process_teammate(
    *,
    config: TeammateSpawnConfig,
    agent_id: str,
    abort_controller: TeammateAbortController,
    query_context: Any | None = None,
) -> None:
    """Run the agent query loop for an in-process teammate as an asyncio Task."""
    ctx = TeammateContext(
        agent_id=agent_id,
        agent_name=config.name,
        team_name=config.team,
        parent_session_id=config.parent_session_id,
        color=config.color,
        plan_mode_required=config.plan_mode_required,
        abort_controller=abort_controller,
        started_at=time.time(),
        status="starting",
    )
    set_teammate_context(ctx)

    # Member's own inbox: use run-specific path if mailbox_team_path is set
    if config.mailbox_team_path:
        from openharness.swarm.mailbox import get_team_task_mailbox_dir
        _mt, _ms = config.mailbox_team_path.split("/", 1)
        _member_inbox = get_team_task_mailbox_dir(_mt, _ms, agent_id)
        mailbox = TeammateMailbox(config.team, agent_id, inbox_dir=_member_inbox)
    else:
        mailbox = TeammateMailbox(team_name=config.team, agent_id=agent_id)

    logger.debug("[in_process] %s: starting", agent_id)

    try:
        ctx.status = "running"

        if query_context is not None:
            await _run_query_loop(query_context, config, ctx, mailbox)
        else:
            # Minimal stub: log that we received the prompt and honour cancel.
            # Replace this branch with a real QueryContext builder once the
            # harness wires up the full engine for in-process teammates.
            logger.info(
                "[in_process] %s: no query_context supplied — stub run for prompt: %.80s",
                agent_id,
                config.prompt,
            )
            ctx.status = "idle"
            for _ in range(10):
                if abort_controller.is_cancelled:
                    logger.debug("[in_process] %s: cancelled during stub run", agent_id)
                    return
                await asyncio.sleep(0.1)

    except asyncio.CancelledError:
        logger.debug("[in_process] %s: task cancelled", agent_id)
        raise
    except Exception:
        logger.exception("[in_process] %s: unhandled exception in agent loop", agent_id)
    finally:
        ctx.status = "stopped"

        # Invoke on_status_change callback so Gateway can emit swarm_status event
        if config.on_status_change is not None:
            with contextlib.suppress(Exception):
                from openharness.swarm.team_lifecycle import read_team_file, TeamFile
                # When mailbox_team_path is set (B.5 run isolation), read members
                # from the run's team.json so session_ids are included.
                if config.mailbox_team_path:
                    try:
                        from openharness.config.paths import get_config_dir
                        _t, _s = config.mailbox_team_path.split("/", 1)
                        _run_path = get_config_dir() / "teams-tasks" / _t / _s / "team.json"
                        tf = TeamFile.load(_run_path) if _run_path.exists() else read_team_file(config.team)
                    except Exception:
                        tf = read_team_file(config.team)
                else:
                    tf = read_team_file(config.team)
                if tf is not None:
                    members_data = [m.to_dict() for m in tf.members.values()]
                    # Enrich the current agent's entry with last_message from memory
                    for m in members_data:
                        if m.get("agent_id") == agent_id and ctx.last_assistant_message:
                            m["last_message"] = ctx.last_assistant_message
                    config.on_status_change(members_data)

        logger.debug(
            "[in_process] %s: exiting (tools=%d, tokens=%d)",
            agent_id,
            ctx.tool_use_count,
            ctx.total_tokens,
        )


async def _drain_mailbox(
    mailbox: TeammateMailbox,
    ctx: TeammateContext,
) -> bool:
    """Read pending mailbox messages and handle shutdown / user messages.

    Returns:
        True if a shutdown message was received (caller should stop the loop).
    """
    try:
        pending = await mailbox.read_all(unread_only=True)
    except Exception:
        pending = []

    for msg in pending:
        try:
            await mailbox.mark_read(msg.id)
        except Exception:
            pass

        if msg.type == "shutdown":
            logger.debug("[in_process] %s: received shutdown message", ctx.agent_id)
            ctx.abort_controller.request_cancel(reason="shutdown message received")
            return True

        elif msg.type == "user_message":
            # Enqueue the message so the query loop can inject it as a new turn.
            logger.debug("[in_process] %s: queuing user_message from mailbox", ctx.agent_id)
            content = msg.payload.get("content", "") if isinstance(msg.payload, dict) else str(msg.payload)
            teammate_msg = TeammateMessage(
                text=content,
                from_agent=msg.sender,
                color=msg.payload.get("color") if isinstance(msg.payload, dict) else None,
                timestamp=str(msg.timestamp),
            )
            await ctx.message_queue.put(teammate_msg)

    return False


async def _run_query_loop(
    query_context: Any,
    config: TeammateSpawnConfig,
    ctx: TeammateContext,
    mailbox: TeammateMailbox,
) -> None:
    """Drive :func:`~openharness.engine.query.run_query` until done or cancelled.

    Between turns we:
    - Drain the mailbox for shutdown requests and user messages.
    - Inject queued user messages as additional turns.
    - Check the abort controller.
    - Track tool_use_count and total_tokens.
    """
    # Deferred import to avoid circular dependencies at module load time.
    from openharness.engine.query import run_query
    from openharness.engine.messages import ConversationMessage

    # Initialize messages: use initial_messages if provided (for session restoration),
    # otherwise start with the prompt as first user message
    messages: list[ConversationMessage] = []
    if config.initial_messages:
        # Restore conversation history from snapshot
        for msg in config.initial_messages:
            messages.append(ConversationMessage.from_dict(msg))
        # Append the new prompt as an additional turn
        messages.append(ConversationMessage.from_user_text(config.prompt))
    else:
        # Fresh conversation
        messages = [ConversationMessage.from_user_text(config.prompt)]

    # Set up streaming queue for real-time deltas (if session_id is set)
    stream_q: asyncio.Queue | None = None
    if config.session_id:
        stream_q = await get_or_create_stream_queue(config.session_id)

    try:
        async for event, usage in run_query(query_context, messages):
            # Track token usage if usage info is provided
            if usage is not None:
                with contextlib.suppress(AttributeError, TypeError):
                    ctx.total_tokens += getattr(usage, "input_tokens", 0)
                    ctx.total_tokens += getattr(usage, "output_tokens", 0)

            # Track tool use count
            if isinstance(event, ToolExecutionStarted):
                ctx.tool_use_count += 1

            # Capture latest assistant text delta
            if isinstance(event, AssistantTextDelta) and event.text:
                ctx.last_assistant_message = (ctx.last_assistant_message or "") + event.text
                if stream_q is not None:
                    with contextlib.suppress(asyncio.QueueFull):
                        stream_q.put_nowait({"type": "delta", "text": event.text})

            # Forward thinking deltas to SSE stream (mirrors AssistantTextDelta handling)
            elif isinstance(event, AssistantThinkingDelta) and event.thinking:
                if stream_q is not None:
                    with contextlib.suppress(asyncio.QueueFull):
                        stream_q.put_nowait({"type": "thinking_delta", "text": event.thinking})

            # When turn completes, extract full text from the message
            # (covers models that don't emit AssistantTextDelta, only tool calls)
            elif isinstance(event, AssistantTurnComplete):
                with contextlib.suppress(Exception):
                    from openharness.engine.messages import TextBlock as _TB2
                    turn_text = "".join(
                        b.text for b in event.message.content
                        if isinstance(b, _TB2) and b.text
                    )
                    if turn_text:
                        had_prior_deltas = bool(ctx.last_assistant_message)
                        ctx.last_assistant_message = turn_text
                        # Push full text as single delta if no streaming deltas came (batch mode)
                        if not had_prior_deltas and stream_q is not None:
                            with contextlib.suppress(asyncio.QueueFull):
                                stream_q.put_nowait({"type": "delta", "text": turn_text})

            # Capture API errors for the summary
            elif isinstance(event, ErrorEvent):
                ctx.last_assistant_message = f"[错误] {event.message}"
                logger.error("[in_process] %s: ErrorEvent: %s", ctx.agent_id, event.message)

            # Push tool-start/end events for frontend tool call cards
            if isinstance(event, ToolExecutionStarted) and stream_q is not None:
                with contextlib.suppress(asyncio.QueueFull):
                    import json as _json
                    try:
                        safe_input = _json.loads(_json.dumps(event.tool_input, default=str))
                    except Exception:
                        safe_input = {}
                    stream_q.put_nowait({"type": "tool_start", "name": event.tool_name, "input": safe_input})
            if isinstance(event, ToolExecutionCompleted) and stream_q is not None:
                with contextlib.suppress(asyncio.QueueFull):
                    stream_q.put_nowait({"type": "tool_end", "output": event.output[:200]})

            # Check for cancellation or shutdown between events
            if ctx.abort_controller.is_cancelled:
                logger.debug(
                    "[in_process] %s: abort_controller cancelled, stopping query loop",
                    ctx.agent_id,
                )
                return

            # Drain mailbox — handle shutdown requests immediately
            should_stop = await _drain_mailbox(mailbox, ctx)
            if should_stop:
                return

            # Drain message queue and inject as new turns
            while not ctx.message_queue.empty():
                try:
                    queued = ctx.message_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
                logger.debug(
                    "[in_process] %s: injecting queued message from %s",
                    ctx.agent_id,
                    queued.from_agent,
                )
                messages.append(ConversationMessage(role="user", content=queued.text))

        ctx.status = "idle"

    finally:
        # Save session BEFORE signalling done so transcript endpoint finds it immediately
        if config.session_id and messages:
            with contextlib.suppress(Exception):
                from openharness.services.session_backend import DEFAULT_SESSION_BACKEND
                from openharness.api.usage import UsageSnapshot
                DEFAULT_SESSION_BACKEND.save_snapshot(
                    cwd=config.cwd or ".",
                    model=query_context.model,
                    system_prompt=query_context.system_prompt,
                    messages=messages,
                    usage=UsageSnapshot(input_tokens=ctx.total_tokens, output_tokens=0),
                    session_id=config.session_id,
                    parent_session_id=config.parent_session_id,
                )

        # Send idle_notification to leader with full result
        try:
            _agent_id = ctx.agent_id
            last_result = ctx.last_assistant_message or ""
            if not last_result and messages:
                for msg in reversed(messages):
                    if msg.role == "assistant":
                        from openharness.engine.messages import TextBlock as _TB
                        for block in msg.content:
                            if isinstance(block, _TB) and block.text.strip():
                                last_result = block.text.strip()
                                break
                        if last_result:
                            break
            if last_result:
                raw_summary = f"{config.name} finished.\n\n{last_result}"
            else:
                raw_summary = f"{config.name} finished (tools={ctx.tool_use_count})"
            summary = raw_summary.encode("utf-8", errors="replace").decode("utf-8")
            idle_msg = create_idle_notification(sender=_agent_id, recipient="leader", summary=summary)
            if config.mailbox_team_path:
                from openharness.swarm.mailbox import get_team_task_mailbox_dir
                _t, _s = config.mailbox_team_path.split("/", 1)
                inbox_path = get_team_task_mailbox_dir(_t, _s, "leader")
                leader_mailbox = TeammateMailbox(config.team, "leader", inbox_dir=inbox_path)
            else:
                leader_mailbox = TeammateMailbox(team_name=config.team, agent_id="leader")
            await leader_mailbox.write(idle_msg)
            # Signal completion for blocked_by dependency scheduling
            if config.mailbox_team_path:
                try:
                    from openharness.swarm.completion_events import signal as _signal_completion
                    _signal_completion(config.mailbox_team_path, _agent_id)
                except Exception as _sig_exc:
                    logger.debug("[in_process] %s: completion signal failed: %s", _agent_id, _sig_exc)
            logger.debug("[in_process] %s: sent idle_notification", _agent_id)
            # Push swarm_status WS event via on_status_change (set by backend_host at session start)
            if config.on_status_change is not None:
                with contextlib.suppress(Exception):
                    from openharness.config.paths import get_config_dir
                    _run_dir = get_config_dir() / "teams-tasks" / _t / _s
                    run_tj_path = _run_dir / "team.json"
                    if run_tj_path.exists():
                        from openharness.swarm.team_lifecycle import TeamFile
                        _rtf = TeamFile.load(run_tj_path)
                        members_data = [m.to_dict() for m in _rtf.members.values()]
                        # Enrich with last_message
                        for md in members_data:
                            if md.get("agent_id") == _agent_id and last_result:
                                md["last_message"] = last_result[:200]
                        config.on_status_change(members_data)
        except Exception as _exc:
            logger.error("[in_process] %s: failed to send idle_notification: %s", ctx.agent_id, _exc)

        # Signal stream end to SSE subscribers (after session is persisted)
        if stream_q is not None:
            with contextlib.suppress(asyncio.QueueFull):
                stream_q.put_nowait(None)


# ---------------------------------------------------------------------------
# InProcessBackend
# ---------------------------------------------------------------------------


@dataclass
class _TeammateEntry:
    """Internal registry entry for a running in-process teammate."""

    task: asyncio.Task[None]
    abort_controller: TeammateAbortController
    task_id: str
    started_at: float = field(default_factory=time.time)


async def _build_member_query_context(config: "TeammateSpawnConfig") -> Any:
    """Build a lightweight QueryContext for an in-process member.

    Uses only the member's system prompt — no global skill files, no CLAUDE.md loading.
    Keeps the system prompt short and avoids surrogate encoding errors from long skill files.
    """
    import pathlib
    from openharness.config.settings import load_settings
    from openharness.prompts.environment import get_environment_info
    from openharness.prompts.system_prompt import _format_environment_section
    from openharness.tools import create_member_tool_registry
    from openharness.engine.query import QueryContext
    from openharness.permissions.checker import PermissionChecker
    from openharness.ui.runtime import _resolve_api_client_from_settings

    settings_overrides: dict[str, Any] = {}
    if config.model:
        settings_overrides["model"] = config.model
    settings = load_settings().merge_cli_overrides(**settings_overrides)

    api_client = _resolve_api_client_from_settings(settings)

    # Member system prompt: role definition + environment section only (no global skills)
    member_sp = (config.system_prompt or "").encode("utf-8", errors="replace").decode("utf-8")
    cwd_path = pathlib.Path(config.cwd or ".").resolve()
    env_info = get_environment_info(cwd=str(cwd_path))
    env_section = _format_environment_section(env_info)
    full_sp = f"{member_sp}\n\n{env_section}" if member_sp else env_section

    tool_registry = create_member_tool_registry()

    return QueryContext(
        api_client=api_client,
        tool_registry=tool_registry,
        permission_checker=PermissionChecker(settings.permission),
        cwd=cwd_path,
        model=settings.model or "unknown",
        system_prompt=full_sp,
        max_tokens=settings.max_tokens or 8096,
    )


class InProcessBackend:
    """TeammateExecutor that runs agents as asyncio Tasks in the current process.

    Context isolation is provided by :mod:`contextvars`: each spawned
    :class:`asyncio.Task` runs with its own copy of the context, so
    :func:`get_teammate_context` returns the correct identity for every
    concurrent agent.
    """

    type: BackendType = "in_process"

    def __init__(self) -> None:
        # Maps agent_id -> _TeammateEntry
        self._active: dict[str, _TeammateEntry] = {}

    # ------------------------------------------------------------------
    # TeammateExecutor protocol
    # ------------------------------------------------------------------

    def is_available(self) -> bool:
        """In-process backend is always available — no external dependencies."""
        return True

    async def spawn(self, config: TeammateSpawnConfig) -> SpawnResult:
        """Spawn an in-process teammate as an asyncio Task.

        Builds a lightweight QueryContext using only the member's system prompt
        (no global skill files loaded), then runs the query loop in-process.
        """
        agent_id = f"{config.name}@{config.team}"
        task_id = f"in_process_{uuid.uuid4().hex[:12]}"

        # Use explicit session_id if provided, otherwise generate new one
        if config.session_id is None:
            config.session_id = uuid.uuid4().hex

        if agent_id in self._active:
            entry = self._active[agent_id]
            if not entry.task.done():
                logger.warning(
                    "[InProcessBackend] spawn(): %s is already running", agent_id
                )
                return SpawnResult(
                    task_id=task_id,
                    agent_id=agent_id,
                    backend_type=self.type,
                    success=False,
                    error=f"Agent {agent_id!r} is already running",
                )

        abort_controller = TeammateAbortController()

        # Build a lightweight QueryContext for the member (no global skill loading)
        try:
            query_context = await _build_member_query_context(config)
        except Exception as exc:
            logger.error("[InProcessBackend] Failed to build query context for %s: %s", agent_id, exc)
            return SpawnResult(
                task_id=task_id,
                agent_id=agent_id,
                backend_type=self.type,
                success=False,
                error=f"Failed to initialize member context: {exc}",
            )

        task = asyncio.create_task(
            start_in_process_teammate(
                config=config,
                agent_id=agent_id,
                abort_controller=abort_controller,
                query_context=query_context,
            ),
            name=f"teammate-{agent_id}",
        )

        entry = _TeammateEntry(
            task=task,
            abort_controller=abort_controller,
            task_id=task_id,
        )
        self._active[agent_id] = entry

        def _on_done(t: asyncio.Task[None]) -> None:
            self._active.pop(agent_id, None)
            if not t.cancelled() and t.exception() is not None:
                self._on_teammate_error(agent_id, t.exception())  # type: ignore[arg-type]

        task.add_done_callback(_on_done)

        logger.debug("[InProcessBackend] spawned %s (task_id=%s)", agent_id, task_id)
        return SpawnResult(
            task_id=task_id,
            agent_id=agent_id,
            backend_type=self.type,
            session_id=config.session_id,
        )

    async def send_message(self, agent_id: str, message: TeammateMessage) -> None:
        """Write *message* to the teammate's file-based mailbox."""
        if "@" not in agent_id:
            raise ValueError(
                f"Invalid agent_id {agent_id!r}: expected 'agentName@teamName'"
            )
        agent_name, team_name = agent_id.split("@", 1)

        from openharness.swarm.mailbox import MailboxMessage

        msg = MailboxMessage(
            id=str(uuid.uuid4()),
            type="user_message",
            sender=message.from_agent,
            recipient=agent_id,
            payload={
                "content": message.text,
                **({"color": message.color} if message.color else {}),
            },
            timestamp=message.timestamp and float(message.timestamp) or time.time(),
        )
        mailbox = TeammateMailbox(team_name=team_name, agent_id=agent_name)
        await mailbox.write(msg)
        logger.debug("[InProcessBackend] sent message to %s", agent_id)

    async def shutdown(
        self, agent_id: str, *, force: bool = False, timeout: float = 10.0
    ) -> bool:
        """Terminate a running in-process teammate. Returns True if found."""
        entry = self._active.get(agent_id)
        if entry is None:
            logger.debug(
                "[InProcessBackend] shutdown(): %s not found in active tasks", agent_id
            )
            return False

        if entry.task.done():
            self._active.pop(agent_id, None)
            return True

        if force:
            entry.abort_controller.request_cancel(reason="force shutdown", force=True)
            entry.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await asyncio.wait_for(asyncio.shield(entry.task), timeout=timeout)
        else:
            # Graceful: request cancel and wait for self-exit
            entry.abort_controller.request_cancel(reason="graceful shutdown")
            try:
                await asyncio.wait_for(asyncio.shield(entry.task), timeout=timeout)
            except asyncio.TimeoutError:
                logger.warning(
                    "[InProcessBackend] %s did not exit within %.1fs — forcing cancel",
                    agent_id,
                    timeout,
                )
                entry.abort_controller.request_cancel(reason="timeout — forcing", force=True)
                entry.task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await entry.task

        await self._cleanup_teammate(agent_id)
        logger.debug("[InProcessBackend] shut down %s", agent_id)
        return True

    def is_alive(self, session_id: str) -> bool:
        """Check if a session is still running.

        Args:
            session_id: Session ID to check (matches agent_id or internal identifier)

        Returns:
            True if session exists and task is not done, False otherwise
        """
        # For in_process backend, session_id is typically the agent_id
        # Check if agent_id exists in _active and task is not done
        for agent_id, entry in self._active.items():
            if agent_id == session_id or entry.task_id == session_id:
                return not entry.task.done()
        return False

    # ------------------------------------------------------------------
    # Enhanced lifecycle management
    # ------------------------------------------------------------------

    async def _cleanup_teammate(self, agent_id: str) -> None:
        """Remove agent from registry and ensure abort controller is signalled."""
        entry = self._active.pop(agent_id, None)
        if entry is None:
            return

        # Ensure the abort controller is signalled so any waiters unblock
        if not entry.abort_controller.is_cancelled:
            entry.abort_controller.request_cancel(reason="cleanup")

        logger.debug(
            "[InProcessBackend] _cleanup_teammate: %s removed from registry", agent_id
        )

    def _on_teammate_error(self, agent_id: str, error: Exception) -> None:
        """Handle an unhandled exception from a teammate Task.

        Logs a structured error report and removes the entry from the registry.
        In future this can emit a TaskNotification to the leader mailbox.
        """
        duration = 0.0
        entry = self._active.get(agent_id)
        if entry is not None:
            duration = time.time() - entry.started_at
            self._active.pop(agent_id, None)

        logger.error(
            "[InProcessBackend] Teammate %s raised an unhandled exception "
            "(duration=%.1fs): %s: %s",
            agent_id,
            duration,
            type(error).__name__,
            error,
        )

    def get_teammate_status(self, agent_id: str) -> dict[str, Any] | None:
        """Return status dict for *agent_id*, or None if not in registry."""
        entry = self._active.get(agent_id)
        if entry is None:
            return None

        return {
            "agent_id": agent_id,
            "task_id": entry.task_id,
            "is_done": entry.task.done(),
            "duration_s": time.time() - entry.started_at,
        }

    def list_teammates(self) -> list[tuple[str, bool, float]]:
        """Return list of (agent_id, is_running, duration_seconds) tuples."""
        now = time.time()
        result = []
        for agent_id, entry in self._active.items():
            is_running = not entry.task.done()
            duration = now - entry.started_at
            result.append((agent_id, is_running, duration))
        return result

    # ------------------------------------------------------------------
    # Convenience helpers
    # ------------------------------------------------------------------

    def is_active(self, agent_id: str) -> bool:
        """Return *True* if the teammate has a running (not-done) Task."""
        entry = self._active.get(agent_id)
        if entry is None:
            return False
        return not entry.task.done()

    def active_agents(self) -> list[str]:
        """Return a list of agent_ids with currently running Tasks."""
        return [aid for aid, entry in self._active.items() if not entry.task.done()]

    async def shutdown_all(self, *, force: bool = False, timeout: float = 10.0) -> None:
        """Gracefully (or forcefully) terminate all active teammates."""
        agent_ids = list(self._active.keys())
        await asyncio.gather(
            *(self.shutdown(aid, force=force, timeout=timeout) for aid in agent_ids),
            return_exceptions=True,
        )
