"""WebBackendHost — ReactBackendHost variant using asyncio queues for I/O.

Instead of reading from sys.stdin and writing to sys.stdout (as the TUI does),
this host reads FrontendRequests from an asyncio queue and puts BackendEvents
into another asyncio queue.  The Gateway bridges WebSocket messages to/from
these queues, reusing 100% of the ReactBackendHost event-dispatch logic.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from dataclasses import dataclass
from pathlib import Path

from openharness.state.app_state import AppState
from openharness.ui.backend_host import BackendHostConfig, ReactBackendHost
from openharness.ui.protocol import BackendEvent, FrontendRequest, MediaItem, TranscriptItem

log = logging.getLogger(__name__)


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
    expert_role: str | None = None
    expert_role_label: str | None = None


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
        # _last_interrupted is defined on the base class; no redefinition needed.

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
        """Drain all queued events from the previous WS connection.

        Called on reconnect; clears all buffered events so the replay +
        clear_transcript mechanism delivers a clean, consistent state.
        engine.messages is the authoritative source replayed to the client.
        """
        count = 0
        while not self._event_queue.empty():
            try:
                self._event_queue.get_nowait()
                count += 1
            except Exception:
                break
        if count:
            import logging
            logging.getLogger(__name__).debug("Drained %d stale events from queue", count)

    async def requeue_event(self, event: BackendEvent) -> None:
        """Re-enqueue an event retrieved from the queue but not yet sent.

        Called by the forward_events coroutine when it is displaced by a
        newer WS connection (CancelledError) so the event is not lost.
        """
        await self._event_queue.put(event)

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

    @property
    def last_interrupted(self) -> bool:
        """True if the last active request was interrupted by the user."""
        return self._last_interrupted

    @last_interrupted.setter
    def last_interrupted(self, value: bool) -> None:
        self._last_interrupted = value
    def get_session_backend(self):
        """Return the SessionBackend instance (only valid when is_ready=True)."""
        if self._bundle is None:
            return None
        return self._bundle.session_backend

    def get_pending_questions(self) -> list[dict]:
        """Return modal_request payloads for all pending ask_user_question calls.

        Used by the WebSocket reconnect handler to re-send question modals that
        were drained from the event queue before the client reconnected.
        """
        return [
            {"kind": "question", "request_id": req_id, "question": self._question_texts.get(req_id, "")}
            for req_id, future in self._question_requests.items()
            if not future.done()
        ]

    # ------------------------------------------------------------------ #
    # Attachment processing — overrides base _build_submit_coroutine
    # ------------------------------------------------------------------ #

    async def _build_submit_coroutine(self, request: FrontendRequest):
        """Override: when attachments present, process them before submitting."""
        if request.attachments:
            return self._process_message_with_attachments(request)
        return await super()._build_submit_coroutine(request)

    async def _process_message_with_attachments(self, request: FrontendRequest) -> bool:
        """Process attachments, build ConversationMessage, submit to engine."""
        from openharness.services.attachment_processor import process_attachments
        from openharness.engine.messages import ConversationMessage, TextBlock, ImageBlock, DocumentBlock

        assert self._bundle is not None
        _cancelled = False
        try:
            return await self._process_message_with_attachments_inner(request)
        except asyncio.CancelledError:
            _cancelled = True
            raise
        except Exception as exc:
            log.warning("Unhandled error in _process_message_with_attachments: %s", exc)
            await self._emit(BackendEvent(type="error", message=f"附件处理错误：{exc}"))
            return True
        finally:
            # Only emit line_complete for non-cancel exits.  On CancelledError,
            # _run_active_request is responsible for emitting line_complete,
            # preventing the double-emit that would otherwise occur.
            if not _cancelled:
                await self._emit(BackendEvent(type="line_complete"))

    async def _process_message_with_attachments_inner(self, request: FrontendRequest) -> bool:
        """Inner implementation — called by _process_message_with_attachments."""
        from openharness.services.attachment_processor import process_attachments
        from openharness.engine.messages import ConversationMessage, TextBlock, ImageBlock, DocumentBlock

        assert self._bundle is not None

        # Save non-text/image uploads to ~/.hlagent/uploads/ so the model gets a
        # full absolute path it can pass to read_file or other tools.
        _hlagent_home = Path(os.environ.get("HLAGENT_CONFIG_DIR", Path.home() / ".hlagent"))
        upload_dir = _hlagent_home / "uploads"
        content_blocks, errors = process_attachments(request.attachments or [], upload_dir=upload_dir)

        if errors and not content_blocks:
            for err in errors:
                await self._emit(BackendEvent(type="error", message=err.message))
            return True

        # Emit per-file errors that didn't block everything
        for err in errors:
            await self._emit(BackendEvent(type="error", message=err.message))

        # Build user_media for transcript display — derived from original attachments
        # so every attachment (image, document, or other) gets a visual chip.
        user_media: list[MediaItem] = []
        doc_confirmations: list[str] = []

        for att, block in zip(request.attachments or [], content_blocks):
            if isinstance(block, ImageBlock):
                # Inline image — show thumbnail
                user_media.append(MediaItem(
                    type="image",
                    data=block.data,
                    media_type=block.media_type,
                    source_path=block.source_path or None,
                    filename=att.filename,
                ))
            elif isinstance(block, DocumentBlock):
                # Text file extracted inline — show doc chip + confirmation
                user_media.append(MediaItem(
                    type="document",
                    data="",
                    media_type=block.mime_type,
                    filename=block.filename,
                ))
                char_count = len(block.text_content)
                doc_confirmations.append(f"📄 {block.filename} 已读取（约 {char_count:,} 字）")
            else:
                # TextBlock fallback (audio / video / PDF / DOCX / etc.) — show chip only
                user_media.append(MediaItem(
                    type="document",
                    data="",
                    media_type=att.mime_type,
                    filename=att.filename,
                ))

        line = (request.line or "").strip()

        # Emit document extraction confirmation messages
        for msg in doc_confirmations:
            await self._emit(BackendEvent(
                type="transcript_item",
                item=TranscriptItem(role="system", text=msg),
            ))

        # Emit user TranscriptItem with media
        await self._emit(BackendEvent(
            type="transcript_item",
            item=TranscriptItem(role="user", text=line, media=user_media or None),
        ))

        # Build ConversationMessage: unified multi-block structure.
        # Attachment blocks (ImageBlock / DocumentBlock / TextBlock) come first,
        # then the user's instruction as the final TextBlock.  This gives a
        # consistent layout regardless of file type:
        #   [attach1, attach2, ..., TextBlock("user instruction")]
        message_content: list = list(content_blocks)
        if line:
            message_content.append(TextBlock(text=line))
        message = ConversationMessage.from_user_content(message_content)

        from openharness.ui.coordinator_drain import drain_coordinator_async_agents
        from openharness.coordinator.coordinator_mode import is_coordinator_mode

        async def _print_system(message: str) -> None:
            await self._emit(BackendEvent(type="transcript_item", item=TranscriptItem(role="system", text=message)))

        async def _clear_output() -> None:
            await self._emit(BackendEvent(type="clear_transcript"))

        from openharness.ui.runtime import handle_message
        should_continue = await handle_message(
            self._bundle,
            message,
            print_system=_print_system,
            render_event=self._render_stream_event,
            clear_output=_clear_output,
        )
        if is_coordinator_mode():
            await drain_coordinator_async_agents(
                self._bundle,
                prompt_seed=line,
                print_system=_print_system,
                render_event=self._render_stream_event,
            )
        await self._emit(self._status_snapshot())
        await self._emit(BackendEvent.tasks_snapshot(get_task_manager().list_tasks()))
        return should_continue

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
            # Clear the interrupt flag once a new user request is submitted
            self._last_interrupted = False

    async def _emit(self, event: BackendEvent) -> None:
        """Put a BackendEvent into the output queue for the Gateway to consume.

        Replaces the stdout-based _emit in ReactBackendHost.
        A None sentinel is enqueued after shutdown so Gateway can detect EOF.
        """
        await self._event_queue.put(event)
        if event.type == "shutdown":
            await self._event_queue.put(None)


def create_host(
    config: AgentSessionConfig,
    restore_snapshot: dict | None = None,
) -> WebBackendHost:
    """Create a WebBackendHost from a high-level AgentSessionConfig.

    若传入 restore_snapshot，从 snapshot 中恢复消息历史和配置（config 显式值优先）。
    """
    snap = restore_snapshot or {}
    host_config = BackendHostConfig(
        model=config.model or snap.get("model"),
        cwd=config.cwd or snap.get("cwd"),
        permission_mode=config.permission_mode or snap.get("permission_mode"),
        system_prompt=config.system_prompt or snap.get("system_prompt"),
        max_turns=config.max_turns,
        api_key=config.api_key,
        api_format=config.api_format or snap.get("api_format"),
        active_profile=config.active_profile or snap.get("active_profile"),
        restore_messages=snap.get("messages") or None,
        restore_tool_metadata=snap.get("tool_metadata") or None,
    )
    return WebBackendHost(host_config)
