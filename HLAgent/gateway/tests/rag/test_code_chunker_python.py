"""Tree-sitter Python AST chunker."""
import pytest

from services.rag.chunkers.code import chunk_code

SAMPLE = '''\
"""Module docstring."""

import os


def top_level(a, b):
    """Add two numbers."""
    return a + b


class Greeter:
    def __init__(self, name: str):
        self.name = name

    def greet(self) -> str:
        return f"Hello {self.name}"


async def fetch(url):
    return None
'''


def test_chunks_one_per_top_function_and_method():
    chunks = list(chunk_code(SAMPLE, file="sample.py", lang="python"))
    symbols = [c["symbol"] for c in chunks]
    assert "top_level" in symbols
    assert "Greeter" in symbols or "__init__" in symbols
    assert "greet" in symbols
    assert "fetch" in symbols


def test_method_has_parent_class_in_prefix():
    chunks = list(chunk_code(SAMPLE, file="sample.py", lang="python"))
    greet = next(c for c in chunks if c["symbol"] == "greet")
    assert "class Greeter" in greet["content"] or "Greeter" in greet["content"]


def test_metadata_complete():
    chunks = list(chunk_code(SAMPLE, file="sample.py", lang="python"))
    for c in chunks:
        assert {"file", "lang", "kind", "symbol", "parent", "content",
                "tokens_split", "hash", "start_line", "end_line"} <= set(c.keys())
        assert c["lang"] == "python"
        assert c["start_line"] >= 1
        assert c["end_line"] >= c["start_line"]
