"""Heading-aware markdown chunker."""
from services.rag.chunkers.markdown import chunk_markdown


SAMPLE = """\
# A
intro

## B
body of B

## C
body of C with longer content lorem ipsum dolor sit amet consectetur.

### C.1
nested section

```python
def keep_intact():
    return 1
```
"""


def test_chunks_by_heading():
    chunks = list(chunk_markdown(SAMPLE, file="x.md"))
    symbols = [c["symbol"] for c in chunks if c["symbol"]]
    assert any("A" == s for s in symbols)
    assert any("B" == s or "C" == s for s in symbols)


def test_code_fence_intact():
    chunks = list(chunk_markdown(SAMPLE, file="x.md"))
    blobs = " ".join(c["content"] for c in chunks)
    assert "def keep_intact" in blobs
    keep_count = sum(1 for c in chunks if "def keep_intact" in c["content"])
    assert keep_count == 1


def test_empty_input():
    chunks = list(chunk_markdown("", file="x.md"))
    assert chunks == []
