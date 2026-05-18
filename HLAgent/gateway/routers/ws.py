"""WebSocket router — bridges WebSocket messages to/from WebBackendHost queues."""

from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from openharness.ui.protocol import FrontendRequest, BackendEvent

from services.session_manager import session_mgr

log = logging.getLogger(__name__)
router = APIRouter(tags=["ws"])

# Track the active forward_events task per session.
# Ensures only ONE consumer reads from the event queue at a time.
# Without this, React StrictMode's double-mount creates two simultaneous
# consumers; whichever wins the race gets tool_completed — the real
# browser connection may end up with the tool stuck as pending forever.
_active_event_tasks: dict[str, asyncio.Task] = {}


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str) -> None:
    host = session_mgr.get(session_id)
    if host is None:
        await websocket.close(code=4004, reason="Session not found")
        return

    # Displace any existing event consumer for this session before accepting.
    # If the old task was blocked in next_event() the queue item is NOT
    # consumed (asyncio.Queue.get() rolls back on CancelledError).
    # If it was between get() and send_json(), the event is re-enqueued
    # by the CancelledError handler inside forward_events().
    old_task = _active_event_tasks.pop(session_id, None)
    if old_task and not old_task.done():
        old_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await old_task

    await websocket.accept()

    already_ready = host.is_ready

    if already_ready:
        # Drain only None sentinels from previous shutdown — do NOT discard
        # legitimate events queued while the browser was disconnected.
        host.drain_stale_events()

        # Re-initialise client state.
        state = host.app_state
        if state:
            try:
                from openharness.tasks import get_task_manager
                tasks = get_task_manager().list_tasks()
                resync = BackendEvent.ready(state, tasks, host.commands)
                await websocket.send_json(resync.model_dump())
            except Exception as exc:
                log.warning("Failed to send resync ready event: %s", exc)

        # Clear the client's local transcript before replaying.
        await websocket.send_json(BackendEvent(type="clear_transcript").model_dump())

        # Replay conversation history.
        await _replay_transcript(websocket, host)
    else:
        await host.start()

    async def forward_events() -> None:
        """Read BackendEvents from host queue and send to WebSocket."""
        event: BackendEvent | None = None
        try:
            while True:
                log.info("[FWD] waiting for next event (session=%s)", session_id[:8])
                event = await host.next_event()
                if event is None:
                    log.info("[FWD] sentinel received, exiting (session=%s)", session_id[:8])
                    break
                log.info("[FWD] sending event type=%s (session=%s)", event.type, session_id[:8])
                await websocket.send_json(event.model_dump())
                event = None  # clear only after successful send
        except asyncio.CancelledError:
            if event is not None:
                await host.requeue_event(event)
            raise
        except Exception as exc:
            log.warning("[FWD] send error, requeuing event: %s", exc)
            if event is not None:
                await host.requeue_event(event)

    async def forward_requests() -> None:
        """Read WebSocket messages and push to host input queue."""
        try:
            async for raw in websocket.iter_text():
                try:
                    req = FrontendRequest.model_validate_json(raw)
                    await host.push_request(req)
                except Exception as exc:
                    log.warning("Invalid FrontendRequest: %s", exc)
        except WebSocketDisconnect:
            pass

    event_task = asyncio.create_task(forward_events())
    _active_event_tasks[session_id] = event_task
    request_task = asyncio.create_task(forward_requests())

    try:
        done, pending = await asyncio.wait(
            [event_task, request_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
    finally:
        _active_event_tasks.pop(session_id, None)
        try:
            await websocket.close()
        except Exception:
            pass


async def _replay_transcript(websocket: WebSocket, host: object) -> None:
    """Replay conversation history to a newly (re-)connected WS client."""
    try:
        from openharness.ui.protocol import TranscriptItem
        from openharness.engine.messages import ToolUseBlock, ToolResultBlock, TextBlock

        messages = host.get_messages()  # type: ignore[attr-defined]
        if not messages:
            return

        for msg in messages:
            role = getattr(msg, "role", None)
            content = getattr(msg, "content", [])
            if role not in ("user", "assistant"):
                continue

            text_parts = [
                block.text for block in content
                if isinstance(block, TextBlock) and block.text.strip()
            ]
            tool_uses = [block for block in content if isinstance(block, ToolUseBlock)]
            tool_results = [block for block in content if isinstance(block, ToolResultBlock)]

            if text_parts:
                item = TranscriptItem(role=role, text="\n".join(text_parts))
                event = BackendEvent(type="transcript_item", item=item)
                await websocket.send_json(event.model_dump())

            for tu in tool_uses:
                import json as _json
                tool_text = f"{tu.name} {_json.dumps(tu.input, ensure_ascii=False)[:200]}"
                item = TranscriptItem(
                    role="tool",
                    text=tool_text,
                    tool_name=tu.name,
                    tool_input=tu.input,
                )
                await websocket.send_json(
                    BackendEvent(type="transcript_item", item=item).model_dump()
                )

            for tr in tool_results:
                content_str = tr.content if isinstance(tr.content, str) else str(tr.content)
                item = TranscriptItem(
                    role="tool_result",
                    text=content_str[:1000],
                    is_error=tr.is_error,
                )
                await websocket.send_json(
                    BackendEvent(type="transcript_item", item=item).model_dump()
                )

    except Exception as exc:
        log.warning("Failed to replay transcript: %s", exc)
