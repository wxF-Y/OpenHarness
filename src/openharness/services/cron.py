"""Local cron-style registry helpers."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any

from croniter import croniter

from openharness.config.paths import get_cron_registry_path
from openharness.utils.file_lock import exclusive_file_lock
from openharness.utils.fs import atomic_write_text


def _cron_lock_path() -> Path:
    path = get_cron_registry_path()
    return path.with_suffix(path.suffix + ".lock")


def load_cron_jobs() -> list[dict[str, Any]]:
    """Load stored cron jobs."""
    path = get_cron_registry_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def save_cron_jobs(jobs: list[dict[str, Any]]) -> None:
    """Persist cron jobs to disk."""
    atomic_write_text(
        get_cron_registry_path(),
        json.dumps(jobs, indent=2, ensure_ascii=False) + "\n",
    )


def validate_cron_expression(expression: str) -> bool:
    """Return True if the expression is a valid cron schedule."""
    return croniter.is_valid(expression)


def validate_timezone(tz: str | None) -> bool:
    """Return True if *tz* is a valid IANA timezone or empty."""
    if not tz:
        return True
    try:
        ZoneInfo(tz)
    except Exception:
        return False
    return True


def next_run_time(expression: str, base: datetime | None = None, tz: str | None = None) -> datetime:
    """Return the next run time for a cron expression as an aware UTC datetime.

    If *tz* is provided, the cron expression is interpreted in that IANA timezone.
    croniter.get_next(datetime) returns a naive datetime, so we always re-attach
    tzinfo before returning to prevent silent local-time misinterpretation.
    """
    base = base or datetime.now(timezone.utc)
    if tz:
        local_base = base.astimezone(ZoneInfo(tz))
        local_next = croniter(expression, local_base).get_next(datetime)
        # get_next returns naive; treat as the interpreted tz then convert to UTC
        aware_next = local_next.replace(tzinfo=ZoneInfo(tz))
        return aware_next.astimezone(timezone.utc)
    naive_next = croniter(expression, base).get_next(datetime)
    return naive_next.replace(tzinfo=timezone.utc)


def upsert_cron_job(job: dict[str, Any]) -> None:
    """Insert or replace one cron job.

    When updating an existing job:
    - Preserves ``created_at``, ``created_by``, ``last_run``, ``last_status``
      from the old record so history is not lost on edit.
    - Only recalculates ``next_run`` when the schedule actually changed;
      otherwise the original ``next_run`` is kept (prevents an edit from
      silently pushing the trigger to the next day).
    """
    job.setdefault("enabled", True)

    with exclusive_file_lock(_cron_lock_path()):
        existing_jobs = load_cron_jobs()
        old = next((j for j in existing_jobs if j.get("name") == job.get("name")), None)

        if old is not None:
            # Carry forward immutable / history fields from the old record
            for field in ("created_at", "created_by", "last_run", "last_status"):
                if field not in job and field in old:
                    job[field] = old[field]
            # Recalculate next_run only when the schedule or timezone changed
            schedule_changed = (
                old.get("schedule") != job.get("schedule") or
                old.get("timezone") != job.get("timezone")
            )
            if schedule_changed and validate_cron_expression(job.get("schedule", "")):
                job["next_run"] = next_run_time(
                    job["schedule"], tz=job.get("timezone") or job.get("tz")
                ).isoformat()
            elif not schedule_changed and "next_run" in old:
                # Keep existing next_run so the scheduled trigger is preserved
                job.setdefault("next_run", old["next_run"])
        else:
            job.setdefault("created_at", datetime.now(timezone.utc).isoformat())
            schedule = job.get("schedule", "")
            if validate_cron_expression(schedule):
                job["next_run"] = next_run_time(
                    schedule, tz=job.get("timezone") or job.get("tz")
                ).isoformat()

        jobs = [j for j in existing_jobs if j.get("name") != job.get("name")]
        jobs.append(job)
        jobs.sort(key=lambda item: str(item.get("name", "")))
        save_cron_jobs(jobs)


def delete_cron_job(name: str) -> bool:
    """Delete one cron job by name."""
    with exclusive_file_lock(_cron_lock_path()):
        jobs = load_cron_jobs()
        filtered = [job for job in jobs if job.get("name") != name]
        if len(filtered) == len(jobs):
            return False
        save_cron_jobs(filtered)
    return True


def get_cron_job(name: str) -> dict[str, Any] | None:
    """Return one cron job by name."""
    for job in load_cron_jobs():
        if job.get("name") == name:
            return job
    return None


def set_job_enabled(name: str, enabled: bool) -> bool:
    """Enable or disable a cron job. Returns False if job not found."""
    with exclusive_file_lock(_cron_lock_path()):
        jobs = load_cron_jobs()
        found = any(j.get("name") == name for j in jobs)
        if not found:
            return False
        new_jobs = [{**j, "enabled": enabled} if j.get("name") == name else j for j in jobs]
        # Skip write if value is already correct
        if all(j.get("enabled") == enabled for j in new_jobs if j.get("name") == name):
            existing = next(j for j in jobs if j.get("name") == name)
            if existing.get("enabled") == enabled:
                return True  # already at target state, no write needed
        save_cron_jobs(new_jobs)
    return True


def mark_job_run(name: str, *, success: bool) -> None:
    """Update last_run and recompute next_run after a job executes."""
    with exclusive_file_lock(_cron_lock_path()):
        jobs = load_cron_jobs()
        now = datetime.now(timezone.utc)
        new_jobs = []
        updated = False
        for job in jobs:
            if job.get("name") == name:
                patch: dict[str, Any] = {
                    "last_run": now.isoformat(),
                    "last_status": "success" if success else "failed",
                }
                schedule = job.get("schedule", "")
                if validate_cron_expression(schedule):
                    patch["next_run"] = next_run_time(schedule, now, tz=job.get("timezone") or job.get("tz")).isoformat()
                new_jobs.append({**job, **patch})
                updated = True
            else:
                new_jobs.append(job)
        if updated:
            save_cron_jobs(new_jobs)


def build_cron_job_dict(
    *,
    name: str,
    schedule: str,
    command: str | None = None,
    message: str | None = None,
    tz_name: str | None = None,
    cwd: str | None = None,
    enabled: bool = True,
    payload: dict[str, Any] | None = None,
    notify: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble a canonical cron job dict from individual fields.

    Both the HTTP router and the cron_create Agent tool call this function so
    that jobs created through either path have identical structure.
    """
    job: dict[str, Any] = {"name": name, "schedule": schedule, "enabled": enabled}
    if cwd:
        # Normalise and validate cwd to prevent path traversal in subprocess execution
        resolved = Path(cwd).expanduser().resolve()
        if not resolved.exists() or not resolved.is_dir():
            raise ValueError(f"cwd must be an existing directory: {cwd!r}")
        job["cwd"] = str(resolved)
    if tz_name:
        job["timezone"] = tz_name
    if command:
        job["command"] = command

    final_payload: dict[str, Any] = dict(payload or {})
    if message:
        final_payload.setdefault("kind", "agent_turn")
        final_payload.setdefault("message", message)
    if final_payload:
        # Only stamp kind when payload is agent-driven (not a bare env/metadata dict for command jobs)
        if not command or message:
            final_payload.setdefault("kind", "agent_turn")
        job["payload"] = final_payload

    if notify is not None:
        job["notify"] = notify

    return job

