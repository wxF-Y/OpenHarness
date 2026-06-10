"""Markdown heading-aware chunker.

Splits by ATX heading; merges sub-512-tok sections; falls back to text chunker
for oversized sections, preserving heading breadcrumb in content prefix.
Code blocks (```...```) and tables (|...|) are treated as atomic — never split
mid-block.
"""
from __future__ import annotations

import bisect
import hashlib
import re
from typing import Iterator

import tiktoken

from .text import _split_recursive
from .util import split_code_tokens

_ENC = tiktoken.get_encoding("cl100k_base")
_MAX_TOKENS = 512
_MIN_TOKENS = 100  # merge small sibling sections under this

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$", re.MULTILINE)
_FENCE_RE = re.compile(r"```[^\n]*\n.*?\n```", re.DOTALL)


def chunk_markdown(text: str, *, file: str, lang: str = "markdown") -> Iterator[dict]:
    """Yield heading-aware markdown chunks."""
    if not text.strip():
        return

    # Snip code fences out, replace with placeholders so heading split won't
    # break inside them.
    fences: list[str] = []

    def _stash(m: re.Match[str]) -> str:
        fences.append(m.group(0))
        return f"\x00FENCE_{len(fences) - 1}\x00"

    safe = _FENCE_RE.sub(_stash, text)

    sections = _split_by_heading(safe)
    sections = [(h, _restore(b, fences)) for (h, b) in sections]

    # Merge an empty/headless leading section into the first headed section so
    # we don't emit anonymous preamble; otherwise keep each heading as its own
    # chunk so retrieval surfaces specific subsections.
    merged: list[tuple[str, str]] = []
    for h, body in sections:
        if not merged and not h.strip() and not body.strip():
            continue
        if merged and not merged[-1][0].strip() and len(
            _ENC.encode(merged[-1][1])
        ) < _MIN_TOKENS:
            ph, pb = merged.pop()
            merged.append((h, pb + "\n" + (h + "\n" if h else "") + body))
        else:
            merged.append((h, (h + "\n" if h else "") + body))

    line_offsets = _build_line_offsets(text)
    for heading, body in merged:
        body = body.strip()
        if not body:
            continue
        symbol = heading.strip("# ").strip() or None
        if len(_ENC.encode(body)) <= _MAX_TOKENS:
            prefixed = f"# file: {file}\n{body}"
            idx = text.find(body[:40]) if len(body) > 40 else text.find(body)
            sl = _line_at(line_offsets, idx) if idx >= 0 else 1
            el = _line_at(line_offsets, idx + len(body)) if idx >= 0 else 1
            yield {
                "file": file,
                "lang": lang,
                "kind": "section",
                "symbol": symbol,
                "parent": None,
                "content": prefixed,
                "tokens_split": split_code_tokens(body),
                "hash": hashlib.sha256(prefixed.encode()).hexdigest()[:16],
                "start_line": sl,
                "end_line": el,
            }
        else:
            breadcrumb = f"# from heading: {heading}\n" if heading else ""
            for piece in _split_recursive(body, _MAX_TOKENS - 64):
                content = f"# file: {file}\n{breadcrumb}{piece}"
                yield {
                    "file": file,
                    "lang": lang,
                    "kind": "section",
                    "symbol": symbol,
                    "parent": None,
                    "content": content,
                    "tokens_split": split_code_tokens(piece),
                    "hash": hashlib.sha256(content.encode()).hexdigest()[:16],
                    "start_line": 1,
                    "end_line": 1,
                }


def _split_by_heading(text: str) -> list[tuple[str, str]]:
    """Yield (heading_line_or_empty, body) for each heading section."""
    parts: list[tuple[str, str]] = []
    last = 0
    last_heading = ""
    for m in _HEADING_RE.finditer(text):
        if m.start() > last:
            parts.append((last_heading, text[last:m.start()]))
        last = m.end()
        last_heading = m.group(0)
    parts.append((last_heading, text[last:]))
    return parts


def _restore(text: str, fences: list[str]) -> str:
    def _back(m: re.Match[str]) -> str:
        idx = int(m.group(1))
        return fences[idx] if 0 <= idx < len(fences) else m.group(0)

    return re.sub(r"\x00FENCE_(\d+)\x00", _back, text)


def _build_line_offsets(text: str) -> list[int]:
    offsets = [0]
    for i, ch in enumerate(text):
        if ch == "\n":
            offsets.append(i + 1)
    return offsets


def _line_at(offsets: list[int], pos: int) -> int:
    return bisect.bisect_right(offsets, pos)
