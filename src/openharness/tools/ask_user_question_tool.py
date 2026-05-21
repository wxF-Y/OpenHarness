"""Tool for asking the interactive user a follow-up question."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, Field, field_validator

from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult


AskUserPrompt = Callable[[str, "list[dict[str, Any]] | None", bool], Awaitable[str]]


class QuestionOption(BaseModel):
    """A single selectable option presented to the user."""

    label: str = Field(description="Short display label for the option")
    description: str | None = Field(default=None, description="Optional longer explanation")
    preview: str | None = Field(default=None, description="Optional code/text preview shown when focused")


class AskUserQuestionToolInput(BaseModel):
    """Arguments for asking the user a question."""

    question: str = Field(description="The question to ask the user")
    options: list[QuestionOption] | None = Field(
        default=None,
        description="Optional list of predefined choices. If omitted, the user types a free-form answer.",
    )
    multiSelect: bool | None = Field(
        default=None,
        description="Allow the user to select multiple options (only applicable when options are provided).",
    )

    @field_validator("options", mode="before")
    @classmethod
    def _coerce_options(cls, v: Any) -> Any:
        if isinstance(v, str):
            try:
                v = json.loads(v)
            except (json.JSONDecodeError, ValueError):
                return None
        return v


class AskUserQuestionTool(BaseTool):
    """Ask the interactive user a question and return the answer."""

    name = "ask_user_question"
    description = (
        "Ask the interactive user a follow-up question and return the answer. "
        "Optionally provide a list of choices for the user to select from."
    )
    input_model = AskUserQuestionToolInput

    def is_read_only(self, arguments: AskUserQuestionToolInput) -> bool:
        del arguments
        return True

    async def execute(
        self,
        arguments: AskUserQuestionToolInput,
        context: ToolExecutionContext,
    ) -> ToolResult:
        prompt = context.metadata.get("ask_user_prompt")
        if not callable(prompt):
            return ToolResult(
                output="ask_user_question is unavailable in this session",
                is_error=True,
            )
        options_payload: list[dict[str, Any]] | None = None
        if arguments.options:
            options_payload = [
                {
                    "label": o.label,
                    **({"description": o.description} if o.description else {}),
                    **({"preview": o.preview} if o.preview else {}),
                }
                for o in arguments.options
            ]
        if arguments.multiSelect:
            if options_payload is None:
                options_payload = []
        answer = str(await prompt(arguments.question, options_payload, bool(arguments.multiSelect))).strip()
        if not answer:
            return ToolResult(output="(no response)")
        return ToolResult(output=answer)
