---
change: dynamic-role-tool-registry
design-doc: docs/superpowers/specs/2026-05-27-dynamic-role-tool-registry-design.md
base-ref: d50fd7f66380af96cf5e8898d563d8e50e2886fc
archived-with: 2026-05-27-dynamic-role-tool-registry
---

# Dynamic Role Tool Registry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 swarm 团队的 leader/member 工具集区分从提示词软约束提升为 API schema 层硬约束，member session 的工具注册表中排除所有 leader 专属 `team_*` 协调工具。

**Architecture:** 在 `tools/__init__.py` 定义 `LEADER_EXCLUSIVE_TOOLS` 常量和 `create_member_tool_registry()` 工厂函数；`swarm/in_process.py` 的 `_build_member_query_context()` 改用新工厂函数；同步精简 `team_spawn_member_tool.py` 中现已多余的文字禁令。

**Tech Stack:** Python 3.11+, pytest, openharness 内部模块

archived-with: 2026-05-27-dynamic-role-tool-registry
---

## 文件清单

| 操作 | 文件 |
|------|------|
| Modify | `src/openharness/tools/__init__.py` |
| Modify | `src/openharness/swarm/in_process.py` |
| Modify | `src/openharness/tools/team_spawn_member_tool.py` |
| Create | `tests/test_tools/test_role_tool_registry.py` |

archived-with: 2026-05-27-dynamic-role-tool-registry
---

### Task 1：定义工具集边界常量与工厂函数（tools/__init__.py）

**Files:**
- Modify: `src/openharness/tools/__init__.py:119-127`
- Create: `tests/test_tools/test_role_tool_registry.py`

archived-with: 2026-05-27-dynamic-role-tool-registry
---

- [ ] **Step 1.1：写失败测试**

新建 `tests/test_tools/test_role_tool_registry.py`，内容如下：

```python
"""Tests for role-scoped tool registry."""

from __future__ import annotations

import pytest

from openharness.tools import (
    LEADER_EXCLUSIVE_TOOLS,
    create_default_tool_registry,
    create_member_tool_registry,
)


def test_leader_exclusive_tools_is_frozenset():
    assert isinstance(LEADER_EXCLUSIVE_TOOLS, frozenset)


def test_leader_exclusive_tools_nonempty():
    assert len(LEADER_EXCLUSIVE_TOOLS) >= 12


def test_leader_exclusive_tools_contains_required_names():
    required = {
        "team_create_run", "team_spawn_member", "team_list_members",
        "team_wait", "team_read_mailbox", "team_send_message",
        "team_shutdown_member", "team_request_plan", "team_review_plan",
        "team_request_shutdown", "team_create", "team_delete",
    }
    assert required <= LEADER_EXCLUSIVE_TOOLS


def test_create_member_tool_registry_excludes_leader_tools():
    registry = create_member_tool_registry()
    names = {t.name for t in registry.list_tools()}
    overlap = names & LEADER_EXCLUSIVE_TOOLS
    assert overlap == set(), f"member registry contains leader tools: {overlap}"


def test_create_member_tool_registry_retains_base_tools():
    registry = create_member_tool_registry()
    names = {t.name for t in registry.list_tools()}
    base_tools = {"bash", "file_read", "file_edit", "file_write",
                  "glob", "grep", "web_fetch", "web_search", "skill", "todo_write"}
    missing = base_tools - names
    assert missing == set(), f"base tools missing from member registry: {missing}"


def test_member_registry_is_strict_subset_of_default():
    default_names = {t.name for t in create_default_tool_registry().list_tools()}
    member_names = {t.name for t in create_member_tool_registry().list_tools()}
    assert member_names < default_names, "member registry must be strict subset of default"
    assert default_names - member_names == LEADER_EXCLUSIVE_TOOLS, (
        f"difference should equal LEADER_EXCLUSIVE_TOOLS exactly, got: "
        f"{default_names - member_names}"
    )


def test_create_member_tool_registry_accepts_mcp_manager_none():
    """Signature compatible with create_default_tool_registry."""
    registry = create_member_tool_registry(mcp_manager=None)
    assert registry is not None
```

- [ ] **Step 1.2：运行测试，确认失败（符合 TDD）**

```bash
cd e:/AI/OpenHarness
python -m pytest tests/test_tools/test_role_tool_registry.py -v 2>&1 | head -30
```

预期：`ImportError: cannot import name 'LEADER_EXCLUSIVE_TOOLS'`（尚未实现）

archived-with: 2026-05-27-dynamic-role-tool-registry
---

- [ ] **Step 1.3：在 `tools/__init__.py` 添加常量和工厂函数**

在 `src/openharness/tools/__init__.py` 中，在 `create_default_tool_registry` 函数定义之后、`__all__` 之前插入以下代码（第 119 行之后）：

```python
LEADER_EXCLUSIVE_TOOLS: frozenset[str] = frozenset({
    "team_create_run",
    "team_spawn_member",
    "team_list_members",
    "team_wait",
    "team_read_mailbox",
    "team_send_message",
    "team_shutdown_member",
    "team_request_plan",
    "team_review_plan",
    "team_request_shutdown",
    "team_create",
    "team_delete",
})
"""Leader-exclusive team coordination tools excluded from member tool registries.

When adding new team_* coordination tools, register them here to ensure
member sessions never receive access to leader-only capabilities.
"""


def create_member_tool_registry(mcp_manager=None) -> ToolRegistry:
    """Return a tool registry for member sessions.

    Contains all default tools minus LEADER_EXCLUSIVE_TOOLS.
    MCP tools (passed via mcp_manager) are treated as base tools and included.
    Signature mirrors create_default_tool_registry for future compatibility.
    """
    registry = ToolRegistry()
    for tool in create_default_tool_registry(mcp_manager).list_tools():
        if tool.name not in LEADER_EXCLUSIVE_TOOLS:
            registry.register(tool)
    return registry
```

