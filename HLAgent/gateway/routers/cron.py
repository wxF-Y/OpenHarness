"""Cron job management REST router."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from zoneinfo import ZoneInfo

from openharness.services.cron import (
    build_cron_job_dict,
    delete_cron_job,
    load_cron_jobs,
    next_run_time,
    set_job_enabled,
    upsert_cron_job,
    validate_cron_expression,
    validate_timezone,
)
from openharness.services.cron_scheduler import is_scheduler_running, delete_job_history, get_running_job_names

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


class ToggleRequest(BaseModel):
    enabled: bool


@router.get("/jobs")
async def list_jobs() -> list[dict[str, Any]]:
    jobs = load_cron_jobs()
    running = get_running_job_names()
    for job in jobs:
        job["running"] = job.get("name") in running
    return jobs


@router.post("/jobs", status_code=201)
async def create_job(req: CronJobCreate) -> dict[str, Any]:
    if not validate_cron_expression(req.schedule):
        raise HTTPException(422, f"Invalid cron expression: {req.schedule!r}")
    if not validate_timezone(req.timezone):
        raise HTTPException(422, f"Invalid timezone: {req.timezone!r}")
    if not req.command and not req.message and not req.payload:
        raise HTTPException(422, "Cron job requires command or message")

    job = build_cron_job_dict(
        name=req.name,
        schedule=req.schedule,
        command=req.command,
        message=req.message,
        tz_name=req.timezone,
        cwd=req.cwd,
        enabled=req.enabled,
        payload=req.payload,
        notify=req.notify,
    )
    upsert_cron_job(job)
    return {**job, "status": "created"}


@router.delete("/jobs/{name}", status_code=204)
async def delete_job(name: str) -> None:
    if not delete_cron_job(name):
        raise HTTPException(404, f"Job {name!r} not found")
    delete_job_history(name)


@router.patch("/jobs/{name}/toggle")
async def toggle_job(name: str, req: ToggleRequest) -> dict[str, Any]:
    if not set_job_enabled(name, req.enabled):
        raise HTTPException(404, f"Job {name!r} not found")
    jobs = load_cron_jobs()
    for job in jobs:
        if job.get("name") == name:
            return job
    raise HTTPException(404, f"Job {name!r} not found")


@router.get("/jobs/{name}/history")
async def get_job_history(name: str, limit: int = Query(50, ge=1, le=1000)) -> list[dict[str, Any]]:
    from openharness.services.cron_scheduler import load_history
    return load_history(limit=limit, job_name=name)


@router.get("/scheduler/status")
async def scheduler_status() -> dict[str, Any]:
    return {
        "running": is_scheduler_running(),
        "tick_interval_seconds": 30,
        "running_jobs": sorted(get_running_job_names()),
    }


_WEEKDAY_ZH = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


@router.get("/next-run")
async def get_next_run(
    expr: str = Query(..., description="Standard 5-field cron expression"),
    tz: str | None = Query(None, description="IANA timezone, e.g. Asia/Shanghai"),
) -> dict[str, Any]:
    """Return the next scheduled run time for a cron expression (no side effects)."""
    if not validate_cron_expression(expr):
        raise HTTPException(422, f"Invalid cron expression: {expr!r}")
    if tz and not validate_timezone(tz):
        raise HTTPException(422, f"Invalid timezone: {tz!r}")

    dt_utc = next_run_time(expr, tz=tz)

    # Display in the requested timezone (or UTC)
    dt_display = dt_utc.astimezone(ZoneInfo(tz)) if tz else dt_utc.astimezone(timezone.utc)
    weekday_label = _WEEKDAY_ZH[dt_display.weekday()]   # weekday() → 0=Mon … 6=Sun
    human = dt_display.strftime(f"%Y-%m-%d {weekday_label} %H:%M")

    return {"next_run": dt_utc.isoformat(), "human": human}
