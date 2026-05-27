---
comet_change: dynamic-role-tool-registry
role: technical-design
canonical_spec: openspec
archived-with: 2026-05-27-dynamic-role-tool-registry
status: final
---

# Dynamic Role Tool Registry — Technical Design

## 问题背景

In-process member session 通过 `_build_member_query_context()` 创建工具注册表时，始终调用 `create_default_tool_registry()`，将所有 ~40 个工具（含所有 `team_*` 协调工具）全部注入 API schema。LLM 能"看见"这些工具，提示词的文字禁令是软约束，已有真实越权调用记录。

## 实现设计

### 1. `tools/__init__.py` — 两处新增

**新增常量：**

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
```

**新增工厂函数：**

```python
def create_member_tool_registry(mcp_manager=None) -> ToolRegistry:
    """Member tool registry: base tools + MCP tools, excluding LEADER_EXCLUSIVE_TOOLS."""
    registry = ToolRegistry()
    for tool in create_default_tool_registry(mcp_manager).list_tools():
        if tool.name not in LEADER_EXCLUSIVE_TOOLS:
            registry.register(tool)
    return registry
```

签名与 `create_default_tool_registry` 对齐：`mcp_manager=None` 作为可选参数。MCP 工具属于 base utils，不在 `LEADER_EXCLUSIVE_TOOLS` 中，自然传递给 member。

### 2. `swarm/in_process.py` — 单行替换

```python
# 修改前
from openharness.tools import create_default_tool_registry
tool_registry = create_default_tool_registry()

# 修改后
from openharness.tools import create_member_tool_registry
tool_registry = create_member_tool_registry()
```

> **注**：当前 `_build_member_query_context` 没有 `mcp_manager` 来源，传 `None` 与现状一致。未来若需要 in-process member 获得 MCP 工具，通过 `TeammateSpawnConfig` 传入 `mcp_manager` 即可，接口无需改动。

### 3. `team_spawn_member_tool.py` — 系统提示词精简

移除 `member_system` 中的冗余禁令段落：

```python
# 删除这段（工具已从 API schema 层消失，文字禁令无意义）
"IMPORTANT — Do NOT call team coordination tools: "
"team_wait, team_read_mailbox, team_create_run, team_spawn_member, "
"team_list_members, team_request_plan, team_review_plan, "
"team_request_shutdown, team_shutdown_member. "
"Those tools are for the Leader only. "
```

保留其他指导性内容（角色定义、inbox 说明、任务焦点）。

## 工具分类边界

```
LEADER_EXCLUSIVE_TOOLS（member 看不见）
────────────────────────────────────────
team_create_run       team_spawn_member    team_list_members
team_wait             team_read_mailbox    team_send_message
team_shutdown_member  team_request_plan    team_review_plan
team_request_shutdown team_create          team_delete

BASE TOOLS（leader 和 member 共有）
────────────────────────────────────────
bash            file_read       file_edit       file_write
glob            grep            web_fetch       web_search
agent           send_message    skill           todo_write
notebook_edit   task_*          cron_*          enter/exit_*
image_*         lsp             mcp_auth        MCP tools (via mcp_manager)
brief           sleep           tool_search     ...
```

`send_message`（coordinator 子 agent 通信）不在 `LEADER_EXCLUSIVE_TOOLS` 中，member 可用；`team_send_message`（swarm 协调）在其中，member 不可见。

## 测试策略

**单元测试（新增）：**

```python
# tests/tools/test_role_tool_registry.py

def test_leader_exclusive_tools_nonempty():
    assert len(LEADER_EXCLUSIVE_TOOLS) >= 12

def test_create_member_tool_registry_excludes_leader_tools():
    registry = create_member_tool_registry()
    names = {t.name for t in registry.list_tools()}
    assert names.isdisjoint(LEADER_EXCLUSIVE_TOOLS)

def test_create_member_tool_registry_retains_base_tools():
    registry = create_member_tool_registry()
    names = {t.name for t in registry.list_tools()}
    for expected in ("bash", "file_read", "file_edit", "glob", "grep", "web_fetch"):
        assert expected in names, f"base tool {expected!r} missing from member registry"

def test_create_member_registry_superset_check():
    """Member registry is a strict subset of default registry."""
    default_names = {t.name for t in create_default_tool_registry().list_tools()}
    member_names = {t.name for t in create_member_tool_registry().list_tools()}
    assert member_names < default_names
    assert default_names - member_names == LEADER_EXCLUSIVE_TOOLS
```

**集成验证（手动）：**  
启动 swarm team，在 member session 的第一个 API 调用中打印 `tool_registry.list_tools()` 名称列表，确认不含 `team_spawn_member`。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 新增 `team_*` 工具时忘记加入 `LEADER_EXCLUSIVE_TOOLS` | 常量定义处加注释；单元测试 `test_create_member_registry_superset_check` 会在漏掉时给出明确 diff |
| subprocess 后端 member 仍有全量工具 | 本次范围内可接受（subprocess 进程隔离，后续单独跟进）；在 `LEADER_EXCLUSIVE_TOOLS` 注释中标注 |
| 系统提示词精简后 member 对禁令不感知 | 无需感知——工具不在 schema 里，Claude 根本不会尝试调用 |
