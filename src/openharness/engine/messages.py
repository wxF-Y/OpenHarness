"""Conversation message models used by the query engine."""

from __future__ import annotations

import base64
import mimetypes
import re
from pathlib import Path
from typing import Any, Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


class TextBlock(BaseModel):
    """Plain text content."""

    type: Literal["text"] = "text"
    text: str


class ImageBlock(BaseModel):
    """Image content encoded inline for multimodal providers."""

    type: Literal["image"] = "image"
    media_type: str
    data: str
    source_path: str = ""

    @classmethod
    def from_path(cls, path: str | Path) -> "ImageBlock":
        """Load a local image file into a base64-backed content block."""
        resolved = Path(path).expanduser().resolve()
        media_type, _ = mimetypes.guess_type(str(resolved))
        if not media_type or not media_type.startswith("image/"):
            raise ValueError(f"Unsupported image attachment: {resolved}")
        payload = base64.b64encode(resolved.read_bytes()).decode("ascii")
        return cls(media_type=media_type, data=payload, source_path=str(resolved))


class DocumentBlock(BaseModel):
    """Text extracted from a document file (PDF, DOCX, CSV, JSON, code, etc.)."""

    type: Literal["document"] = "document"
    filename: str
    mime_type: str
    text_content: str


class ToolUseBlock(BaseModel):
    """A request from the model to execute a named tool."""

    type: Literal["tool_use"] = "tool_use"
    id: str = Field(default_factory=lambda: f"toolu_{uuid4().hex}")
    name: str
    input: dict[str, Any] = Field(default_factory=dict)


class ThinkingBlock(BaseModel):
    """Extended thinking content produced by the model (must be replayed in multi-turn)."""

    type: Literal["thinking"] = "thinking"
    thinking: str
    signature: str = ""


class ToolResultBlock(BaseModel):
    """Tool result content sent back to the model."""

    type: Literal["tool_result"] = "tool_result"
    tool_use_id: str
    content: str | list[dict[str, Any]] = ""
    is_error: bool = False
    result_metadata: dict[str, Any] = Field(default_factory=dict)


ContentBlock = Annotated[
    TextBlock | ImageBlock | DocumentBlock | ToolUseBlock | ThinkingBlock | ToolResultBlock,
    Field(discriminator="type"),
]


class ConversationMessage(BaseModel):
    """A single assistant or user message."""

    role: Literal["user", "assistant"]
    content: list[ContentBlock] = Field(default_factory=list)
    system_event: str | None = None

    @field_validator("content", mode="before")
    @classmethod
    def _normalize_content(cls, value: Any) -> list[Any]:
        """Normalize legacy/null payloads before block validation."""
        if value is None:
            return []
        return value

    @classmethod
    def from_user_text(cls, text: str) -> "ConversationMessage":
        """Construct a user message from raw text."""
        return cls(role="user", content=[TextBlock(text=text)])

    @classmethod
    def from_user_content(cls, content: list[ContentBlock]) -> "ConversationMessage":
        """Construct a user message from explicit content blocks."""
        return cls(role="user", content=list(content))

    @property
    def text(self) -> str:
        """Return concatenated text blocks."""
        return "".join(
            block.text for block in self.content if isinstance(block, TextBlock)
        )

    @property
    def tool_uses(self) -> list[ToolUseBlock]:
        """Return all tool calls contained in the message."""
        return [block for block in self.content if isinstance(block, ToolUseBlock)]

    def to_api_param(self) -> dict[str, Any]:
        """Convert the message into Anthropic SDK message params."""
        return {
            "role": self.role,
            "content": [serialize_content_block(block) for block in self.content],
        }

    def is_effectively_empty(self) -> bool:
        """Return True when the message carries no useful content."""
        if self.content:
            for block in self.content:
                if isinstance(block, TextBlock) and block.text.strip():
                    return False
                if isinstance(block, (ImageBlock, DocumentBlock, ToolUseBlock, ToolResultBlock, ThinkingBlock)):
                    return False
        return True


def sanitize_conversation_messages(messages: list[ConversationMessage]) -> list[ConversationMessage]:
    """Normalize restored conversation history into a provider-safe sequence.

    This drops legacy empty assistant messages and trims malformed trailing tool
    turns, such as an assistant ``tool_use`` message that never received a
    matching user ``tool_result`` response. Those broken tails can happen when a
    session is interrupted mid-turn and would later cause OpenAI-compatible
    providers to reject the resumed conversation.
    """
    sanitized: list[ConversationMessage] = []
    pending_tool_use_ids: set[str] = set()
    pending_tool_use_index: int | None = None

    for message in messages:
        if message.role == "assistant" and message.is_effectively_empty():
            continue

        tool_uses = message.tool_uses if message.role == "assistant" else []
        tool_results = [
            block for block in message.content if isinstance(block, ToolResultBlock)
        ] if message.role == "user" else []

        matched_pending_tool_results = False
        if pending_tool_use_ids:
            result_ids = {block.tool_use_id for block in tool_results}
            if message.role != "user" or not pending_tool_use_ids.issubset(result_ids):
                if pending_tool_use_index is not None and pending_tool_use_index < len(sanitized):
                    sanitized.pop(pending_tool_use_index)
                pending_tool_use_ids = set()
                pending_tool_use_index = None
            else:
                matched_pending_tool_results = True
                pending_tool_use_ids = set()
                pending_tool_use_index = None

        if message.role == "user" and tool_results and not matched_pending_tool_results:
            content = [
                block for block in message.content if not isinstance(block, ToolResultBlock)
            ]
            if not content:
                continue
            message = ConversationMessage(role="user", content=content)

        sanitized.append(message)

        if tool_uses:
            pending_tool_use_ids = {block.id for block in tool_uses}
            pending_tool_use_index = len(sanitized) - 1

    if pending_tool_use_ids and pending_tool_use_index is not None and pending_tool_use_index < len(sanitized):
        sanitized.pop(pending_tool_use_index)

    return sanitized


