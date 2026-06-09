"""Tree-sitter AST chunker for source code files.

M1 supports Python only. M2 extends to TypeScript/JavaScript/Go/Java/C/C++/Rust.

For each function / method / class, yield a chunk with the body verbatim plus a
context prefix (file path, parent class). Chunks exceeding 512 tokens are
recursively re-split with the text chunker, retaining a breadcrumb header.
"""
from __future__ import annotations

import hashlib
from typing import Iterator

import tiktoken
from tree_sitter_language_pack import get_parser

from .text import chunk_text
from .util import split_code_tokens

_ENC = tiktoken.get_encoding("cl100k_base")
_CHUNK_MAX_TOKENS = 512

# Per-language node kinds that map to chunk-worthy units.
_NODE_KINDS: dict[str, dict[str, str]] = {
    "python": {
        "function_definition": "function",
        "class_definition": "class",
    },
}


def _call_or_attr(obj, name):
    """Access tree-sitter attribute that may be method (>=0.25) or property."""
    v = getattr(obj, name)
    return v() if callable(v) else v


def _kind(node) -> str:
    k = getattr(node, "kind", None) or getattr(node, "type", None)
    return k() if callable(k) else k


def _start_byte(node) -> int:
    return _call_or_attr(node, "start_byte")


def _end_byte(node) -> int:
    return _call_or_attr(node, "end_byte")


def _start_row(node) -> int:
    sp = _call_or_attr(node, "start_position")
    return sp.row if hasattr(sp, "row") else sp[0]


def _end_row(node) -> int:
    ep = _call_or_attr(node, "end_position")
    return ep.row if hasattr(ep, "row") else ep[0]


def _iter_children(node):
    cc = getattr(node, "children", None)
    if cc is not None and not callable(cc):
        yield from cc
        return
    count = _call_or_attr(node, "child_count")
    for i in range(count):
        yield node.child(i)


def chunk_code(source: str, *, file: str, lang: str) -> Iterator[dict]:
    """Yield chunks for a code file. Returns empty iterator if lang unsupported."""
    node_kinds = _NODE_KINDS.get(lang)
    if not node_kinds:
        return
    parser = get_parser(lang)
    source_bytes = source.encode("utf-8")
    try:
        tree = parser.parse(source_bytes)
    except TypeError:
        tree = parser.parse(source)
    root = tree.root_node
    if callable(root):
        root = root()
    yield from _walk(root, source_bytes, file=file, lang=lang,
                     node_kinds=node_kinds, parent=None)


def _walk(node, source_bytes: bytes, *, file: str, lang: str,
          node_kinds: dict[str, str], parent: str | None) -> Iterator[dict]:
    for child in _iter_children(node):
        kind = node_kinds.get(_kind(child))
        if kind:
            symbol = _node_name(child, source_bytes)
            body = source_bytes[_start_byte(child):_end_byte(child)].decode(
                "utf-8", errors="replace"
            )
            prefix_lines = [f"# file: {file}"]
            if parent:
                prefix_lines.append(f"# parent: class {parent}")
            prefix = "\n".join(prefix_lines) + "\n"
            full = prefix + body
            if len(_ENC.encode(full)) <= _CHUNK_MAX_TOKENS:
                yield {
                    "file": file,
                    "lang": lang,
                    "kind": kind,
                    "symbol": symbol,
                    "parent": parent,
                    "content": full,
                    "tokens_split": split_code_tokens(body),
                    "hash": hashlib.sha256(full.encode()).hexdigest()[:16],
                    "start_line": _start_row(child) + 1,
                    "end_line": _end_row(child) + 1,
                }
            else:
                breadcrumb = f"# from {parent or 'module'}.{symbol}\n"
                for sub in chunk_text(breadcrumb + body, file=file,
                                      lang=lang, kind=kind):
                    sub["symbol"] = symbol
                    sub["parent"] = parent
                    sub["start_line"] = _start_row(child) + 1
                    sub["end_line"] = _end_row(child) + 1
                    yield sub
            if kind == "class":
                # recurse into class body so methods appear as separate chunks
                for grand in _iter_children(child):
                    if _kind(grand) == "block":
                        yield from _walk(grand, source_bytes, file=file, lang=lang,
                                         node_kinds=node_kinds, parent=symbol)
                        break
        else:
            yield from _walk(child, source_bytes, file=file, lang=lang,
                             node_kinds=node_kinds, parent=parent)


def _node_name(node, source_bytes: bytes) -> str:
    """Extract identifier child's text — works for Python function/class defs."""
    for c in _iter_children(node):
        if _kind(c) == "identifier":
            return source_bytes[_start_byte(c):_end_byte(c)].decode(
                "utf-8", errors="replace"
            )
    return "<anon>"
