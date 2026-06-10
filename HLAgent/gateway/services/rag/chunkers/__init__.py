"""Chunker dispatch: pick chunker by extension, with safety filters.

M1 chunkable extensions:
  - code: .py
  - markdown: .md, .mdx
  - text:    .txt, .json, .yaml, .yml, .toml, .ini, .cfg, .sh, .bash,
             .zsh, .csv, .tsv, .xml, .html, .htm, .css, .scss, .rst,
             and any unknown text file
M2 will extend code to .ts/.tsx/.js/.go/.java/.cpp/.h/.rs.
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterator

from .code import chunk_code
from .text import chunk_text

_MAX_FILE_BYTES = 1024 * 1024  # 1 MB

_EXT_MAP: dict[str, tuple[str, str]] = {
    ".py": ("code", "python"),
    ".md": ("markdown", "markdown"),
    ".mdx": ("markdown", "markdown"),
    ".ts": ("code", "typescript"),
    ".tsx": ("code", "tsx"),
    ".js": ("code", "javascript"),
    ".jsx": ("code", "javascript"),
    ".mjs": ("code", "javascript"),
    ".cjs": ("code", "javascript"),
    ".go": ("code", "go"),
    ".java": ("code", "java"),
    ".c": ("code", "c"),
    ".cpp": ("code", "cpp"),
    ".cc": ("code", "cpp"),
    ".cxx": ("code", "cpp"),
    ".h": ("code", "cpp"),
    ".hpp": ("code", "cpp"),
    ".hh": ("code", "cpp"),
    ".rs": ("code", "rust"),
}

_TEXT_EXTS = {
    ".txt", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".sh", ".bash", ".zsh", ".csv", ".tsv", ".xml", ".html",
    ".htm", ".css", ".scss", ".rst",
}


def is_indexable(path: Path) -> bool:
    """Cheap pre-filter: size + binary sniff."""
    try:
        size = path.stat().st_size
    except OSError:
        return False
    if size == 0 or size > _MAX_FILE_BYTES:
        return False
    if _is_binary(path):
        return False
    return True


def _is_binary(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            sample = f.read(8192)
        return b"\x00" in sample
    except OSError:
        return True


def iter_chunks(path: Path, *, rel_path: str) -> Iterator[dict]:
    """Dispatch by extension. Fall back to text on chunker failure."""
    if not is_indexable(path):
        return
    ext = path.suffix.lower()
    try:
        source = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return
    if ext in _EXT_MAP:
        kind, lang = _EXT_MAP[ext]
        if kind == "code":
            yielded = False
            try:
                for c in chunk_code(source, file=rel_path, lang=lang):
                    yielded = True
                    yield c
            except Exception:
                yielded = False
            if not yielded:
                yield from chunk_text(source, file=rel_path, lang=lang)
            return
        if kind == "markdown":
            from .markdown import chunk_markdown
            yielded = False
            try:
                for c in chunk_markdown(source, file=rel_path, lang=lang):
                    yielded = True
                    yield c
            except Exception:
                yielded = False
            if not yielded:
                yield from chunk_text(source, file=rel_path, lang=lang, kind="text")
            return
    yield from chunk_text(
        source, file=rel_path,
        lang="text",
        kind="text",
    )
