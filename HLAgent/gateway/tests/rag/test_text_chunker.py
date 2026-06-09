"""Recursive character chunker with tiktoken token budget."""
import pytest

from services.rag.chunkers.text import chunk_text


def test_short_text_one_chunk():
    chunks = list(chunk_text("hello world", file="a.txt"))
    assert len(chunks) == 1
    assert chunks[0]["content"].endswith("hello world")
    assert chunks[0]["file"] == "a.txt"
    assert chunks[0]["kind"] == "text"


def test_chunk_metadata_present():
    chunks = list(chunk_text("foo", file="x.md"))
    c = chunks[0]
    assert {"file", "lang", "kind", "symbol", "parent", "content",
            "tokens_split", "hash", "start_line", "end_line"} <= set(c.keys())
    assert c["lang"] == "text"
    assert c["hash"]


def test_long_text_splits_at_paragraph_boundary():
    para = "Word " * 200
    text = "\n\n".join([para, para, para, para])
    chunks = list(chunk_text(text, file="b.txt"))
    assert len(chunks) >= 2
    import tiktoken
    enc = tiktoken.get_encoding("cl100k_base")
    for c in chunks:
        assert len(enc.encode(c["content"])) <= 600


def test_chunks_have_unique_hash():
    text = "alpha\n\nbeta\n\ngamma"
    chunks = list(chunk_text(text * 100, file="c.txt"))
    hashes = [c["hash"] for c in chunks]
    assert len(set(hashes)) == len(hashes)
