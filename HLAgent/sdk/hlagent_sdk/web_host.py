"""WebBackendHost — ReactBackendHost variant using asyncio queues for I/O.

Instead of reading from sys.stdin and writing to sys.stdout (as the TUI does),
this host reads FrontendRequests from an asyncio queue and puts BackendEvents
into another asyncio queue.  The Gateway bridges WebSocket messages to/from
these queues, reusing 100% of the ReactBackendHost event-dispatch logic.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass

from openharness.state.app_state import AppState
from openharness.ui.backend_host import BackendHostConfig, ReactBackendHost
from openharness.ui.protocol import BackendEvent, FrontendRequest


@dataclass
class AgentSessionConfig:
    """Configuration for one HLAgent session."""

    model: str | None = None
    cwd: str | None = None
    permission_mode: str | None = None
    system_prompt: str | None = None
    max_turns: int | None = None
    api_key: str | None = None
    api_format: str | None = None
    active_profile: str | None = None


class WebBackendHost(ReactBackendHost):
    """ReactBackendHost that communicates via asyncio queues instead of stdio.

    Two queues bridge this host with the Gateway WebSocket handler:
      _ws_input_queue:  Gateway writes FrontendRequests here (from WebSocket)
      _event_queue:     Gateway reads BackendEvents here (to WebSocket)

    The rest of ReactBackendHost — permission/question Futures, interrupt
    handling, StreamEvent→BackendEvent mapping — is inherited unchanged.
    """

    def __init__(self, config: BackendHostConfig) -> None:
        super().__init__(config)
        self._ws_input_queue: asyncio.Queue[FrontendRequest | None] = asyncio.Queue()
        self._event_queue: asyncio.Queue[BackendEvent | None] = asyncio.Queue()
        self._run_task: asyncio.Task | None = None  # track the run() task

    # ------------------------------------------------------------------ #
    # Public interface for Gateway
    # ------------------------------------------------------------------ #

    async def push_request(self, request: FrontendRequest) -> None:
        """Inject a FrontendRequest received from WebSocket into the host."""
        await self._ws_input_queue.put(request)

    async def next_event(self) -> BackendEvent | None:
        """Consume the next BackendEvent to forward to the WebSocket client.

        Returns None when the session has ended (sentinel from _emit).
        """
        return await self._event_queue.get()

    async def start(self) -> None:
        """Run the agent loop as a background task (idempotent — only starts once)."""
        if self._run_task is None or self._run_task.done():
            self._run_task = asyncio.create_task(self.run(), name="web-backend-host")

    def drain_stale_events(self) -> None:
        """Drain leftover events/sentinels from a previous WS connection.

        Called when a new WS client connects to an already-running session so
        that stale None sentinels from previous shutdowns don't cause the
        forward_events loop to exit prematurely.
        """
        drained = 0
        while not self._event_queue.empty():
            try:
                self._event_queue.get_nowait()
                drained += 1
            except Exception:
                break
        if drained:
            import logging
            logging.getLogger(__name__).debug("Drained %d stale events from queue", drained)

    async def stop(self) -> None:
        """Signal the host to shut down gracefully."""
        await self._ws_input_queue.put(FrontendRequest(type="shutdown"))

    # ------------------------------------------------------------------ #
    # State reading interface for Gateway REST handlers
    # ------------------------------------------------------------------ #

    @property
    def is_ready(self) -> bool:
        """Return True once build_runtime() has completed and _bundle is set."""
        return self._bundle is not None

    @property
    def app_state(self) -> AppState | None:
        """Return current AppState (only valid when is_ready=True)."""
        if self._bundle is None:
            return None
        return self._bundle.app_state.get()

    @property
    def commands(self) -> list[str]:
        """Return list of available slash commands (only valid when is_ready=True)."""
        if self._bundle is None:
            return []
        return [f"/{cmd.name}" for cmd in self._bundle.commands.list_commands()]

    def get_system_prompt(self) -> str | None:
        """Return current system prompt (only valid when is_ready=True)."""
        if self._bundle is None:
            return None
        return self._bundle.engine.system_prompt

    def get_messages(self) -> list:
        """Return current conversation history (only valid when is_ready=True)."""
        if self._bundle is None:
            return []
        return list(self._bundle.engine.messages)

    def pop_last_turn(self) -> bool:
        """Remove the last user+assistant message pair (/rewind). Returns True if removed."""
        if self._bundle is None:
            return False
        msgs = self._bundle.engine.messages
        if not msgs:
            return False
        # Remove messages from the end until we remove a user message
        new_msgs = list(msgs)
        while new_msgs and new_msgs[-1].role != "user":
            new_msgs.pop()
        if new_msgs and new_msgs[-1].role == "user":
            new_msgs.pop()
        if len(new_msgs) < len(msgs):
            self._bundle.engine.load_messages(new_msgs)
            return True
        return False

    def get_session_id(self) -> str | None:
        """Return the internal openharness session_id (12-char hex)."""
        if self._bundle is None:
            return None
        return self._bundle.session_id

    def get_session_backend(self):
        """Return the SessionBackend instance (only valid when is_ready=True)."""
        if self._bundle is None:
            return None
        return self._bundle.session_backend

    # ------------------------------------------------------------------ #
    # Overrides — replace stdin/stdout I/O with queue I/O
    # ------------------------------------------------------------------ #

    async def _read_requests(self) -> None:
        """Read FrontendRequests from the WebSocket input queue.

        Replaces the stdin-based _read_requests in ReactBackendHost.
        Routes permission/question/interrupt responses directly (matching
        the original stdin handler logic) before queuing the rest.
        """
        while True:
            item = await self._ws_input_queue.get()
            if item is None:
                await self._request_queue.put(FrontendRequest(type="shutdown"))
                return

            request = item

            if (
                request.type == "permission_response"
                and request.request_id in self._permission_requests
            ):
                future = self._permission_requests[request.request_id]
                if not future.done():
                    future.set_result(bool(request.allowed))
                continue

            if (
                request.type == "question_response"
                and request.request_id in self._question_requests
            ):
                future = self._question_requests[request.request_id]
                if not future.done():
                    future.set_result(request.answer or "")
                continue

            if request.type == "interrupt":
                await self._interrupt_active_request()
                continue

            await self._request_queue.put(request)

    async def _emit(self, event: BackendEvent) -> None:
        """Put a BackendEvent into the output queue for the Gateway to consume.

        Replaces the stdout-based _emit in ReactBackendHost.
        A None sentinel is enqueued after shutdown so Gateway can detect EOF.
        """
        await self._event_queue.put(event)
        if event.type == "shutdown":
            await self._event_queue.put(None)


def create_host(config: AgentSessionConfig) -> WebBackendHost:
    """Create a WebBackendHost from a high-level AgentSessionConfig."""
    host_config = BackendHostConfig(
        model=config.model,
        cwd=config.cwd,
        permission_mode=config.permission_mode,
        system_prompt=config.system_prompt,
        max_turns=config.max_turns,
        api_key=config.api_key,
        api_format=config.api_format,
        active_profile=config.active_profile,
    )
    return WebBackendHost(host_config)
