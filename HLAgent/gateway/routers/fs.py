"""File system utilities — native file dialog and directory listing."""

from __future__ import annotations

import mimetypes
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/fs", tags=["fs"])

# Force correct MIME types for common extensions regardless of OS registry.
# On Windows, mimetypes.guess_type() reads the registry which can be polluted
# by applications that register non-standard MIME types (e.g. picview.png).
_EXTENSION_MIME: dict[str, str] = {
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif":  "image/gif",
    ".webp": "image/webp",
    ".bmp":  "image/bmp",
    ".tiff": "image/tiff",
    ".tif":  "image/tiff",
    ".svg":  "image/svg+xml",
    ".pdf":  "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".doc":  "application/msword",
    ".xls":  "application/vnd.ms-excel",
    ".txt":  "text/plain",
    ".md":   "text/markdown",
    ".csv":  "text/csv",
    ".json": "application/json",
    ".xml":  "application/xml",
    ".html": "text/html",
    ".htm":  "text/html",
    ".py":   "text/x-python",
    ".js":   "text/javascript",
    ".ts":   "text/typescript",
    ".go":   "text/x-go",
    ".rs":   "text/x-rustsrc",
    ".c":    "text/x-c",
    ".cpp":  "text/x-c++src",
    ".h":    "text/x-c",
    ".mp3":  "audio/mpeg",
    ".wav":  "audio/wav",
    ".mp4":  "video/mp4",
    ".mov":  "video/quicktime",
    ".zip":  "application/zip",
}


def _mime_for_path(path: Path) -> str:
    """Return a reliable MIME type for a file path.

    Uses a hardcoded extension map first, falls back to mimetypes.guess_type().
    This avoids Windows registry pollution (e.g. picview.png instead of image/png).
    """
    ext = path.suffix.lower()
    if ext in _EXTENSION_MIME:
        return _EXTENSION_MIME[ext]
    guessed, _ = mimetypes.guess_type(str(path))
    return guessed or "application/octet-stream"


class OpenDialogResult(BaseModel):
    path: str
    filename: str
    mime_type: str
    cancelled: bool = False


class ListDirEntry(BaseModel):
    name: str
    path: str
    is_dir: bool
    size: int = 0
    mime_type: str = ""


@router.get("/open-dialog", response_model=OpenDialogResult)
async def open_file_dialog() -> OpenDialogResult:
    """Show the OS native file-open dialog and return the selected file's full path.

    Runs synchronously in a worker thread so the asyncio event loop is not blocked.
    Returns `cancelled=True` when the user closes the dialog without selecting.
    """
    import asyncio

    loop = asyncio.get_running_loop()
    result: dict[str, Any] = {}

    def _run_dialog() -> None:
        try:
            import tkinter as _tk
            from tkinter import filedialog as _fd

            root = _tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            path = _fd.askopenfilename(
                title="选择文件",
                parent=root,
            )
            root.destroy()
            result["path"] = path or ""
        except Exception as exc:
            result["error"] = str(exc)

    # Run dialog in dedicated thread (tkinter must run in main thread on some
    # platforms; on Windows a background thread works fine for askopenfilename)
    t = threading.Thread(target=_run_dialog, daemon=True)
    t.start()
    await loop.run_in_executor(None, t.join)

    if "error" in result:
        raise HTTPException(status_code=500, detail=f"Failed to open dialog: {result['error']}")

    path_str = result.get("path", "")
    if not path_str:
        return OpenDialogResult(path="", filename="", mime_type="", cancelled=True)

    p = Path(path_str)
    return OpenDialogResult(
        path=str(p.resolve()),
        filename=p.name,
        mime_type=_mime_for_path(p),
        cancelled=False,
    )
