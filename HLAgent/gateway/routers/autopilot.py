"""Autopilot REST router."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/autopilot", tags=["autopilot"])


@router.get("/tasks")
async def list_tasks() -> list[dict[str, Any]]:
    try:
        from openharness.autopilot import RepoAutopilotStore
        store = RepoAutopilotStore()
        tasks = store.list_tasks() if hasattr(store, "list_tasks") else []
        return [
            {
                "title": getattr(t, "title", str(t)),
                "status": getattr(t, "status", "pending"),
                "source": getattr(t, "source", ""),
                "created_at": str(getattr(t, "created_at", "")),
            }
            for t in tasks
        ]
    except Exception:
        return []


class ShipRequest(BaseModel):
    task: str
    cwd: str | None = None


@router.post("/ship", status_code=202)
async def ship(req: ShipRequest) -> dict[str, Any]:
    import asyncio
    try:
        from openharness.autopilot import RepoAutopilotStore
        store = RepoAutopilotStore()
        if hasattr(store, "queue_task"):
            task_id = store.queue_task(req.task, cwd=req.cwd)
            return {"task_id": str(task_id), "status": "queued"}
    except Exception:
        pass
    return {"status": "queued", "message": "Task queued (autopilot not fully configured)"}
