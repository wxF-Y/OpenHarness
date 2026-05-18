"""HLAgent Gateway — FastAPI application entry point."""

from __future__ import annotations

import os
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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import (
    auth,
    autopilot,
    cron,
    debug,
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

app = FastAPI(title="HLAgent Gateway", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(onboarding.router)
app.include_router(sessions.router)
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

