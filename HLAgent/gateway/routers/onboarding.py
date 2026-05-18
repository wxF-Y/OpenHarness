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

    # Gateway's own cwd — only used for display, NOT for project_initialized check.
    # project_initialized is intentionally omitted: the user's project directory
    # is chosen by the user in Onboarding Step 4, not the Gateway's working dir.
    return {
        "auth_configured": any_configured,
        "auth_status": auth_status(settings),
        "active_profile": settings.resolve_profile()[0],
        "cwd": str(Path.cwd()),
        "version": "0.1.0",
    }


@router.get("/check-project")
async def check_project(cwd: str) -> dict[str, Any]:
    """Check if a directory is already initialized for HLAgent/OpenHarness."""
    base = Path(cwd)
    if not base.exists() or not base.is_dir():
        return {"exists": False, "error": f"目录不存在: {cwd}"}
    has_claude_md = (base / "CLAUDE.md").exists()
    has_hlagent = (base / ".hlagent").exists()
    has_openharness = (base / ".openharness").exists()
    return {
        "exists": True,
        "initialized": has_claude_md or has_hlagent or has_openharness,
        "has_claude_md": has_claude_md,
        "has_hlagent": has_hlagent,
        "cwd": str(base),
    }


@router.post("/init-project", status_code=201)
async def init_project(cwd: str | None = None) -> dict[str, Any]:
    """Initialize CLAUDE.md and .hlagent/ in the user's project directory.

    Args:
        cwd: Target project directory. Defaults to Gateway's own cwd if not provided.
             Users should pass their actual project directory, not the Gateway dir.
    """
    base = Path(cwd) if cwd else Path.cwd()
    if not base.exists():
        from fastapi import HTTPException
        raise HTTPException(400, f"目录不存在: {base}")

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
        (".hlagent/memory/MEMORY.md", "# Project Memory\n\nAdd reusable project knowledge here.\n"),
        (".hlagent/skills/.gitkeep", ""),
    ]:
        full = base / rel_path
        full.parent.mkdir(parents=True, exist_ok=True)
        if not full.exists():
            full.write_text(content, encoding="utf-8")
            created.append(rel_path)

    if created:
        return {"created": created, "status": "initialized", "cwd": str(base)}
    return {"created": [], "message": "Project already initialized", "cwd": str(base)}
