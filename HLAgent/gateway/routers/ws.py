"""WebSocket router — bridges WebSocket messages to/from WebBackendHost queues."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from openharness.ui.protocol import FrontendRequest, BackendEvent

from services.session_manager import session_mgr

log = logging.getLogger(__name__)
router = APIRouter(tags=["ws"])


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str) -> None:
    host = session_mgr.get(session_id)
    if host is None:
        await websocket.close(code=4004, reason="Session not found")
        return

    await websocket.accept()

    already_ready = host.is_ready

    if already_ready:
        # Session is alive from a previous WS connection.
        # Drain any stale events (e.g. leftover None sentinels) so forward_events
        # doesn't exit immediately.
        host.drain_stale_events()

        # Send synthetic ready to re-initialize client state.
        state = host.app_state
        if state:
            try:
                from openharness.tasks import get_task_manager
                tasks = get_task_manager().list_tasks()
                resync = BackendEvent.ready(state, tasks, host.commands)
                await websocket.send_json(resync.model_dump())
            except Exception as exc:
                log.warning("Failed to send resync ready event: %s", exc)

        # Clear the client's local transcript before replaying to avoid duplication.
        # (The client store may still hold transcript from the previous WS connection.)
        await websocket.send_json(BackendEvent(type="clear_transcript").model_dump())

        # Replay conversation history so the client can restore its transcript.
        await _replay_transcript(websocket, host)
    else:
        # Start the host runtime in the background (non-blocking, idempotent).
        # host.run() internally calls build_runtime → start_runtime → emits ready.
        # Gateway does NOT manually send a ready event on first connect.
        await host.start()

    async def forward_events() -> None:
        """Read BackendEvents from host queue and send to WebSocket."""
        while True:
            event = await host.next_event()
            if event is None:
                break
            try:
                await websocket.send_json(event.model_dump())
            except Exception:
                break

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
        # DO NOT stop the host when WS disconnects.
        # The session stays alive so the user can reconnect and continue.
        # The host is only stopped explicitly via DELETE /api/sessions/{id}
        # or when the user sends a shutdown FrontendRequest.
        try:
            await websocket.close()
        except Exception:
            pass


async def _replay_transcript(websocket: WebSocket, host: object) -> None:
    """Replay conversation history to a newly (re-)connected WS client.

    Converts engine.messages (ConversationMessage objects) into transcript_item
    BackendEvents so the frontend can restore the visible conversation history.
    User/assistant text messages are replayed. Tool calls/results are included
    in a simplified form.
    """
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

            # Extract text from text blocks
            text_parts = [
                block.text for block in content
                if isinstance(block, TextBlock) and block.text.strip()
            ]
            # Extract tool uses (assistant side)
            tool_uses = [
                block for block in content if isinstance(block, ToolUseBlock)
            ]
            # Extract tool results (user side wrapping tool results)
            tool_results = [
                block for block in content if isinstance(block, ToolResultBlock)
            ]

            # Send text portion
            if text_parts:
                item = TranscriptItem(role=role, text="\n".join(text_parts))
                event = BackendEvent(type="transcript_item", item=item)
                await websocket.send_json(event.model_dump())

            # Send tool calls (assistant) as tool transcript items
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

            # Send tool results (user)
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

