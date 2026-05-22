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

# Security note: This WebSocket endpoint authenticates only by session_id existence.
# It is designed for LOCAL use only (the HLAgent gateway binds to localhost).
# Do not expose this service on a public network interface without adding token auth.

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
                await websocket.send_json(resync.model_dump(exclude_none=True))
            except Exception as exc:
                log.warning("Failed to send resync ready event: %s", exc)

        # Clear the client's local transcript before replaying.
        await websocket.send_json(BackendEvent(type="clear_transcript").model_dump(exclude_none=True))

        # Replay conversation history (interrupt marker, if any, is replayed inside).
        await _replay_transcript(websocket, host)

        # Re-send any pending question or permission modals that were drained
        # from the event queue before the client reconnected.  Without this,
        # the client has no way to respond and the session stays frozen.
        pending_questions = getattr(host, "get_pending_questions", lambda: [])()
        for modal_payload in pending_questions:
            await websocket.send_json(
                BackendEvent(type="modal_request", modal=modal_payload).model_dump(exclude_none=True)
            )
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
                await websocket.send_json(event.model_dump(exclude_none=True))
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
                except Exception as exc:
                    log.warning("Invalid FrontendRequest: %s", exc)
                    continue

                # [6.2] Server-side attachment size validation (don't trust client size_bytes)
                if req.attachments:
                    _5MB = 5 * 1024 * 1024
                    _10MB = 10 * 1024 * 1024
                    single_max = max((len(a.data) * 3 // 4 for a in req.attachments), default=0)
                    total = sum(len(a.data) * 3 // 4 for a in req.attachments)
                    if single_max > _5MB or total > _10MB:
                        err = BackendEvent(type="error", message="附件过大：单文件限制 5MB，总计限制 10MB")
                        await websocket.send_json(err.model_dump(exclude_none=True))
                        continue

                await host.push_request(req)
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
        import mimetypes as _mt
        import re as _re
        from openharness.ui.protocol import MediaItem, TranscriptItem
        from openharness.engine.messages import (
            DocumentBlock, ImageBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock, TextBlock,
            parse_system_event, system_event_ui_label,
        )

        # Strip both old <document> (legacy) and new <attachment> XML from user text
        _DOC_RE = _re.compile(r"<document>.*?</document>", _re.DOTALL)
        _ATT_RE = _re.compile(r"<attachment[^>]*>.*?</attachment>", _re.DOTALL)
        # Parse filename= attribute from unified <attachment filename="..."> tags
        _ATT_FN_RE = _re.compile(r'<attachment\s[^>]*filename="([^"]+)"', _re.DOTALL)

        def _clean_user_text(raw: str) -> str:
            clean = _DOC_RE.sub("", raw)
            clean = _ATT_RE.sub("", clean)
            return clean.strip()

        def _rebuild_media(blocks) -> list | None:
            media = []
            for block in blocks:
                if isinstance(block, ImageBlock):
                    media.append(MediaItem(
                        type="image",
                        data=block.data,
                        media_type=block.media_type,
                        source_path=block.source_path or None,
                        filename=block.source_path.split("/")[-1] if block.source_path else None,
                    ))
                elif isinstance(block, DocumentBlock):
                    # DocumentBlock stored as-is (not merged) — unified multi-block layout
                    media.append(MediaItem(
                        type="document", data="",
                        media_type=block.mime_type, filename=block.filename,
                    ))
                elif isinstance(block, TextBlock):
                    # TextBlock for PDF/other: parse filename from <attachment filename="...">
                    for m in _ATT_FN_RE.finditer(block.text):
                        fn = m.group(1).strip()
                        if fn:
                            mime, _ = _mt.guess_type(fn)
                            media.append(MediaItem(
                                type="document", data="",
                                media_type=mime or "application/octet-stream", filename=fn,
                            ))
            return media or None

        messages = host.get_messages()  # type: ignore[attr-defined]
        if not messages:
            return

        for msg in messages:
            role = getattr(msg, "role", None)
            content = getattr(msg, "content", [])
            if role not in ("user", "assistant"):
                continue

            # System event marker stored as a user message — display as system transcript item.
            sys_event = parse_system_event(msg)
            if sys_event is not None:
                event_type, detail = sys_event
                label = system_event_ui_label(event_type, detail)
                await websocket.send_json(
                    BackendEvent(
                        type="transcript_item",
                        item=TranscriptItem(role="system", text=label),
                    ).model_dump(exclude_none=True)
                )
                continue

            text_parts = [
                block.text for block in content
                if isinstance(block, TextBlock) and block.text.strip()
            ]
            tool_uses = [block for block in content if isinstance(block, ToolUseBlock)]
            tool_results = [block for block in content if isinstance(block, ToolResultBlock)]

            thinking_parts = [
                block.thinking for block in content
                if role == "assistant" and isinstance(block, ThinkingBlock) and block.thinking.strip()
            ]

            if text_parts:
                raw_text = "\n".join(text_parts)
                if role == "user":
                    display_text = _clean_user_text(raw_text)
                    media = _rebuild_media(content)
                else:
                    display_text = raw_text
                    media = None
                if display_text:
                    item = TranscriptItem(
                        role=role,
                        text=display_text,
                        media=media,
                        thinking="\n".join(thinking_parts) if thinking_parts else None,
                    )
                    await websocket.send_json(
                        BackendEvent(type="transcript_item", item=item).model_dump(exclude_none=True)
                    )
            elif thinking_parts:
                # Assistant turn with thinking but no text (e.g. before a tool call)
                item = TranscriptItem(
                    role=role,
                    text="",
                    thinking="\n".join(thinking_parts),
                )
                await websocket.send_json(
                    BackendEvent(type="transcript_item", item=item).model_dump(exclude_none=True)
                )

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
                    BackendEvent(type="transcript_item", item=item).model_dump(exclude_none=True)
                )

            for tr in tool_results:
                # [6.4] Handle ToolResultBlock.content: str | list[dict]
                if isinstance(tr.content, list):
                    text_parts_tr = [
                        b.get("text", "") for b in tr.content
                        if isinstance(b, dict) and b.get("type") == "text"
                    ]
                    text = "\n".join(text_parts_tr)[:1000]
                    # Restore lazy image MediaItems from source_path
                    media = [
                        MediaItem(
                            type="image",
                            data="",
                            media_type=b.get("media_type", "image/png"),
                            source_path=b.get("source_path"),
                            filename=(b.get("source_path", "") or "").split("/")[-1] or None,
                        )
                        for b in tr.content
                        if isinstance(b, dict) and b.get("type") == "image"
                    ] or None
                else:
                    text = (tr.content or "")[:1000]
                    media = None

                item = TranscriptItem(
                    role="tool_result",
                    text=text,
                    is_error=tr.is_error,
                    media=media,
                )
                await websocket.send_json(
                    BackendEvent(type="transcript_item", item=item).model_dump(exclude_none=True)
                )

    except Exception as exc:
        log.warning("Failed to replay transcript: %s", exc)
