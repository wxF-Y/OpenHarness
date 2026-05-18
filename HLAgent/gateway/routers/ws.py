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

        # Send a synthetic ready event to re-initialize the client state.
        state = host.app_state
        if state:
            try:
                from openharness.tasks import get_task_manager
                tasks = get_task_manager().list_tasks()
                resync = BackendEvent.ready(state, tasks, host.commands)
                await websocket.send_json(resync.model_dump())
            except Exception as exc:
                log.warning("Failed to send resync ready event: %s", exc)
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

