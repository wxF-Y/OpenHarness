"""Onboarding status and project initialization router."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from openharness.api.provider import auth_status
from openharness.auth.manager import AuthManager
from openharness.config.settings import load_settings

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


@router.get("/status")
async def onboarding_status() -> dict[str, Any]:
    settings = load_settings()
    manager = AuthManager(settings)
    statuses = manager.get_profile_statuses()
    any_configured = any(v.get("configured") for v in statuses.values())
    cwd = str(Path.cwd())

    project_initialized = (
        (Path(cwd) / "CLAUDE.md").exists()
        or (Path(cwd) / ".openharness").exists()
    )

    return {
        "auth_configured": any_configured,
        "auth_status": auth_status(settings),
        "active_profile": settings.resolve_profile()[0],
        "cwd": cwd,
        "project_initialized": project_initialized,
        "version": "0.1.0",
    }


@router.post("/init-project", status_code=201)
async def init_project(cwd: str | None = None) -> dict[str, Any]:
    """Initialize CLAUDE.md and .openharness/ directory structure."""
    base = Path(cwd) if cwd else Path.cwd()
    created: list[str] = []

    claude_md = base / "CLAUDE.md"
    if not claude_md.exists():
        claude_md.write_text(
            "# Project Instructions\n\n"
            "- Use HLAgent tools deliberately.\n"
            "- Keep changes minimal and verify with tests when possible.\n",
            encoding="utf-8",
        )
        created.append("CLAUDE.md")

    for rel_path, content in [
        (".openharness/memory/MEMORY.md", "# Project Memory\n\nAdd reusable project knowledge here.\n"),
        (".openharness/plugins/.gitkeep", ""),
        (".openharness/skills/.gitkeep", ""),
    ]:
        full = base / rel_path
        full.parent.mkdir(parents=True, exist_ok=True)
        if not full.exists():
            full.write_text(content, encoding="utf-8")
            created.append(rel_path)

    if created:
        return {"created": created, "status": "initialized"}
    return {"created": [], "message": "Project already initialized"}
