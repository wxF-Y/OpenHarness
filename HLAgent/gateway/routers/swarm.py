"""Swarm team management REST router — stub implementation.

Complete implementation is in task 10.1. This file provides route registration
and stub functions so the Gateway starts without errors.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/swarm", tags=["swarm"])


# ---------------------------------------------------------------------------
# Team endpoints
# ---------------------------------------------------------------------------

@router.get("/teams")
async def get_teams() -> list[dict[str, Any]]:
    """List all teams with summary info."""
    from openharness.swarm.team_lifecycle import TeamLifecycleManager
    mgr = TeamLifecycleManager()
    return [
        {
            "name": t.name,
            "description": t.description,
            "member_count": len(t.members),
            "lead_agent_id": t.lead_agent_id,
            "created_at": t.created_at,
        }
        for t in mgr.list_teams()
    ]


@router.get("/teams/{team}")
async def get_team_detail(team: str) -> dict[str, Any]:
    """Get complete TeamFile for a team."""
    from openharness.swarm.team_lifecycle import read_team_file
    tf = read_team_file(team)
    if tf is None:
        raise HTTPException(404, f"Team {team!r} not found")
    return tf.to_dict()


class CreateTeamRequest(BaseModel):
    name: str
    description: str = ""


@router.post("/teams", status_code=201)
async def create_team(req: CreateTeamRequest) -> dict[str, Any]:
    from openharness.swarm.team_lifecycle import TeamLifecycleManager
    mgr = TeamLifecycleManager()
    tf = mgr.create_team(req.name, req.description)
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
    from openharness.swarm.team_lifecycle import read_team_file
    tf = read_team_file(team)
    if tf is None:
        raise HTTPException(404, f"Team {team!r} not found")
    member = tf.members.get(agent_id)
    if member is None:
        raise HTTPException(404, f"Member {agent_id!r} not found in team {team!r}")
    return member.to_dict()


@router.get("/teams/{team}/pending-permissions")
async def get_pending_permissions(team: str) -> list[dict[str, Any]]:
    """Scan leader mailbox for unread permission_request messages."""
    from openharness.swarm.team_lifecycle import read_team_file
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
async def get_agent_transcript(agent_id: str) -> dict[str, Any]:
    """Get agent transcript via TeamMember.session_id."""
    # agent_id format: name@team
    parts = agent_id.split("@", 1)
    if len(parts) != 2:
        raise HTTPException(400, "agent_id must be in 'name@team' format")
    name, team = parts
    from openharness.swarm.team_lifecycle import read_team_file
    tf = read_team_file(team)
    if tf is None:
        raise HTTPException(404, f"Team {team!r} not found")
    member = tf.members.get(agent_id)
    if member is None:
        raise HTTPException(404, f"Agent {agent_id!r} not found")
    if not member.session_id:
        raise HTTPException(404, f"Agent {agent_id!r} has no session_id")
    from openharness.services.session_backend import DEFAULT_SESSION_BACKEND
    import os
    cwd = member.cwd or os.getcwd()
    transcript = DEFAULT_SESSION_BACKEND.export_as_markdown(
        DEFAULT_SESSION_BACKEND.load_session(cwd, member.session_id) or []
    )
    return {"session_id": member.session_id, "transcript": transcript}


class SendMessageRequest(BaseModel):
    text: str
    sender: str = "leader"


@router.post("/agents/{agent_id}/message")
async def send_agent_message(agent_id: str, req: SendMessageRequest) -> dict[str, Any]:
    parts = agent_id.split("@", 1)
    if len(parts) != 2:
        raise HTTPException(400, "agent_id must be 'name@team'")
    name, team = parts
    from openharness.swarm.mailbox import TeammateMailbox, create_user_message
    msg = create_user_message(req.sender, agent_id, req.text)
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


# Spawn endpoint lives under /api/sessions/{id}/spawn and is handled in sessions.py
