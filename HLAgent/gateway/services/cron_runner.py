"""Headless cron agent runner.

Executes ``agent_turn`` cron jobs in-process via WebBackendHost, replacing
the previous ``ohmo`` subprocess approach.  Called by cron_scheduler when
an agent_runner has been injected via ``set_agent_runner()``.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any

from pathlib import Path

from hlagent_sdk import AgentSessionConfig, create_host
from openharness.ui.protocol import FrontendRequest
from openharness.config.settings import load_settings
from routers.sessions import HLAGENT_SYSTEM_PROMPT

log = logging.getLogger(__name__)

# Hard deadlines for a single cron agent turn
TURN_TIMEOUT = 300   # seconds — max time for the agent to complete a turn
READY_TIMEOUT = 120  # seconds — max time for host initialisation
STOP_TIMEOUT = 10    # seconds — max time to wait for host task to exit after stop()


async def run_agent_turn(job: dict[str, Any]) -> tuple[bool, str]:
    """Execute one ``agent_turn`` cron job using WebBackendHost in-process.

    Returns ``(success, output_text)``.
    Host is created fresh per job and torn down afterwards — cron sessions
    are headless and intentionally not registered in session_mgr.
    """
    payload = job.get("payload") or {}
    message = str(payload.get("message") or "").strip()

    # Validate cwd: must be an existing directory; reject attempts to escape outside it.
    raw_cwd = job.get("cwd") or "."
    cwd_path = Path(raw_cwd).expanduser().resolve()
    if not cwd_path.exists() or not cwd_path.is_dir():
        return False, f"Invalid cwd for cron job: {raw_cwd!r} does not exist or is not a directory"
    cwd = str(cwd_path)

    # Resolve active profile: prefer job-level override, fall back to gateway default
    profile = payload.get("profile") or job.get("provider_profile")
    if profile is None:
        try:
            settings = load_settings()
            profile = settings.resolve_profile()[0]
        except Exception:
            pass  # use None; ReactBackendHost will use its own default

    # Allow per-job permission mode; default full_auto so cron runs unattended
    permission_mode = str(payload.get("permission_mode") or "full_auto")

    config = AgentSessionConfig(
        cwd=cwd,
        permission_mode=permission_mode,
        system_prompt=HLAGENT_SYSTEM_PROMPT,
        active_profile=profile,
    )
    host = create_host(config)

    try:
        await host.start()

        # ── Phase 1: wait for host to finish initialising ──────────────
        t0 = asyncio.get_running_loop().time()
        await _wait_for_ready(host, timeout=READY_TIMEOUT)
        log.info("Cron host ready for job %r in %.1fs", job.get("name"), asyncio.get_running_loop().time() - t0)

        # ── Phase 2: submit the cron message ───────────────────────────
        await host.push_request(FrontendRequest(type="submit_line", line=message))

        # ── Phase 3: drain events until turn completes (line_complete) ─
        output = await _collect_turn(host, timeout=TURN_TIMEOUT)
        log.info("Cron job %r turn completed, output_len=%d", job.get("name"), len(output))
        return True, output

    except asyncio.TimeoutError:
        msg = f"Agent turn timed out after {TURN_TIMEOUT}s (ready_timeout={READY_TIMEOUT}s)"
        log.warning("Cron job %r: %s", job.get("name"), msg)
        return False, msg
    except Exception as exc:
        log.error("Cron job %r agent_turn error: %s", job.get("name"), exc)
        return False, str(exc)
    finally:
        # Graceful stop then force-cancel the internal task to prevent zombie accumulation.
        with contextlib.suppress(Exception):
            await host.stop()
        run_task = getattr(host, "_run_task", None)
        if run_task is not None and not run_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(run_task), timeout=STOP_TIMEOUT)
            except (asyncio.TimeoutError, Exception):
                run_task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await run_task


async def _wait_for_ready(host, *, timeout: float) -> None:
    """Drain events until the first ``ready`` event (host initialised)."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise asyncio.TimeoutError(f"Timed out waiting for host ready after {timeout}s")
        try:
            event = await asyncio.wait_for(host.next_event(), timeout=remaining)
        except asyncio.TimeoutError:
            raise asyncio.TimeoutError(f"Timed out waiting for host ready after {timeout}s")
        if event is None:
            raise RuntimeError("Host shut down before becoming ready")
        log.debug("Cron pre-ready event: %s", event.type)
        if event.type == "ready":
            return
        if event.type == "error":
            raise RuntimeError(f"Host error during init: {event.message}")


async def _collect_turn(host, *, timeout: float) -> str:
    """Consume events after ``submit_line`` until turn completes.

    ``line_complete`` is emitted by ReactBackendHost at the end of each user turn.
    Raises ``RuntimeError`` if the host shuts down before ``line_complete`` is received
    so the caller records a failure rather than a silent empty-output success.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    deltas: list[str] = []
    completed = False

    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise asyncio.TimeoutError()

        try:
            event = await asyncio.wait_for(host.next_event(), timeout=remaining)
        except asyncio.TimeoutError:
            raise asyncio.TimeoutError()

        log.debug("Cron turn event: %s", event.type if event else "None(sentinel)")

        if event is None or event.type == "shutdown":
            break  # host exited — check completed flag below

        if event.type == "line_complete":
            completed = True
            break  # turn done normally

        if event.type == "error":
            raise RuntimeError(event.message or "Agent error")

        if event.type == "assistant_delta" and event.message:
            deltas.append(event.message)

        if event.type == "modal_request" and event.modal:
            request_id = event.modal.get("request_id")
            if request_id:
                await host.push_request(FrontendRequest(
                    type="permission_response",
                    request_id=request_id,
                    allowed=True,
                ))

        if event.type == "select_request" and event.modal:
            request_id = event.modal.get("request_id")
            if request_id:
                await host.push_request(FrontendRequest(
                    type="question_response",
                    request_id=request_id,
                    answer="",
                ))

    if not completed:
        raise RuntimeError("Agent turn ended without line_complete (host shut down prematurely)")

    return "".join(deltas)
