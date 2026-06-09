"""Helpers for code-aware FTS5 tokenization.

FTS5 default `porter unicode61` does not split camelCase/snake_case/kebab-case.
We pre-tokenize the chunk content into a separate FTS column so BM25 can match
identifier fragments. Original tokens are also retained so exact matches still
score well.
"""
from __future__ import annotations

import re

# 第一层：下划线 / 连字符 / 空白 / 数字 作为分隔符（数字本身被丢弃，
# 这样 user2FAToken 会先拆出 user 和 FAToken 两段）。
_DIGIT_SPLIT_RE = re.compile(r"[_\-\s0-9]+")

# 第二层：驼峰拆分
#   - 小写 / 数字到大写过渡（aB → a B）
#   - 大写簇尾到大写+小写（HTTPSConn → HTTPS Conn）
_CAMEL_SPLIT_RE = re.compile(
    r"(?<=[a-z0-9])(?=[A-Z])"
    r"|(?<=[A-Z])(?=[A-Z][a-z])"
)


def split_code_tokens(text: str) -> str:
    """Return space-separated tokens for FTS5 tokens_split column.

    Includes the original identifier (validateUser stays in the output) plus
    the intermediate digit/separator splits (user2FAToken → FAToken) plus the
    camelCase component tokens (validateUser → validate, User) so both exact
    and fragment matches score well in BM25.
    """
    if not text:
        return ""
    parts: list[str] = []
    for raw in text.split():
        # 保留原 token（含分隔符）
        parts.append(raw)
        # 第一层：按分隔符 / 数字拆分
        for piece in _DIGIT_SPLIT_RE.split(raw):
            if not piece:
                continue
            if piece != raw:
                parts.append(piece)
            # 第二层：再做驼峰拆分
            for sub in _CAMEL_SPLIT_RE.split(piece):
                if sub:
                    parts.append(sub)
    return " ".join(parts)
