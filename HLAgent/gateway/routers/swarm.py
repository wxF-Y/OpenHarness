"""Swarm team management REST router.

Thin adapter layer: HTTP parsing → SwarmService → HTTP response.
Business logic lives in openharness.swarm.swarm_service.SwarmService.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator

router = APIRouter(prefix="/api/swarm", tags=["swarm"])
log = logging.getLogger(__name__)

_SAFE_SEGMENT_RE = re.compile(r'^[a-zA-Z0-9_\-\.]{1,128}$')
_SAFE_RUN_SLUG_RE = re.compile(r'^[\w\-\.]{1,256}$', re.UNICODE)


def _get_svc(request: Request):
    return request.app.state.swarm_service


# ---------------------------------------------------------------------------
# Team endpoints
# ---------------------------------------------------------------------------


@router.get("/teams")
async def get_teams(template_only: bool = True, svc=Depends(_get_svc)) -> list[dict[str, Any]]:
    teams = svc.list_teams(template_only=template_only)
    return [
        {
            "name": t.name,
            "description": t.description,
            "member_count": len(t.members),
            "lead_agent_id": t.lead_agent_id,
            "created_at": t.created_at,
            "state": t.state.value,
        }
        for t in teams
    ]


@router.get("/teams/{team}")
async def get_team_detail(team: str) -> dict[str, Any]:
    from openharness.swarm.persistence import read_team_file
    tf = read_team_file(team)
    if tf is None:
        raise HTTPException(404, f"Team {team!r} not found")
    return tf.to_dict()


@router.get("/teams/{team}/runs/{run_slug}")
async def get_team_run(team: str, run_slug: str) -> dict[str, Any]:
    if not _SAFE_SEGMENT_RE.match(team) or not _SAFE_RUN_SLUG_RE.match(run_slug):
        raise HTTPException(400, "Invalid team or run_slug format")
    from openharness.config.paths import get_config_dir
    from openharness.swarm.models import TeamFile
    base = get_config_dir() / "teams-tasks"
    run_path = (base / team / run_slug / "team.json").resolve()
    if not str(run_path).startswith(str(base.resolve())):
        raise HTTPException(400, "Invalid path")
    if not run_path.exists():
        raise HTTPException(404, f"Run '{team}/{run_slug}' not found")
    try:
        tf = TeamFile.load(run_path)
        return tf.to_dict()
    except Exception as exc:
        log.error("Failed to load run %s/%s: %s", team, run_slug, exc)
        raise HTTPException(500, "Failed to load run data") from exc


@router.get("/teams/{team}/runs/{run_slug}/status")
async def get_team_run_status(team: str, run_slug: str, svc=Depends(_get_svc)) -> dict[str, Any]:
    """Return the TeamRunState for a specific run."""
    if not _SAFE_SEGMENT_RE.match(team) or not _SAFE_RUN_SLUG_RE.match(run_slug):
        raise HTTPException(400, "Invalid team or run_slug format")
    state = svc.get_run_state(team, run_slug)
    if state is None:
        raise HTTPException(404, "Run not found")
    return {"state": state.value, "run_slug": run_slug}


@router.get("/teams/{team}/runs")
async def list_team_runs(team: str, svc=Depends(_get_svc)) -> list[dict[str, Any]]:
    """List historical runs for a team."""
    return svc.list_runs(team)


class CreateTeamRequest(BaseModel):
    name: str
    description: str = ""

    @field_validator("name")
    @classmethod
    def name_must_be_slug(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 64:
            raise ValueError("name must be 1–64 characters")
        if not re.match(r"^[a-zA-Z0-9_\-.]+$", v):
            raise ValueError("name may only contain letters, digits, hyphens, underscores, and dots")
        return v


@router.post("/teams", status_code=201)
async def create_team(req: CreateTeamRequest) -> dict[str, Any]:
    from openharness.swarm.team_lifecycle import TeamLifecycleManager
    mgr = TeamLifecycleManager()
    try:
        tf = mgr.create_team(req.name, req.description)
    except ValueError as exc:
        msg = str(exc)
        if "already exists" in msg:
            raise HTTPException(409, f"Team {req.name!r} already exists") from exc
        raise HTTPException(400, msg) from exc
    return tf.to_dict()


@router.delete("/teams/{team}", status_code=204)
async def delete_team(team: str) -> None:
    import shutil
    from openharness.swarm.mailbox import get_team_dir
    team_dir = get_team_dir(team)
    if not team_dir.exists():
        raise HTTPException(404, f"Team {team!r} not found")
    shutil.rmtree(team_dir)


@router.get("/teams/{team}/members/{agent_id}")
async def get_member(team: str, agent_id: str) -> dict[str, Any]:
    from openharness.swarm.persistence import read_team_file
    tf = read_team_file(team)
    if tf is None:
        raise HTTPException(404, f"Team {team!r} not found")
    member = tf.members.get(agent_id)
    if member is None:
        raise HTTPException(404, f"Member {agent_id!r} not found in team {team!r}")
    return member.to_dict()


_MEMBER_COLOR_PALETTE = ["blue", "green", "yellow", "red", "purple", "cyan"]


class AddMemberRequest(BaseModel):
    name: str
    prompt: str = ""
    model: str | None = None
    color: str | None = None

    @field_validator("name")
    @classmethod
    def name_must_be_slug(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 64:
            raise ValueError("name must be 1-64 characters")
        if not re.match(r"^[a-zA-Z0-9_\-.]+$", v):
            raise ValueError("name may only contain letters, digits, hyphens, underscores, and dots")
        return v


@router.post("/teams/{team}/members", status_code=201)
async def add_member(team: str, req: AddMemberRequest, svc=Depends(_get_svc)) -> dict[str, Any]:
    import time as _time
    from openharness.swarm.models import TeamMember
    from openharness.swarm.persistence import read_team_file
    tf = read_team_file(team)
    if tf is None:
        raise HTTPException(404, f"Team {team!r} not found")
    color = req.color or _MEMBER_COLOR_PALETTE[len(tf.members) % len(_MEMBER_COLOR_PALETTE)]
    raw_prompt = req.prompt or None
    clean_prompt = raw_prompt.encode("utf-8", errors="replace").decode("utf-8") if raw_prompt else None
    member = TeamMember(
        agent_id=f"{req.name}@{team}",
        name=req.name,
        backend_type="in_process",
        joined_at=_time.time(),
        prompt=clean_prompt,
        model=req.model,
        color=color,
    )
    updated = svc.add_member(team, member)
    return updated.to_dict()


@router.delete("/teams/{team}/members/{agent_id}", status_code=204)
async def remove_member(team: str, agent_id: str, svc=Depends(_get_svc)) -> None:
    from openharness.swarm.persistence import read_team_file
    tf = read_team_file(team)
    if tf is None:
        raise HTTPException(404, f"Team {team!r} not found")
    member = tf.members.get(agent_id)
    if member is None:
        raise HTTPException(404, f"Member {agent_id!r} not found in team {team!r}")
    if member.session_id is not None:
        raise HTTPException(409, "member is running, send shutdown first")
    svc.remove_member(team, agent_id)


@router.get("/teams/{team}/pending-permissions")
async def get_pending_permissions(team: str) -> list[dict[str, Any]]:
    from openharness.swarm.persistence import read_team_file
    from openharness.swarm.mailbox import TeammateMailbox
    tf = read_team_file(team)
    if tf is None:
        raise HTTPException(404, f"Team {team!r} not found")
    if not tf.lead_agent_id:
        return []
    mailbox = TeammateMailbox(team, tf.lead_agent_id)
    messages = await mailbox.read_all(unread_only=True)
    return [m.to_dict() for m in messages if m.type == "permission_request"]


# ---------------------------------------------------------------------------
# Agent endpoints
# ---------------------------------------------------------------------------


@router.get("/agents/{agent_id}/transcript")
async def get_agent_transcript(agent_id: str, run_id: str | None = None, svc=Depends(_get_svc)) -> dict[str, Any]:
    try:
        return await svc.get_transcript(agent_id, run_id, _SAFE_SEGMENT_RE, _SAFE_RUN_SLUG_RE)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/agents/{agent_id}/stream")
async def stream_agent_output(agent_id: str, run_id: str | None = None):
    import asyncio as _asyncio
    import json as _json
    from fastapi.responses import StreamingResponse

    session_id: str | None = None
    member_cwd: str | None = None
    if run_id:
        try:
            _rt, _rs = run_id.split("/", 1)
            if _SAFE_SEGMENT_RE.match(_rt) and _SAFE_RUN_SLUG_RE.match(_rs):
                from openharness.config.paths import get_config_dir
                from openharness.swarm.models import TeamFile
                run_path = (get_config_dir() / "teams-tasks" / _rt / _rs / "team.json").resolve()
                if run_path.exists():
                    run_tf = TeamFile.load(run_path)
                    m = run_tf.members.get(agent_id)
                    if m:
                        session_id = m.session_id
                        member_cwd = m.cwd
        except Exception:
            pass

    async def event_generator():
        from openharness.swarm.in_process import get_or_create_stream_queue, cleanup_stream_queue
        if not session_id:
            yield 'data: {"type":"error","text":"no session_id"}\n\n'
            return

        # 先回放已保存的 snapshot（重启后无法从内存 stream queue 读取，需要从磁盘恢复）
        if member_cwd:
            try:
                from openharness.services.session_backend import DEFAULT_SESSION_BACKEND
                snapshot = DEFAULT_SESSION_BACKEND.load_by_id(member_cwd, session_id)
                if snapshot:
                    for msg in snapshot.get("messages", []):
                        if msg.get("role") != "assistant":
                            continue
                        for block in msg.get("content", []) or []:
                            btype = block.get("type")
                            if btype == "text" and block.get("text"):
                                yield f'data: {_json.dumps({"type": "delta", "text": block["text"]}, ensure_ascii=False)}\n\n'
                            elif btype == "thinking" and block.get("thinking"):
                                yield f'data: {_json.dumps({"type": "thinking_delta", "text": block["thinking"]}, ensure_ascii=False)}\n\n'
                            elif btype == "tool_use":
                                yield f'data: {_json.dumps({"type": "tool_start", "name": block.get("name", ""), "input": block.get("input", {})}, ensure_ascii=False)}\n\n'
                            elif btype == "tool_result":
                                output = block.get("content", "")
                                if isinstance(output, list):
                                    output = " ".join(b.get("text", "") for b in output if isinstance(b, dict))
                                yield f'data: {_json.dumps({"type": "tool_end", "output": str(output)[:200]}, ensure_ascii=False)}\n\n'
            except Exception:
                pass

        q = await get_or_create_stream_queue(session_id)
        loop = _asyncio.get_event_loop()
        deadline = loop.time() + 300
        try:
            while loop.time() < deadline:
                try:
                    item = await _asyncio.wait_for(q.get(), timeout=30)
                except _asyncio.TimeoutError:
                    yield 'data: {"type":"ping"}\n\n'
                    continue
                if item is None:
                    yield 'data: {"type":"done"}\n\n'
                    break
                yield f"data: {_json.dumps(item, ensure_ascii=False)}\n\n"
        finally:
            await cleanup_stream_queue(session_id)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class SendMessageRequest(BaseModel):
    text: str
    sender: str = "leader"


@router.post("/agents/{agent_id}/message")
async def send_agent_message(agent_id: str, req: SendMessageRequest, run_id: str | None = None) -> dict[str, Any]:
    parts = agent_id.split("@", 1)
    if len(parts) != 2:
        raise HTTPException(400, "agent_id must be 'name@team'")
    name, team = parts
    from openharness.swarm.mailbox import TeammateMailbox, create_user_message, get_team_task_mailbox_dir
    from openharness.config.paths import get_config_dir
    msg = create_user_message(req.sender, agent_id, req.text)

    resolved_run_id = run_id
    if not resolved_run_id:
        try:
            task_root = get_config_dir() / "teams-tasks" / team
            if task_root.exists():
                run_dirs = sorted(
                    [d for d in task_root.iterdir() if d.is_dir()],
                    key=lambda d: d.stat().st_mtime, reverse=True,
                )
                if run_dirs:
                    resolved_run_id = f"{team}/{run_dirs[0].name}"
        except Exception:
            pass

    if resolved_run_id:
        try:
            _rt, _rs = resolved_run_id.split("/", 1)
            if _SAFE_SEGMENT_RE.match(_rt) and _SAFE_RUN_SLUG_RE.match(_rs):
                member_inbox = get_team_task_mailbox_dir(_rt, _rs, agent_id)
                mailbox = TeammateMailbox(team, agent_id, inbox_dir=member_inbox)
            else:
                mailbox = TeammateMailbox(team, agent_id)
        except Exception:
            mailbox = TeammateMailbox(team, agent_id)
    else:
        mailbox = TeammateMailbox(team, agent_id)

    await mailbox.write(msg)
    return {"message_id": msg.id, "status": "sent"}


class PermissionResponseRequest(BaseModel):
    request_id: str
    approved: bool
    error: str | None = None
    updated_input: dict | None = None
    permission_updates: list | None = None


@router.post("/agents/{agent_id}/permission-response")
async def agent_permission_response(agent_id: str, req: PermissionResponseRequest) -> dict[str, Any]:
    parts = agent_id.split("@", 1)
    if len(parts) != 2:
        raise HTTPException(400, "agent_id must be 'name@team'")
    name, team = parts
    from openharness.swarm.mailbox import (
        TeammateMailbox,
        create_permission_response_message,
    )
    response_data: dict[str, Any] = {"request_id": req.request_id}
    if req.approved:
        response_data["subtype"] = "success"
        if req.updated_input:
            response_data["updated_input"] = req.updated_input
        if req.permission_updates:
            response_data["permission_updates"] = req.permission_updates
    else:
        response_data["subtype"] = "error"
        response_data["error"] = req.error or "Permission denied by user"

    msg = create_permission_response_message("leader", agent_id, response_data)
    mailbox = TeammateMailbox(team, agent_id)
    await mailbox.write(msg)
    return {"status": "sent", "approved": req.approved}


@router.delete("/agents/{agent_id}", status_code=204)
async def delete_agent(agent_id: str) -> None:
    parts = agent_id.split("@", 1)
    if len(parts) != 2:
        raise HTTPException(400, "agent_id must be 'name@team'")
    name, team = parts
    from openharness.swarm.mailbox import TeammateMailbox, create_shutdown_request
    msg = create_shutdown_request("leader", agent_id)
    mailbox = TeammateMailbox(team, agent_id)
    await mailbox.write(msg)


@router.get("/agents/{agent_id}/messages")
async def get_agent_messages(agent_id: str, unread_only: bool = False) -> list[dict[str, Any]]:
    parts = agent_id.split("@", 1)
    if len(parts) != 2:
        raise HTTPException(400, "agent_id must be 'name@team'")
    name, team = parts
    from openharness.swarm.mailbox import TeammateMailbox
    mailbox = TeammateMailbox(team, agent_id)
    messages = await mailbox.read_all(unread_only=unread_only)
    return [m.to_dict() for m in messages]


@router.patch("/agents/{agent_id}/messages/{message_id}/read")
async def mark_message_read(agent_id: str, message_id: str) -> dict[str, Any]:
    parts = agent_id.split("@", 1)
    if len(parts) != 2:
        raise HTTPException(400, "agent_id must be 'name@team'")
    name, team = parts
    from openharness.swarm.mailbox import TeammateMailbox
    mailbox = TeammateMailbox(team, agent_id)
    await mailbox.mark_read(message_id)
    return {"message_id": message_id, "read": True}


# ---------------------------------------------------------------------------
# Team start endpoint
# ---------------------------------------------------------------------------


class StartTeamRequest(BaseModel):
    task: str = ""
    model: str | None = None


@router.post("/teams/{team_name}/start", status_code=200)
async def start_team(team_name: str, req: StartTeamRequest, svc=Depends(_get_svc)) -> dict[str, Any]:
    """Bootstrap a Leader orchestrator session for a swarm team."""
    try:
        return await svc.start_team(team_name, task=req.task, model=req.model)
    except ValueError as exc:
        msg = str(exc)
        if "not found" in msg:
            raise HTTPException(404, msg) from exc
        raise HTTPException(400, msg) from exc
    except RuntimeError as exc:
        raise HTTPException(500, str(exc)) from exc