同时将 `__all__` 更新为（替换现有 `__all__` 块）：

```python
__all__ = [
    "BaseTool",
    "LEADER_EXCLUSIVE_TOOLS",
    "ToolExecutionContext",
    "ToolRegistry",
    "ToolResult",
    "create_default_tool_registry",
    "create_member_tool_registry",
]
```

- [ ] **Step 1.4：运行测试，确认全部通过**

```bash
cd e:/AI/OpenHarness
python -m pytest tests/test_tools/test_role_tool_registry.py -v
```

预期：7 个测试全部 `PASSED`

- [ ] **Step 1.5：提交**

```bash
cd e:/AI/OpenHarness
git add src/openharness/tools/__init__.py tests/test_tools/test_role_tool_registry.py
git commit -m "feat: add LEADER_EXCLUSIVE_TOOLS and create_member_tool_registry"
```

archived-with: 2026-05-27-dynamic-role-tool-registry
---

### Task 2：接入 in-process 后端（swarm/in_process.py）

**Files:**
- Modify: `src/openharness/swarm/in_process.py:434,453`

archived-with: 2026-05-27-dynamic-role-tool-registry
---

- [ ] **Step 2.1：修改 `_build_member_query_context` 中的 import**

在 `src/openharness/swarm/in_process.py` 的 `_build_member_query_context` 函数内（第 434 行），将：

```python
from openharness.tools import create_default_tool_registry
```

替换为：

```python
from openharness.tools import create_member_tool_registry
```

- [ ] **Step 2.2：替换工具注册表调用**

在同一函数内（第 453 行），将：

```python
tool_registry = create_default_tool_registry()
```

替换为：

```python
tool_registry = create_member_tool_registry()
```

- [ ] **Step 2.3：运行相关测试，确认无回归**

```bash
cd e:/AI/OpenHarness
python -m pytest tests/test_swarm/ tests/test_tools/ -v 2>&1 | tail -20
```

预期：所有测试通过（无新失败）

- [ ] **Step 2.4：提交**

```bash
cd e:/AI/OpenHarness
git add src/openharness/swarm/in_process.py
git commit -m "fix: use create_member_tool_registry in in-process member sessions"
```

archived-with: 2026-05-27-dynamic-role-tool-registry
---

### Task 3：精简 member 系统提示词（team_spawn_member_tool.py）

**Files:**
- Modify: `src/openharness/tools/team_spawn_member_tool.py:125-129`

archived-with: 2026-05-27-dynamic-role-tool-registry
---

- [ ] **Step 3.1：移除多余的文字禁令**

在 `src/openharness/tools/team_spawn_member_tool.py` 的 `member_system` 字符串中（第 125-129 行），将：

```python
        member_system = (
            f"You are '{arguments.member}', a member of swarm team '{arguments.team}'."
            + (f" run_id: {arguments.run_id}" if arguments.run_id else "")
            + "\n"
            + (f"Your role: {role_prompt}\n\n" if role_prompt else "")
            + "IMPORTANT — Do NOT call team coordination tools: "
            "team_wait, team_read_mailbox, team_create_run, team_spawn_member, "
            "team_list_members, team_request_plan, team_review_plan, team_request_shutdown, team_shutdown_member. "
            "Those tools are for the Leader only. "
            "The system automatically notifies the Leader when you finish — you do not need to do this manually.\n"
            "Focus only on your assigned task. "
            "You may receive follow-up instructions via your inbox during the task. "
            "When your work is finished, summarize your output clearly."
        )
```

替换为：

```python
        member_system = (
            f"You are '{arguments.member}', a member of swarm team '{arguments.team}'."
            + (f" run_id: {arguments.run_id}" if arguments.run_id else "")
            + "\n"
            + (f"Your role: {role_prompt}\n\n" if role_prompt else "")
            + "The system automatically notifies the Leader when you finish — you do not need to do this manually.\n"
            "Focus only on your assigned task. "
            "You may receive follow-up instructions via your inbox during the task. "
            "When your work is finished, summarize your output clearly."
        )
```

- [ ] **Step 3.2：运行全量工具测试，确认无回归**

```bash
cd e:/AI/OpenHarness
python -m pytest tests/test_tools/ tests/test_swarm/ -v 2>&1 | tail -20
```

预期：所有测试通过

- [ ] **Step 3.3：提交**

```bash
cd e:/AI/OpenHarness
git add src/openharness/tools/team_spawn_member_tool.py
git commit -m "refactor: remove redundant tool prohibition from member system prompt"
```

archived-with: 2026-05-27-dynamic-role-tool-registry
---

### Task 4：更新 tasks.md 并运行完整测试套件

**Files:**
- Modify: `openspec/changes/dynamic-role-tool-registry/tasks.md`

archived-with: 2026-05-27-dynamic-role-tool-registry
---

- [ ] **Step 4.1：运行完整测试套件**

```bash
cd e:/AI/OpenHarness
python -m pytest tests/ -x -q 2>&1 | tail -30
```

预期：全部通过，无新失败

- [ ] **Step 4.2：勾选 tasks.md 所有任务**

将 `openspec/changes/dynamic-role-tool-registry/tasks.md` 中全部 `- [ ]` 替换为 `- [x]`

- [ ] **Step 4.3：最终提交**

```bash
cd e:/AI/OpenHarness
git add openspec/changes/dynamic-role-tool-registry/tasks.md
git commit -m "chore: mark all dynamic-role-tool-registry tasks complete"
```