def serialize_content_block(block: ContentBlock) -> dict[str, Any]:
    """Convert a local content block into the provider wire format."""

    def _clean(s: str) -> str:
        """Strip lone surrogate characters that break UTF-8 API serialization."""
        return s.encode("utf-8", errors="replace").decode("utf-8")

    if isinstance(block, TextBlock):
        return {"type": "text", "text": _clean(block.text)}

    if isinstance(block, ImageBlock):
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": block.media_type,
                "data": block.data,
            },
        }

    if isinstance(block, DocumentBlock):
        return {
            "type": "text",
            "text": (
                f"<attachment filename=\"{block.filename}\" mime_type=\"{block.mime_type}\">\n"
                f"{_clean(block.text_content)}\n"
                f"</attachment>"
            ),
        }

    if isinstance(block, ToolUseBlock):
        return {
            "type": "tool_use",
            "id": block.id,
            "name": block.name,
            "input": block.input,
        }

    if isinstance(block, ThinkingBlock):
        return {
            "type": "thinking",
            "thinking": _clean(block.thinking),
            "signature": block.signature,
        }

    # ToolResultBlock — content may be str or list[dict] (multi-modal tool result)
    if isinstance(block.content, list):
        return {
            "type": "tool_result",
            "tool_use_id": block.tool_use_id,
            "content": block.content,
            "is_error": block.is_error,
        }
    return {
        "type": "tool_result",
        "tool_use_id": block.tool_use_id,
        "content": _clean(block.content),
        "is_error": block.is_error,
    }


def assistant_message_from_api(raw_message: Any) -> ConversationMessage:
    """Convert an Anthropic SDK message object into a conversation message."""
    content: list[ContentBlock] = []

    for raw_block in getattr(raw_message, "content", []):
        block_type = getattr(raw_block, "type", None)
        if block_type == "text":
            content.append(TextBlock(text=getattr(raw_block, "text", "")))
        elif block_type == "thinking":
            content.append(ThinkingBlock(
                thinking=getattr(raw_block, "thinking", ""),
                signature=getattr(raw_block, "signature", ""),
            ))
        elif block_type == "tool_use":
            content.append(
                ToolUseBlock(
                    id=getattr(raw_block, "id", f"toolu_{uuid4().hex}"),
                    name=getattr(raw_block, "name", ""),
                    input=dict(getattr(raw_block, "input", {}) or {}),
                )
            )

    return ConversationMessage(role="assistant", content=content)


# ---------------------------------------------------------------------------
# System event helpers — structured markers injected into conversation history
# so the model sees operational events as part of its context.
#
# Format:  [system_event:<type>] <human-readable detail>
#
# Adding a new event type: call make_system_event_message() with a new type
# string and a descriptive detail.  The replay layer auto-converts any
# system_event message to a UI "system" transcript item.
# ---------------------------------------------------------------------------

_SYSTEM_EVENT_PREFIX = "[system_event:"
_SYSTEM_EVENT_TYPE_RE = re.compile(r"^[a-z_]+$")

# Human-readable UI labels for each event type (shown in the transcript).
_SYSTEM_EVENT_LABELS: dict[str, str] = {
    "user_interrupted": "Interrupted by user.",
}


def make_system_event_message(event_type: str, detail: str = "") -> "ConversationMessage":
    """Build a user-role ConversationMessage carrying a system event marker.

    The message is stored in conversation history so the model receives it as
    context.  The replay layer converts it to a UI system transcript item.
    Detection uses the `system_event` metadata field, not the text content,
    so user-submitted text cannot spoof system events.
    """
    body = f"{_SYSTEM_EVENT_PREFIX}{event_type}]"
    if detail:
        body = f"{body} {detail}"
    return ConversationMessage(role="user", content=[TextBlock(text=body)], system_event=event_type)


def parse_system_event(message: "ConversationMessage") -> tuple[str, str] | None:
    """Return (event_type, detail) if the message is a system event, else None.

    Detection is based on the `system_event` metadata field — not on text
    content — so user messages cannot accidentally or maliciously trigger
    system event handling.
    """
    event_type = getattr(message, "system_event", None)
    if event_type is None:
        return None
    if not _SYSTEM_EVENT_TYPE_RE.fullmatch(event_type):
        return None
    # Extract human-readable detail from text content if available.
    content = getattr(message, "content", [])
    detail = ""
    if content and isinstance(content[0], TextBlock):
        text = content[0].text
        close = text.find("]", len(_SYSTEM_EVENT_PREFIX))
        if close != -1:
            detail = text[close + 1:].strip()
    return event_type, detail


def system_event_ui_label(event_type: str, detail: str = "") -> str:
    """Return a human-readable label for display in the UI transcript."""
    return _SYSTEM_EVENT_LABELS.get(event_type, detail or event_type)

