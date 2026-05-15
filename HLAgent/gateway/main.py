"""HLAgent Gateway — FastAPI application entry point."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import cron, sessions, swarm, ws

app = FastAPI(title="HLAgent Gateway", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(ws.router)
app.include_router(cron.router)
app.include_router(swarm.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}
