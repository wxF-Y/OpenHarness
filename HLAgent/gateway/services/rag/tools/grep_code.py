"""grep_code Agent tool: ripgrep-style regex search within cwd.

Safety:
  - Resolves glob to cwd-relative paths; rejects ../ or absolute paths
  - Applies the same is_indexable filter as the indexer
  - Caps results at 500
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from ..chunkers import is_indexable


GREP_CODE_SCHEMA = {
    "type": "function",
    "function": {
        "name": "grep_code",
        "description": (
            "Regex search across project files. Returns matching lines with "
            "file path and line number. Use for exact identifiers, strings, "
            "or known patterns. Prefer search_codebase for semantic queries."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Regex pattern (Python re syntax).",
                },
                "glob": {
                    "type": "string",
                    "description": "Optional file glob, e.g. '*.py' or 'src/**/*.ts'.",
                    "default": "**/*",
                },
                "max_results": {
                    "type": "integer",
                    "default": 50,
                    "description": "Max hits (≤500).",
                },
            },
            "required": ["pattern"],
        },
    },
}


async def grep_code(
    session,
    *,
    pattern: str,
    glob: str = "**/*",
    max_results: int = 50,
) -> str:
    """Run a regex search across the session cwd. Returns JSON string."""
    max_results = max(1, min(500, int(max_results)))

    if ".." in glob or glob.startswith("/") or (len(glob) > 1 and glob[1] == ":"):
        return json.dumps({
            "error": "Invalid glob: cross-cwd paths not allowed",
            "code": "INVALID_GLOB",
        })

    try:
        rx = re.compile(pattern)
    except re.error as exc:
        return json.dumps({
            "error": f"Invalid regex: {exc}",
            "code": "INVALID_PATTERN",
        })

    cwd: Path = session.cwd
    hits: list[dict] = []
    for path in cwd.glob(glob):
        if not path.is_file() or not is_indexable(path):
            continue
        try:
            with path.open("r", encoding="utf-8", errors="replace") as f:
                for i, line in enumerate(f, 1):
                    if rx.search(line):
                        rel = str(path.relative_to(cwd)).replace("\\", "/")
                        hits.append({
                            "file": rel,
                            "line": i,
                            "content": line.rstrip("\n"),
                        })
                        if len(hits) >= max_results:
                            return json.dumps(hits, ensure_ascii=False)
        except OSError:
            continue
    return json.dumps(hits, ensure_ascii=False)
