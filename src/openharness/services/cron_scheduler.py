"""Background cron scheduler daemon.

Runs as a standalone process (``oh cron start``) or can be embedded via
:func:`run_scheduler_loop`.  Every tick it reads the cron registry, checks
which enabled jobs are due, executes them, and records results in a history
log.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shlex
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from openharness.config.paths import get_data_dir, get_logs_dir
from openharness.services.cron import (
    load_cron_jobs,
    mark_job_run,
    upsert_cron_job,
    validate_cron_expression,
)
from openharness.sandbox import SandboxUnavailableError
from openharness.utils.shell import create_shell_subprocess

try:
    from ohmo.gateway.config import load_gateway_config  # type: ignore[import]
except Exception:
    load_gateway_config = None  # type: ignore[assignment]


NOTIFICATION_OUTPUT_LIMIT = 3500

logger = logging.getLogger(__name__)

TICK_INTERVAL_SECONDS = 30
"""How often the scheduler checks for due jobs."""

# ---------------------------------------------------------------------------
# In-process agent runner (injected by HLAgent gateway on startup)
# ---------------------------------------------------------------------------

# Callable[[dict], Awaitable[tuple[bool, str]]]  (job → (success, output))
_agent_runner = None
# asyncio.Task tracking the in-process scheduler loop (set by gateway startup)
_scheduler_task: asyncio.Task | None = None
# Names of cron jobs currently executing (updated by the scheduler loop)
_running_job_names: set[str] = set()


def get_running_job_names() -> set[str]:
    """Return the set of job names currently being executed."""
    return set(_running_job_names)


def set_agent_runner(runner) -> None:
    """Inject a gateway-provided agent runner for ``agent_turn`` cron jobs.

    When set, ``execute_job`` calls this instead of spawning an ``ohmo``
    subprocess.  Must be called before the scheduler loop starts.
    """
    global _agent_runner
    _agent_runner = runner


# ---------------------------------------------------------------------------
# History helpers
# ---------------------------------------------------------------------------

def get_history_path() -> Path:
    """Return the path to the cron execution history file."""
    return get_data_dir() / "cron_history.jsonl"


def append_history(entry: dict[str, Any]) -> None:
    """Append one execution record to the history log."""
    path = get_history_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def delete_job_history(job_name: str) -> int:
    """Remove all history entries for *job_name*.  Returns the number of entries removed."""
    path = get_history_path()
    if not path.exists():
        return 0
    lines = path.read_text(encoding="utf-8").splitlines()
    kept, removed = [], 0
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            kept.append(line)
            continue
        if entry.get("name") == job_name:
            removed += 1
        else:
            kept.append(line)
    if removed:
        path.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")
    return removed


def load_history(*, limit: int = 50, job_name: str | None = None) -> list[dict[str, Any]]:
    """Load the most recent execution history entries."""
    path = get_history_path()
    if not path.exists():
        return []
    entries: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if job_name and entry.get("name") != job_name:
            continue
        entries.append(entry)
    return entries[-limit:]


# ---------------------------------------------------------------------------
# PID file helpers
# ---------------------------------------------------------------------------

def get_pid_path() -> Path:
    """Return the scheduler PID file path."""
    return get_data_dir() / "cron_scheduler.pid"


def _pid_alive(pid: int) -> bool:
    """Return True if a process with *pid* is currently running."""
    # psutil is the most reliable cross-platform check
    try:
        import psutil
        return psutil.pid_exists(pid)
    except ImportError:
        pass

    try:
        os.kill(pid, 0)
        return True
    except OSError as exc:
        import errno as _errno
        if exc.errno == _errno.EPERM:
            return True  # process exists but we lack permission to signal
        return False


def read_pid() -> int | None:
    """Read the PID of a running scheduler, or None."""
    path = get_pid_path()
    if not path.exists():
        return None
    try:
        pid = int(path.read_text(encoding="utf-8").strip())
    except (ValueError, OSError):
        return None
    if not _pid_alive(pid):
        logger.debug("Removed stale scheduler PID file (pid=%d)", pid)
        path.unlink(missing_ok=True)
        return None
    return pid


def write_pid() -> None:
    """Write the current process PID."""
    path = get_pid_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(os.getpid()) + "\n", encoding="utf-8")


def remove_pid() -> None:
    """Remove the PID file."""
    get_pid_path().unlink(missing_ok=True)


def is_scheduler_running() -> bool:
    """Return True if the scheduler is alive (in-process task OR external PID)."""
    if _scheduler_task is not None and not _scheduler_task.done():
        return True
    return read_pid() is not None


def stop_scheduler() -> bool:
    """Send SIGTERM to the running scheduler. Returns True if killed."""
    pid = read_pid()
    if pid is None:
        return False
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        remove_pid()
        return False
    # Wait briefly for process to exit
    for _ in range(10):
        try:
            os.kill(pid, 0)
        except OSError:
            remove_pid()
            return True
        time.sleep(0.2)
    # Force kill
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass
    remove_pid()
    return True


# ---------------------------------------------------------------------------
# Job execution
# ---------------------------------------------------------------------------


def _format_notification(job: dict[str, Any], entry: dict[str, Any]) -> str:
    """Build a concise notification body for a completed cron job."""
    status = entry.get("status", "?")
    rc = entry.get("returncode", "?")
    lines = [
        f"⏰ Cron job finished: {job.get('name', '?')}",
        f"Status: {status} (rc={rc})",
        f"Started: {entry.get('started_at', '?')}",
        f"Ended: {entry.get('ended_at', '?')}",
    ]
    stdout = str(entry.get("stdout") or "").strip()
    stderr = str(entry.get("stderr") or "").strip()
    if stdout:
        lines.extend(["", "Output:", stdout[-NOTIFICATION_OUTPUT_LIMIT:]])
    if stderr:
        lines.extend(["", "Stderr:", stderr[-NOTIFICATION_OUTPUT_LIMIT:]])
    if not stdout and not stderr:
        lines.extend(["", "(no output)"])
    return "\n".join(lines)


async def _notify_job_result(job: dict[str, Any], entry: dict[str, Any]) -> None:
    """Deliver an optional post-run notification for a cron job."""
    notify = job.get("notify")
    payload = job.get("payload")
    if not isinstance(notify, dict) and isinstance(payload, dict) and payload.get("deliver"):
        notify = {"type": payload.get("channel"), "to": payload.get("to")}
    if not isinstance(notify, dict):
        return
    notify_type = str(notify.get("type") or "").strip().lower()
    try:
        if notify_type in {"feishu_dm", "feishu"}:
            raise ValueError("Feishu DM notification requires HLAgent gateway integration")
        elif notify_type:
            raise ValueError(f"unsupported notify.type: {notify_type}")
    except Exception as exc:
        logger.error("Failed to notify cron job %r result: %s", job.get("name"), exc)
        entry["notification_status"] = "failed"
        entry["notification_error"] = str(exc)
    else:
        entry["notification_status"] = "sent"


def _command_for_job(job: dict[str, Any]) -> str:
    """Return the shell command used to execute a job."""
    command = job.get("command")
    if command:
        return str(command)
    payload = job.get("payload")
    if not isinstance(payload, dict) or payload.get("kind", "agent_turn") != "agent_turn":
        raise ValueError("cron job has no command or agent_turn payload")
    message = str(payload.get("message") or "").strip()
    if not message:
        raise ValueError("agent_turn cron job is missing payload.message")
    cwd = str(job.get("cwd") or ".")
    agent_cli = os.environ.get("OPENHARNESS_AGENT_CLI", "openharness")
    parts = [agent_cli]
    profile = payload.get("profile") or job.get("provider_profile")
    if profile is None and load_gateway_config is not None:
        profile = load_gateway_config().provider_profile
    if profile:
        parts.extend(["--profile", str(profile)])
    parts.extend(
        [
            "--cwd",
            cwd,
            "--print",
            message,
        ]
    )
    return " ".join(shlex.quote(part) for part in parts)


def _make_error_entry(
    name: str,
    command: str,
    started_at: "datetime",
    status: str,
    stderr: str,
) -> "dict[str, Any]":
    """Build a history entry for a failed/errored job."""
    return {
        "name": name,
        "command": command,
        "started_at": started_at.isoformat(),
        "ended_at": datetime.now(timezone.utc).isoformat(),
        "returncode": -1,
        "status": status,
        "stdout": "",
        "stderr": stderr,
    }


async def execute_job(job: dict[str, Any]) -> dict[str, Any]:
    """Run a single cron job and return a history entry."""
    name = job["name"]
    started_at = datetime.now(timezone.utc)

    payload = job.get("payload") or {}
    is_agent_turn = isinstance(payload, dict) and payload.get("kind", "agent_turn") == "agent_turn"

    # ── In-process path: agent_turn via injected WebBackendHost runner ──────
    if is_agent_turn and _agent_runner is not None:
        msg_preview = str(payload.get("message") or "")[:120]
        logger.info("Executing cron job %r: [agent_turn] %s", name, msg_preview)

        # Snapshot cron registry before execution to detect side-effects
        jobs_before: set[str] = {j["name"] for j in load_cron_jobs()}

        try:
            success, output = await _agent_runner(job)
        except Exception as exc:
            success, output = False, str(exc)

        # Detect cron changes made by the agent during this turn
        jobs_after = load_cron_jobs()
        jobs_after_names: set[str] = {j["name"] for j in jobs_after}
        created_names = sorted(jobs_after_names - jobs_before)
        deleted_names = sorted(jobs_before - jobs_after_names)

        cron_side_effects: list[dict[str, Any]] = []
        if created_names or deleted_names:
            for n in created_names:
                cron_side_effects.append({"action": "created", "job": n})
                logger.warning("Cron job %r created a new cron job %r during execution", name, n)
            for n in deleted_names:
                cron_side_effects.append({"action": "deleted", "job": n})
                logger.warning("Cron job %r deleted cron job %r during execution", name, n)

        entry: dict[str, Any] = {
            "name": name,
            "command": f"[agent_turn] {msg_preview}",
            "started_at": started_at.isoformat(),
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "returncode": 0 if success else 1,
            "status": "success" if success else "failed",
            "stdout": output,
            "stderr": "",
        }
        if cron_side_effects:
            entry["cron_side_effects"] = cron_side_effects

        # Tag newly created jobs with created_by — use targeted upsert instead of
        # wholesale save_cron_jobs to avoid overwriting interleaved writes
        if created_names:
            from openharness.services.cron import get_cron_job
            for created_name in created_names:
                j = get_cron_job(created_name)
                if j and "created_by" not in j:
                    upsert_cron_job({**j, "created_by": f"cron:{name}"})

        mark_job_run(name, success=success)
        await _notify_job_result(job, entry)
        append_history(entry)
        logger.info("Job %r finished: %s", name, entry["status"])
        return entry

    # ── Subprocess path: shell command (or ohmo fallback) ───────────────────
    cwd = Path(job.get("cwd") or ".").expanduser()
    try:
        command = _command_for_job(job)
    except Exception as exc:
        entry = _make_error_entry(name, "", started_at, "error", str(exc))
        mark_job_run(name, success=False)
        await _notify_job_result(job, entry)
        append_history(entry)
        return entry

    logger.info("Executing cron job %r: %s", name, command)
    try:
        process = await create_shell_subprocess(
            command,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=300,
        )
    except asyncio.TimeoutError:
        try:
            process.kill()
            await process.wait()
        except Exception:
            pass
        entry = _make_error_entry(name, command, started_at, "timeout", "Job timed out after 300s")
        mark_job_run(name, success=False)
        await _notify_job_result(job, entry)
        append_history(entry)
        return entry
    except SandboxUnavailableError as exc:
        entry = _make_error_entry(name, command, started_at, "error", str(exc))
        mark_job_run(name, success=False)
        await _notify_job_result(job, entry)
        append_history(entry)
        return entry
    except Exception as exc:
        entry = _make_error_entry(name, command, started_at, "error", str(exc))
        mark_job_run(name, success=False)
        await _notify_job_result(job, entry)
        append_history(entry)
        return entry

    success = process.returncode == 0
    entry = {
        "name": name,
        "command": command,
        "started_at": started_at.isoformat(),
        "ended_at": datetime.now(timezone.utc).isoformat(),
        "returncode": process.returncode,
        "status": "success" if success else "failed",
        "stdout": (stdout.decode("utf-8", errors="replace")[-2000:] if stdout else ""),
        "stderr": (stderr.decode("utf-8", errors="replace")[-2000:] if stderr else ""),
    }
    mark_job_run(name, success=success)
    await _notify_job_result(job, entry)
    append_history(entry)
    logger.info("Job %r finished: %s (rc=%s)", name, entry["status"], process.returncode)
    return entry


# ---------------------------------------------------------------------------
# Scheduler loop
# ---------------------------------------------------------------------------

def _jobs_due(jobs: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    """Return jobs whose next_run is at or before *now*."""
    due: list[dict[str, Any]] = []
    for job in jobs:
        if not job.get("enabled", True):
            continue
        schedule = job.get("schedule", "")
        if not validate_cron_expression(schedule):
            continue
        next_run_str = job.get("next_run")
        if not next_run_str:
            continue
        try:
            next_run = datetime.fromisoformat(next_run_str)
            if next_run.tzinfo is None:
                next_run = next_run.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
        if next_run <= now:
            due.append(job)
    return due


async def run_scheduler_loop(*, once: bool = False, manage_pid: bool = True) -> None:
    """Main scheduler loop.  Runs until SIGTERM or *once* is True (test mode).

    When embedded in the gateway process pass ``manage_pid=False`` so the
    gateway's own PID is not written as the scheduler PID.

    Jobs are executed as fire-and-forget asyncio Tasks so long-running jobs
    never block the 30-second tick.  A running-task registry prevents the same
    job from being launched twice concurrently.
    """
    shutdown = asyncio.Event()

    def _on_signal() -> None:
        logger.info("Received shutdown signal")
        shutdown.set()

    loop = asyncio.get_running_loop()
    try:
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, _on_signal)
    except NotImplementedError:
        # Windows ProactorEventLoop does not support add_signal_handler
        signal.signal(signal.SIGINT, lambda *_: _on_signal())

    if manage_pid:
        write_pid()
    logger.info("Cron scheduler started (pid=%d, tick=%ds)", os.getpid(), TICK_INTERVAL_SECONDS)

    # job_name → running Task; prevents double-firing the same job
    running_tasks: dict[str, asyncio.Task] = {}
    # Clear module-level set in case a previous loop left stale entries (e.g. after restart)
    _running_job_names.clear()

    def _on_task_done(name: str, task: asyncio.Task) -> None:
        """Callback: remove finished task from registry and log unexpected errors."""
        running_tasks.pop(name, None)
        _running_job_names.discard(name)
        exc = task.exception() if not task.cancelled() else None
        if exc is not None:
            logger.error("Unexpected error in cron job %r: %s", name, exc)

    try:
        while not shutdown.is_set():
            now = datetime.now(timezone.utc)
            jobs = load_cron_jobs()
            # Skip jobs that are already running (fire-and-forget, no double-launch)
            due = [j for j in _jobs_due(jobs, now) if j["name"] not in running_tasks]

            for job in due:
                name = job["name"]
                task = asyncio.create_task(execute_job(job), name=f"cron-{name}")
                running_tasks[name] = task
                _running_job_names.add(name)
                task.add_done_callback(lambda t, n=name: _on_task_done(n, t))
                logger.info("Launched cron job %r as background task", name)

            if once:
                # In test/once mode: wait for all launched tasks to finish
                if running_tasks:
                    await asyncio.gather(*running_tasks.values(), return_exceptions=True)
                break

            try:
                await asyncio.wait_for(shutdown.wait(), timeout=TICK_INTERVAL_SECONDS)
            except asyncio.TimeoutError:
                pass

    finally:
        # Cancel any still-running tasks on shutdown
        if running_tasks:
            logger.info("Cancelling %d running cron task(s) on shutdown", len(running_tasks))
            for task in list(running_tasks.values()):
                task.cancel()
            await asyncio.gather(*running_tasks.values(), return_exceptions=True)
        if manage_pid:
            remove_pid()
        logger.info("Cron scheduler stopped")


# ---------------------------------------------------------------------------
# Daemon entry point (spawned by ``oh cron start``)
# ---------------------------------------------------------------------------

def _run_daemon() -> None:
    """Entry point for the scheduler subprocess."""
    log_file = get_logs_dir() / "cron_scheduler.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=str(log_file),
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    asyncio.run(run_scheduler_loop())


def start_daemon() -> int:
    """Start the scheduler daemon as a background process.  Returns the child PID."""
    existing = read_pid()
    if existing is not None:
        raise RuntimeError(f"Scheduler already running (pid={existing})")

    if hasattr(os, "fork"):
        # Unix: classic double-fork daemonise
        pid = os.fork()
        if pid > 0:
            time.sleep(0.3)
            return pid
        os.setsid()
        devnull = os.open(os.devnull, os.O_RDWR)
        os.dup2(devnull, 0); os.dup2(devnull, 1); os.dup2(devnull, 2)
        os.close(devnull)
        _run_daemon()
        sys.exit(0)
    else:
        # Windows: use subprocess.Popen with DETACHED_PROCESS
        import subprocess
        src_root = str(Path(__file__).parent.parent.parent)  # …/src
        env = os.environ.copy()
        # Ensure the subprocess can locate the openharness package
        existing_pp = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = src_root + (os.pathsep + existing_pp if existing_pp else "")
        DETACHED_PROCESS = 0x00000008
        CREATE_NEW_PROCESS_GROUP = 0x00000200
        proc = subprocess.Popen(
            [sys.executable, "-c",
             "from openharness.services.cron_scheduler import _run_daemon; _run_daemon()"],
            env=env,
            creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
        )
        time.sleep(0.8)
        return proc.pid


def scheduler_status() -> dict[str, Any]:
    """Return a status dict about the scheduler."""
    pid = read_pid()
    log_path = get_logs_dir() / "cron_scheduler.log"
    jobs = load_cron_jobs()
    enabled = [j for j in jobs if j.get("enabled", True)]
    return {
        "running": pid is not None,
        "pid": pid,
        "total_jobs": len(jobs),
        "enabled_jobs": len(enabled),
        "log_file": str(log_path),
        "history_file": str(get_history_path()),
    }
