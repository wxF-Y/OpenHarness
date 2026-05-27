"""Memory file management REST router."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from openharness.config.paths import get_data_dir
from openharness.memory import (
    add_memory_entry,
    get_project_memory_dir,
    remove_memory_entry,
)

router = APIRouter(prefix="/api/memory", tags=["memory"])


def _get_cwd() -> str:
    return os.getcwd()


def _read_source_cwd(mem_dir: Path) -> str | None:
    """Read the original cwd stored in .source_cwd, or None if absent."""
    f = mem_dir / ".source_cwd"
    return f.read_text(encoding="utf-8").strip() if f.exists() else None


def _resolve_mem_dir(cwd: str | None, memory_dir: str | None) -> Path:
    """Return the validated memory directory path.

    When memory_dir is supplied it must resolve to a direct child of the
    application's memory base dir — any path outside that boundary is rejected
    to prevent path-traversal reads/deletes.
    """
    if memory_dir:
        memory_base = (get_data_dir() / "memory").resolve()
        candidate = Path(memory_dir).resolve()
        if candidate.parent != memory_base:
            raise HTTPException(400, "Invalid memory_dir")
        return candidate
    return get_project_memory_dir(cwd or _get_cwd())


@router.get("/projects")
async def list_projects(active_cwd: str | None = None) -> list[dict[str, Any]]:
    """List all known project memory directories."""
    memory_base = get_data_dir() / "memory"
    if not memory_base.exists():
        return []

    active_mem_dir = str(get_project_memory_dir(active_cwd)) if active_cwd else None

    projects: list[dict[str, Any]] = []
    for d in sorted(memory_base.iterdir()):
        if not d.is_dir() or d.name.startswith("."):
            continue
        source_cwd = _read_source_cwd(d)
        # Use the last path component of source_cwd as human-readable label;
        # fall back to a truncated dir name for legacy dirs without metadata.
        if source_cwd:
            label = Path(source_cwd).name
        else:
            label = d.name[:16] + "…" if len(d.name) > 16 else d.name
        projects.append({
            "label": label,
            "dir_name": d.name,
            "memory_dir": str(d),
            "source_cwd": source_cwd,
            "is_active": str(d) == active_mem_dir,
        })
    return projects


@router.get("/files")
async def list_files(cwd: str | None = None, memory_dir: str | None = None) -> list[dict[str, Any]]:
    mem_dir = _resolve_mem_dir(cwd, memory_dir)
    result = []
    for f in sorted(mem_dir.glob("*.md")):
        try:
            stat = f.stat()
            result.append({
                "filename": f.name,
                "path": str(f),
                "size": stat.st_size,
                "modified": stat.st_mtime,
            })
        except OSError:
            pass
    return result


@router.get("/{filename}")
async def read_file(filename: str, cwd: str | None = None, memory_dir: str | None = None) -> dict[str, Any]:
    mem_dir = _resolve_mem_dir(cwd, memory_dir)
    file_path = mem_dir / filename
    if not file_path.exists():
        raise HTTPException(404, f"File {filename!r} not found")
    return {
        "filename": filename,
        "path": str(file_path),
        "content": file_path.read_text(encoding="utf-8"),
    }


class AddMemoryRequest(BaseModel):
    title: str
    content: str
    cwd: str | None = None


@router.post("", status_code=201)
async def add_memory(req: AddMemoryRequest) -> dict[str, Any]:
    effective_cwd = req.cwd or _get_cwd()
    path = add_memory_entry(effective_cwd, req.title, req.content)
    return {"filename": path.name, "path": str(path)}


@router.delete("/{filename}", status_code=204)
async def delete_memory(filename: str, cwd: str | None = None, memory_dir: str | None = None) -> None:
    mem_dir = _resolve_mem_dir(cwd, memory_dir)
    if memory_dir:
        source_cwd = _read_source_cwd(mem_dir)
        if not source_cwd:
            raise HTTPException(422, "Cannot delete: memory directory has no source metadata")
        if not remove_memory_entry(source_cwd, filename):
            raise HTTPException(404, f"File {filename!r} not found")
    else:
        effective_cwd = cwd or _get_cwd()
        if not remove_memory_entry(effective_cwd, filename):
            raise HTTPException(404, f"File {filename!r} not found")


@router.post("/dream", status_code=202)
async def dream(cwd: str | None = None, memory_dir: str | None = None) -> dict[str, Any]:
    """Trigger autodream memory consolidation in background."""
    if memory_dir:
        mem_dir = _resolve_mem_dir(None, memory_dir)
        source_cwd = _read_source_cwd(mem_dir)
        if not source_cwd:
            raise HTTPException(422, "Cannot run dream: memory directory has no source metadata")
        effective_cwd = source_cwd
    else:
        effective_cwd = cwd or _get_cwd()

    async def _run() -> None:
        try:
            from openharness.services.autodream.service import run_autodream
            await run_autodream(effective_cwd)
        except Exception:
            pass

    asyncio.create_task(_run())
    return {"status": "started", "message": "Memory consolidation started in background"}
