"""Sessions REST router."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from hlagent_sdk import AgentSessionConfig
from services.session_manager import session_mgr

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


class CreateSessionRequest(BaseModel):
    model: str | None = None
    cwd: str | None = None
    permission_mode: str | None = None
    system_prompt: str | None = None
    max_turns: int | None = None
    api_key: str | None = None
    api_format: str | None = None
    active_profile: str | None = None


@router.post("", status_code=201)
async def create_session(req: CreateSessionRequest) -> dict[str, Any]:
    config = AgentSessionConfig(
        model=req.model,
        cwd=req.cwd,
        permission_mode=req.permission_mode,
        system_prompt=req.system_prompt,
        max_turns=req.max_turns,
        api_key=req.api_key,
        api_format=req.api_format,
        active_profile=req.active_profile,
    )
    session_id, _ = session_mgr.create(config)
    return {"session_id": session_id, "status": "created"}


@router.get("/{session_id}")
async def get_session(session_id: str) -> dict[str, Any]:
    host = session_mgr.get(session_id)
    if host is None:
        raise HTTPException(404, "Session not found")
    if not host.is_ready:
        raise HTTPException(503, "Session not ready yet")
    state = host.app_state
    return state.__dict__ if state else {}


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: str) -> None:
    host = session_mgr.get(session_id)
    if host is None:
        raise HTTPException(404, "Session not found")
    await host.stop()
    session_mgr.remove(session_id)


@router.get("/{session_id}/commands")
async def get_commands(session_id: str) -> dict[str, Any]:
    host = session_mgr.get(session_id)
    if host is None:
        raise HTTPException(404, "Session not found")
    if not host.is_ready:
        raise HTTPException(503, "Session not ready yet")
    return {"commands": host.commands}


@router.get("/{session_id}/permission-mode")
async def get_permission_mode(session_id: str) -> dict[str, Any]:
    host = session_mgr.get(session_id)
    if host is None:
        raise HTTPException(404, "Session not found")
    if not host.is_ready:
        raise HTTPException(503, "Session not ready yet")
    state = host.app_state
    mode = state.permission_mode if state else "default"
    return {"mode": mode, "path_rules": []}


class SetPermissionModeRequest(BaseModel):
    mode: str


@router.post("/{session_id}/permission-mode")
async def set_permission_mode(session_id: str, req: SetPermissionModeRequest) -> dict[str, Any]:
    host = session_mgr.get(session_id)
    if host is None:
        raise HTTPException(404, "Session not found")
    if not host.is_ready:
        raise HTTPException(503, "Session not ready yet")
    from openharness.ui.protocol import FrontendRequest
    await host.push_request(FrontendRequest(type="submit_line", line=f"/permissions {req.mode}"))
    return {"mode": req.mode}
