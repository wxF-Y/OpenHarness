"""HLAgent Gateway — FastAPI application entry point."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

# Isolate HLAgent storage to ~/.hlagent/ (or HLAGENT_CONFIG_DIR if set).
# We FORCE-SET the OpenHarness path variables (not setdefault) so that any
# pre-existing OPENHARNESS_CONFIG_DIR in the user's environment cannot
# accidentally redirect HLAgent to OpenHarness's shared storage.
#
# Override priority:
#   1. HLAGENT_CONFIG_DIR env var  → custom deployment path
#   2. ~/.hlagent/                  → default HLAgent-specific path
_hlagent_home = Path(os.environ.get("HLAGENT_CONFIG_DIR", Path.home() / ".hlagent"))
os.environ["OPENHARNESS_CONFIG_DIR"] = str(_hlagent_home)
os.environ["OPENHARNESS_DATA_DIR"] = str(_hlagent_home / "data")
os.environ["OPENHARNESS_LOGS_DIR"] = str(_hlagent_home / "logs")
os.environ["OPENHARNESS_PROJECT_DIR_NAME"] = ".hlagent"

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import (
    auth,
    autopilot,
    cron,
    debug,
    files,
    fs,
    git,
    memory,
    onboarding,
    role_library,
    sessions,
    settings,
    skills,
    swarm,
    tasks,
    ws,
)

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── startup ─────────────────────────────────────────────────────────
    from openharness.services import cron_scheduler
    try:
        from services.cron_runner import run_agent_turn
        cron_scheduler.set_agent_runner(run_agent_turn)
        task = asyncio.create_task(
            cron_scheduler.run_scheduler_loop(manage_pid=False),
            name="cron-scheduler",
        )
        cron_scheduler._scheduler_task = task
        log.info("Cron scheduler started as in-process asyncio task")
    except Exception as exc:
        log.error("Failed to start cron scheduler: %s", exc)

    yield

    # ── shutdown ─────────────────────────────────────────────────────────
    task = cron_scheduler._scheduler_task
    if task is not None and not task.done():
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    log.info("Cron scheduler stopped")


app = FastAPI(title="HLAgent Gateway", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(onboarding.router)
app.include_router(sessions.router)
app.include_router(files.router)
app.include_router(fs.router)
app.include_router(ws.router)
app.include_router(cron.router)
app.include_router(swarm.router)
app.include_router(role_library.router)
app.include_router(memory.router)
app.include_router(auth.router)
app.include_router(settings.router)
app.include_router(tasks.router)
app.include_router(git.router)
app.include_router(autopilot.router)
app.include_router(debug.router)
app.include_router(skills.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}
