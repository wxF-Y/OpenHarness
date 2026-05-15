"""Git integration REST router."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/git", tags=["git"])


def _is_git_repo(cwd: str) -> bool:
    result = subprocess.run(
        ["git", "rev-parse", "--git-dir"],
        cwd=cwd, capture_output=True, timeout=5,
    )
    return result.returncode == 0


@router.get("/diff")
async def get_diff(cwd: str | None = None) -> dict[str, Any]:
    import os
    effective_cwd = cwd or os.getcwd()
    if not _is_git_repo(effective_cwd):
        raise HTTPException(422, "Not a git repository")
    result = subprocess.run(
        ["git", "diff", "--stat", "HEAD"],
        cwd=effective_cwd, capture_output=True, text=True, timeout=10,
    )
    return {"diff": result.stdout, "stat": result.stdout}


@router.get("/branch")
async def get_branch(cwd: str | None = None) -> dict[str, Any]:
    import os
    effective_cwd = cwd or os.getcwd()
    if not _is_git_repo(effective_cwd):
        raise HTTPException(422, "Not a git repository")

    branch_result = subprocess.run(
        ["git", "branch", "--show-current"],
        cwd=effective_cwd, capture_output=True, text=True, timeout=5,
    )
    branch = branch_result.stdout.strip()

    status_result = subprocess.run(
        ["git", "status", "--short", "--branch"],
        cwd=effective_cwd, capture_output=True, text=True, timeout=5,
    )
    return {"branch": branch, "status": status_result.stdout[:500]}
