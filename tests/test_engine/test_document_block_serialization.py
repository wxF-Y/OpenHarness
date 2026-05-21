"""Tests for DocumentBlock and ToolResultBlock list serialization."""
import pytest
from openharness.engine.messages import (
    DocumentBlock,
    ImageBlock,
    TextBlock,
    ToolResultBlock,
    serialize_content_block,
)


def test_document_block_serializes_to_text():
    block = DocumentBlock(filename="report.pdf", mime_type="application/pdf", text_content="Hello PDF")
    result = serialize_content_block(block)
    assert result["type"] == "text"
    assert "report.pdf" in result["text"]
    assert "Hello PDF" in result["text"]
    assert "<attachment" in result["text"]
    assert "application/pdf" in result["text"]


def test_tool_result_block_str_content_unchanged():
    block = ToolResultBlock(tool_use_id="t1", content="command output")
    result = serialize_content_block(block)
    assert result["content"] == "command output"
    assert result["type"] == "tool_result"


def test_tool_result_block_list_content_preserved():
    content_list = [
        {"type": "text", "text": "Wrote image.png"},
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "abc"}},
    ]
    block = ToolResultBlock(tool_use_id="t2", content=content_list)
    result = serialize_content_block(block)
    assert isinstance(result["content"], list)
    assert result["content"][0]["text"] == "Wrote image.png"
    assert result["content"][1]["type"] == "image"


def test_tool_result_block_str_and_list_roundtrip():
    """pydantic v2 should auto-handle str | list[dict] without field_validator."""
    # str form
    b1 = ToolResultBlock(tool_use_id="x", content="hello")
    assert b1.content == "hello"

    # list form
    b2 = ToolResultBlock(tool_use_id="y", content=[{"type": "text", "text": "ok"}])
    assert isinstance(b2.content, list)

    # round-trip via model_dump / model_validate
    import json
    dumped = b1.model_dump()
    restored = ToolResultBlock.model_validate(dumped)
    assert restored.content == "hello"

    dumped2 = b2.model_dump()
    restored2 = ToolResultBlock.model_validate(dumped2)
    assert isinstance(restored2.content, list)
