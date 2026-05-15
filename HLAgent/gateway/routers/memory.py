"""Memory file management REST router."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from openharness.memory import (
    add_memory_entry,
    get_project_memory_dir,
    list_memory_files,
    remove_memory_entry,
)

router = APIRouter(prefix="/api/memory", tags=["memory"])


def _get_cwd() -> str:
    import os
    return os.getcwd()


@router.get("/files")
async def list_files(cwd: str | None = None) -> list[dict[str, Any]]:
    effective_cwd = cwd or _get_cwd()
    files = list_memory_files(effective_cwd)
    result = []
    for f in files:
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
async def read_file(filename: str, cwd: str | None = None) -> dict[str, Any]:
    effective_cwd = cwd or _get_cwd()
    mem_dir = get_project_memory_dir(effective_cwd)
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
async def delete_memory(filename: str, cwd: str | None = None) -> None:
    effective_cwd = cwd or _get_cwd()
    if not remove_memory_entry(effective_cwd, filename):
        raise HTTPException(404, f"File {filename!r} not found")


@router.post("/dream", status_code=202)
async def dream(cwd: str | None = None) -> dict[str, Any]:
    """Trigger autodream memory consolidation in background."""
    effective_cwd = cwd or _get_cwd()

    async def _run():
        try:
            from openharness.services.autodream.service import run_autodream
            await run_autodream(effective_cwd)
        except Exception:
            pass

    asyncio.create_task(_run())
    return {"status": "started", "message": "Memory consolidation started in background"}
