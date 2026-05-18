"""HLAgent Gateway — FastAPI application entry point."""

from __future__ import annotations

import os
from pathlib import Path

# Isolate HLAgent storage from the shared OpenHarness ~/.openharness/ directory.
# Must be set BEFORE any openharness modules are imported so path resolution
# picks up the override immediately.
_hlagent_home = Path.home() / ".hlagent"
os.environ.setdefault("OPENHARNESS_CONFIG_DIR", str(_hlagent_home))
os.environ.setdefault("OPENHARNESS_DATA_DIR", str(_hlagent_home / "data"))
os.environ.setdefault("OPENHARNESS_LOGS_DIR", str(_hlagent_home / "logs"))

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

