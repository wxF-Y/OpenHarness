"""Recursive character chunker — fallback for unknown file types.

Target: 512 tokens per chunk with 64 overlap.
Splits at paragraph (\\n\\n) > line (\\n) > sentence (". ") > word > char.
"""
from __future__ import annotations

import bisect
import hashlib
from typing import Iterator

import tiktoken

from .util import split_code_tokens

_ENC = tiktoken.get_encoding("cl100k_base")
_TARGET_TOKENS = 512
_OVERLAP_TOKENS = 64
_SEPARATORS = ["\n\n", "\n", ". ", " ", ""]


def _split_recursive(text: str, target: int, sep_idx: int = 0) -> list[str]:
    """Recursively split text aiming for chunks <= target tokens."""
    if len(_ENC.encode(text)) <= target:
        return [text]
    if sep_idx >= len(_SEPARATORS):
        return [text]
    sep = _SEPARATORS[sep_idx]
    parts = list(text) if sep == "" else text.split(sep)
    out: list[str] = []
    buf = ""
    for p in parts:
        joiner = sep if buf and sep else ""
        candidate = buf + joiner + p
        if len(_ENC.encode(candidate)) > target and buf:
            out.append(buf)
            buf = p
        else:
            buf = candidate
    if buf:
        out.append(buf)
    result: list[str] = []
    for piece in out:
        if len(_ENC.encode(piece)) > target:
            result.extend(_split_recursive(piece, target, sep_idx + 1))
        else:
            result.append(piece)
    return result


def chunk_text(
    text: str,
    *,
    file: str,
    lang: str = "text",
    kind: str = "text",
) -> Iterator[dict]:
    """Yield chunk dicts for a text file."""
    if not text.strip():
        return
    pieces = _split_recursive(text, _TARGET_TOKENS - _OVERLAP_TOKENS)
    line_offsets = _build_line_offsets(text)
    for piece in pieces:
        idx = text.find(piece)
        if idx < 0:
            start_line = end_line = 1
        else:
            start_line = _line_at(line_offsets, idx)
            end_line = _line_at(line_offsets, idx + len(piece))
        prefixed = f"# file: {file}\n{piece}"
        yield {
            "file": file,
            "lang": lang,
            "kind": kind,
            "symbol": None,
            "parent": None,
            "content": prefixed,
            "tokens_split": split_code_tokens(piece),
            "hash": hashlib.sha256(prefixed.encode()).hexdigest()[:16],
            "start_line": start_line,
            "end_line": end_line,
        }


def _build_line_offsets(text: str) -> list[int]:
    offsets = [0]
    for i, ch in enumerate(text):
        if ch == "\n":
            offsets.append(i + 1)
    return offsets


def _line_at(offsets: list[int], pos: int) -> int:
    return bisect.bisect_right(offsets, pos)
