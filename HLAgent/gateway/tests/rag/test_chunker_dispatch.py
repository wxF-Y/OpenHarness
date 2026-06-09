"""Dispatcher routes by extension; gracefully handles unknown / binary / large."""
from pathlib import Path

import pytest

from services.rag.chunkers import iter_chunks, is_indexable


def test_python_routed_to_code_chunker(tmp_path):
    f = tmp_path / "a.py"
    f.write_text("def f(): pass\n")
    chunks = list(iter_chunks(f, rel_path="a.py"))
    assert any(c["lang"] == "python" and c["symbol"] == "f" for c in chunks)


def test_markdown_routed_to_text_chunker(tmp_path):
    f = tmp_path / "x.md"
    f.write_text("# Title\n\nbody")
    chunks = list(iter_chunks(f, rel_path="x.md"))
    assert any(c["lang"] == "markdown" for c in chunks)


def test_unknown_extension_routed_to_text(tmp_path):
    f = tmp_path / "y.txt"
    f.write_text("plain content")
    chunks = list(iter_chunks(f, rel_path="y.txt"))
    assert any(c["lang"] == "text" for c in chunks)


def test_binary_file_skipped(tmp_path):
    f = tmp_path / "img.png"
    f.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    assert is_indexable(f) is False
    assert list(iter_chunks(f, rel_path="img.png")) == []


def test_large_file_skipped(tmp_path):
    f = tmp_path / "big.txt"
    f.write_bytes(b"a" * (2 * 1024 * 1024))
    assert is_indexable(f) is False
    assert list(iter_chunks(f, rel_path="big.txt")) == []


def test_corrupt_python_falls_back_to_text(tmp_path):
    """A syntactically broken .py still produces text chunks via fallback."""
    f = tmp_path / "broken.py"
    f.write_text("def f(\n  this is not python")
    chunks = list(iter_chunks(f, rel_path="broken.py"))
    assert len(chunks) >= 1
