"""read_file Agent tool: bounded read with cwd safety."""
from __future__ import annotations

import json


READ_FILE_SCHEMA = {
    "type": "function",
    "function": {
        "name": "read_file",
        "description": (
            "Read a file under the current project. Supports optional line "
            "range. Use after grep_code or search_codebase to inspect "
            "context around a match."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Project-relative file path.",
                },
                "start_line": {
                    "type": "integer",
                    "description": "1-indexed start line.",
                },
                "end_line": {
                    "type": "integer",
                    "description": "1-indexed end line (inclusive).",
                },
            },
            "required": ["path"],
        },
    },
}


_MAX_BYTES = 256 * 1024  # cap to 256 KB per tool call


async def read_file(
    session,
    *,
    path: str,
    start_line: int | None = None,
    end_line: int | None = None,
) -> str:
    """Read a file under session.cwd; return JSON envelope."""
    if ".." in path or path.startswith("/") or (len(path) > 1 and path[1] == ":"):
        return json.dumps({"error": "Cross-cwd path rejected", "code": "INVALID_PATH"})

    full = (session.cwd / path).resolve()
    try:
        full.relative_to(session.cwd.resolve())
    except ValueError:
        return json.dumps({"error": "Path outside cwd", "code": "INVALID_PATH"})
    if not full.exists() or not full.is_file():
        return json.dumps({"error": f"Not a file: {path}", "code": "NOT_FOUND"})

    try:
        text = full.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return json.dumps({"error": str(exc), "code": "IO_ERROR"})

    if len(text.encode("utf-8")) > _MAX_BYTES:
        text = text[: _MAX_BYTES // 2] + "\n\n[TRUNCATED]"

    lines = text.splitlines()
    sl = max(1, start_line or 1)
    el = min(len(lines), end_line or len(lines))
    selected = lines[sl - 1: el]
    return json.dumps({
        "path": path,
        "start_line": sl,
        "end_line": el,
        "total_lines": len(lines),
        "content": "\n".join(selected),
    }, ensure_ascii=False)
