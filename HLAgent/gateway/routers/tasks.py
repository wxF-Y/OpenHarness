"""Background tasks REST router."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/tasks", tags=["background-tasks"])


@router.get("")
async def list_tasks() -> list[dict[str, Any]]:
    from openharness.tasks import get_task_manager
    tasks = get_task_manager().list_tasks()
    return [
        {
            "id": t.id,
            "type": t.type,
            "status": t.status,
            "description": t.description,
            "metadata": dict(t.metadata),
        }
        for t in tasks
    ]


@router.get("/{task_id}")
async def get_task(task_id: str) -> dict[str, Any]:
    from openharness.tasks import get_task_manager
    tasks = get_task_manager().list_tasks()
    for t in tasks:
        if t.id == task_id:
            output = ""
            if hasattr(t, "output_path") and t.output_path:
                try:
                    from pathlib import Path
                    output = Path(t.output_path).read_text(encoding="utf-8")[-5000:]
                except Exception:
                    pass
            return {
                "id": t.id,
                "type": t.type,
                "status": t.status,
                "description": t.description,
                "metadata": dict(t.metadata),
                "output": output,
            }
    raise HTTPException(404, f"Task {task_id!r} not found")


@router.delete("/{task_id}", status_code=204)
async def stop_task(task_id: str) -> None:
    from openharness.tasks import get_task_manager
    manager = get_task_manager()
    tasks = manager.list_tasks()
    for t in tasks:
        if t.id == task_id:
            try:
                from openharness.tasks.stop_task import stop_task as _stop
                await _stop(task_id)
            except Exception:
                pass
            return
    raise HTTPException(404, f"Task {task_id!r} not found")
