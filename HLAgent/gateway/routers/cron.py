"""Cron job management REST router."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from openharness.services.cron import (
    load_cron_jobs,
    upsert_cron_job,
    validate_cron_expression,
    validate_timezone,
)
from openharness.services.cron_scheduler import is_scheduler_running, get_history_path

router = APIRouter(prefix="/api/cron", tags=["cron"])


class CronJobCreate(BaseModel):
    name: str
    schedule: str
    command: str | None = None
    message: str | None = None
    timezone: str | None = None
    cwd: str | None = None
    enabled: bool = True
    payload: dict[str, Any] | None = None
    notify: dict[str, Any] | None = None


@router.get("/jobs")
async def list_jobs() -> list[dict[str, Any]]:
    return load_cron_jobs()


@router.post("/jobs", status_code=201)
async def create_job(req: CronJobCreate) -> dict[str, Any]:
    if not validate_cron_expression(req.schedule):
        raise HTTPException(422, f"Invalid cron expression: {req.schedule!r}")
    if not validate_timezone(req.timezone):
        raise HTTPException(422, f"Invalid timezone: {req.timezone!r}")
    if not req.command and not req.message:
        raise HTTPException(422, "Cron job requires command or message")

    job: dict[str, Any] = {
        "name": req.name,
        "schedule": req.schedule,
        "enabled": req.enabled,
    }
    if req.command:
        job["command"] = req.command
    if req.message:
        job.setdefault("payload", {})
        job["payload"]["kind"] = "agent_turn"
        job["payload"]["message"] = req.message
    if req.timezone:
        job["timezone"] = req.timezone
    if req.cwd:
        job["cwd"] = req.cwd
    if req.payload:
        job["payload"] = req.payload
    if req.notify:
        job["notify"] = req.notify

    upsert_cron_job(job)
    return {**job, "status": "created"}


@router.delete("/jobs/{name}", status_code=204)
async def delete_job(name: str) -> None:
    jobs = load_cron_jobs()
    new_jobs = [j for j in jobs if j.get("name") != name]
    if len(new_jobs) == len(jobs):
        raise HTTPException(404, f"Job {name!r} not found")
    from openharness.utils.fs import atomic_write_text
    from openharness.config.paths import get_cron_registry_path
    atomic_write_text(get_cron_registry_path(), json.dumps(new_jobs, indent=2) + "\n")


@router.patch("/jobs/{name}/toggle")
async def toggle_job(name: str, enabled: dict[str, bool]) -> dict[str, Any]:
    jobs = load_cron_jobs()
    for job in jobs:
        if job.get("name") == name:
            job["enabled"] = enabled.get("enabled", job.get("enabled", True))
            upsert_cron_job(job)
            return job
    raise HTTPException(404, f"Job {name!r} not found")


@router.get("/jobs/{name}/history")
async def get_job_history(name: str, limit: int = 50) -> list[dict[str, Any]]:
    from openharness.services.cron_scheduler import load_history
    return load_history(limit=limit, job_name=name)


@router.get("/scheduler/status")
async def scheduler_status() -> dict[str, Any]:
    return {
        "running": is_scheduler_running(),
        "tick_interval_seconds": 30,
    }
