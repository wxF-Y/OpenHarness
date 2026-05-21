"""File serving router — serves local files within session CWD or ~/.hlagent/ for lazy media loading."""

from __future__ import annotations

import mimetypes
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from services.session_manager import session_mgr

router = APIRouter(prefix="/api/sessions", tags=["files"])

_HLAGENT_HOME = Path(os.environ.get("HLAGENT_CONFIG_DIR", Path.home() / ".hlagent")).resolve()


@router.get("/{session_id}/files")
async def serve_session_file(session_id: str, path: str) -> FileResponse:
    """Serve a local file within the session's CWD or the ~/.hlagent/ directory.

    Allowed roots:
      1. session CWD — user project files
      2. ~/.hlagent/ — model-generated outputs (image_generation etc.)

    Path traversal outside these roots returns HTTP 403.
    """
    host = session_mgr.get(session_id)
    if host is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if not host.is_ready or host.app_state is None:
        raise HTTPException(status_code=503, detail="Session not ready")

    requested = Path(path).resolve()

    session_cwd = Path(host.app_state.cwd).resolve()
    in_cwd = _is_within(requested, session_cwd)
    in_hlagent = _is_within(requested, _HLAGENT_HOME)

    if not in_cwd and not in_hlagent:
        raise HTTPException(status_code=403, detail="路径超出允许范围（session 工作目录或 ~/.hlagent/）")

    if not requested.exists():
        raise HTTPException(status_code=404, detail="文件不存在")

    if not requested.is_file():
        raise HTTPException(status_code=400, detail="路径不是文件")

    media_type, _ = mimetypes.guess_type(str(requested))
    return FileResponse(
        path=str(requested),
        media_type=media_type or "application/octet-stream",
        filename=requested.name,
    )


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False
