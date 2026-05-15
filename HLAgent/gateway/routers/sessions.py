"""Sessions REST router."""

from __future__ import annotations

from pathlib import Path
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


@router.get("")
async def list_sessions() -> list[dict[str, Any]]:
    """List saved sessions from SessionBackend."""
    import os
    from openharness.services.session_backend import DEFAULT_SESSION_BACKEND
    try:
        cwd = os.getcwd()
        sessions_dir = DEFAULT_SESSION_BACKEND.get_session_dir(cwd)
        results: list[dict[str, Any]] = []
        if Path(sessions_dir).exists():
            for f in sorted(Path(sessions_dir).glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True)[:20]:
                try:
                    import json
                    data = json.loads(f.read_text(encoding="utf-8"))
                    results.append({
                        "session_id": f.stem,
                        "model": data.get("model", ""),
                        "cwd": data.get("cwd", cwd),
                        "created_at": f.stat().st_mtime,
                    })
                except Exception:
                    pass
        return results
    except Exception:
        return []


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


@router.get("/{session_id}/context")
async def get_context(session_id: str) -> dict[str, Any]:
    host = session_mgr.get(session_id)
    if host is None:
        raise HTTPException(404, "Session not found")
    if not host.is_ready:
        raise HTTPException(503, "Session not ready yet")
    return {"system_prompt": host.get_system_prompt() or ""}


@router.get("/{session_id}/summary")
async def get_summary(session_id: str, max_messages: int = 8) -> dict[str, Any]:
    host = session_mgr.get(session_id)
    if host is None:
        raise HTTPException(404, "Session not found")
    if not host.is_ready:
        raise HTTPException(503, "Session not ready yet")
    from openharness.services import summarize_messages
    summary = summarize_messages(host.get_messages(), max_messages=max_messages)
    return {"summary": summary or ""}


@router.get("/{session_id}/transcript")
async def get_transcript(session_id: str, format: str = "markdown") -> dict[str, Any]:
    host = session_mgr.get(session_id)
    if host is None:
        raise HTTPException(404, "Session not found")
    if not host.is_ready:
        raise HTTPException(503, "Session not ready yet")
    messages = host.get_messages()
    if format == "markdown":
        sb = host.get_session_backend()
        if sb:
            try:
                transcript = sb.export_as_markdown(messages)
                return {"transcript": transcript, "format": "markdown"}
            except Exception:
                pass
    return {"messages": [m.model_dump() if hasattr(m, "model_dump") else str(m) for m in messages]}


@router.delete("/{session_id}/messages/last")
async def rewind(session_id: str) -> dict[str, Any]:
    host = session_mgr.get(session_id)
    if host is None:
        raise HTTPException(404, "Session not found")
    if not host.is_ready:
        raise HTTPException(503, "Session not ready yet")
    removed = host.pop_last_turn()
    messages = host.get_messages()
    return {"removed": removed, "remaining_messages": len(messages)}


class TagRequest(BaseModel):
    name: str


@router.post("/{session_id}/tag", status_code=201)
async def tag_session(session_id: str, req: TagRequest) -> dict[str, Any]:
    host = session_mgr.get(session_id)
    if host is None:
        raise HTTPException(404, "Session not found")
    if not host.is_ready:
        raise HTTPException(503, "Session not ready yet")
    # Tags are implemented via the submit_line /tag command
    from openharness.ui.protocol import FrontendRequest
    await host.push_request(FrontendRequest(type="submit_line", line=f"/tag {req.name}"))
    return {"tag": req.name, "session_id": session_id}


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

