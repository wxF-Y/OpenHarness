# Comet Design Handoff

- Change: dynamic-role-tool-registry
- Phase: design
- Mode: compact
- Context hash: 16ca05a2fb7135dc69df61e0597843f479dca492576bb76d24ad77e4d3333e69

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/dynamic-role-tool-registry/proposal.md

- Source: openspec/changes/dynamic-role-tool-registry/proposal.md
- Lines: 1-28
- SHA256: 445804dccdf9931f13e2d80f25a989a27814a56f5923b2f8a334306d6c2172e9

```md
## Why

当前 swarm 团队中，leader 和 member 的工具集区分完全依赖系统提示词中的文字约束（"禁止调用 team_wait、team_spawn_member..."），这是软约束，LLM 在特定场景下会忽略它。根本修复是在 session 创建时就将工具集固化——member 根本无法"看见" leader 专属工具，从而从 API 层消除越权调用的可能性。

## What Changes

- 在 `tools/__init__.py` 新增 `LEADER_EXCLUSIVE_TOOLS` 常量集合，定义 leader 专属的 `team_*` 协调工具列表
- 新增 `create_member_tool_registry()` 工厂函数，返回排除 leader 专属工具后的注册表
- 修改 `swarm/in_process.py` 的 `_build_member_query_context()`，改用 `create_member_tool_registry()` 替代 `create_default_tool_registry()`
- 修改 `swarm/subprocess_backend.py`（如存在），spawn 子进程时通过 CLI flag 传递 `--disallowed-tools`
- 可选：将 member 系统提示词中关于"禁止调用"的文字说明简化（因为工具已从 schema 层消失）

## Capabilities

### New Capabilities

- `role-scoped-tool-registry`：按角色动态生成工具注册表——leader 获得完整工具集，member 获得仅含基础工具的受限集合，约束从提示词层提升至 API schema 层

### Modified Capabilities

（无现有 spec 的行为改变）

## Impact

- **直接修改**：`src/openharness/tools/__init__.py`、`src/openharness/swarm/in_process.py`
- **次要修改**：`src/openharness/swarm/subprocess_backend.py`（子进程 spawn 路径）
- **可选简化**：`src/openharness/swarm/swarm_service.py` 中的 leader 系统提示词、`src/openharness/tools/team_spawn_member_tool.py` 中的 member 系统提示词
- **不影响**：现有 team_* 工具实现、协议状态机、mailbox 机制、API 接口
```

## openspec/changes/dynamic-role-tool-registry/design.md

- Source: openspec/changes/dynamic-role-tool-registry/design.md
- Lines: 1-89
- SHA256: 6ae931dc37dcb1dec768adac211deee3253ad5a374e1474a9174d0bb70ecdd78

[TRUNCATED]

```md
## Context

OpenHarness swarm 团队由一个 leader session 和若干 member session 组成。当前所有 session 均通过 `create_default_tool_registry()` 创建完全相同的工具注册表（约 40 个工具），包含所有 `team_*` 协调工具。

leader/member 的行为差异完全依赖系统提示词中的文字约束：
- leader 系统提示词（`_LEADER_SYSTEM_PROMPT_TEMPLATE`）列出可用的协调工具
- member 系统提示词（`team_spawn_member_tool.py` 中内联）明确写"IMPORTANT — Do NOT call team_wait, team_read_mailbox..."

此机制的缺陷在于工具仍然出现在 API schema 中，LLM 在某些场景下会无视文字禁令直接调用，导致协调混乱（commit `fix: prohibit member from calling leader coordination tools in system prompt` 已记录一次真实发生的越权调用）。

**关键代码位置：**
- `src/openharness/tools/__init__.py:58` — `create_default_tool_registry()`，全量注册表
- `src/openharness/swarm/in_process.py:453` — member session 创建时调用全量注册表
- `src/openharness/ui/runtime.py:361` — 主 session（leader）创建时调用全量注册表

## Goals / Non-Goals

**Goals:**
- leader 工具集 = 所有工具（含全部 `team_*` 协调工具）
- member 工具集 = 基础工具（不含 leader 专属 `team_*` 协调工具）
- 工具集在 session 创建时固化，从 API schema 层消除 member 对 leader 工具的访问
- 不改变任何工具的实现逻辑、协议状态机、或 mailbox 机制

**Non-Goals:**
- 不引入新的 `team_*` 工具
- 不修改 subprocess 子进程 spawn 路径（其工具约束已通过子进程独立注册表隔离）
- 不实现细粒度的动态权限叠加（如"leader 可给 member 临时授权某工具"）

## Decisions

### 决策 1：在 `tools/__init__.py` 定义工具集边界，而非在 swarm 模块内

**选择**：将 `LEADER_EXCLUSIVE_TOOLS` 常量和 `create_member_tool_registry()` 函数定义在 `tools/__init__.py` 中。

**理由**：工具注册表的职责属于 `tools` 模块；swarm 模块消费工具注册表但不应承担工具集划分的决策。将边界定义在源头，避免各消费方各自维护一份"哪些工具归 leader"的列表。

**备选方案**：在 `swarm/in_process.py` 内硬编码排除列表 → 被否：散布到各后端，难以同步。

---

### 决策 2：member 注册表用排除法（黑名单），而非包含法（白名单）

**选择**：`create_member_tool_registry()` 从全量工具集中排除 `LEADER_EXCLUSIVE_TOOLS`，而非显式列出 member 允许的工具。

**理由**：白名单会导致每次新增工具都需要手动决定是否加入 member 集合，容易遗漏；黑名单只需维护 leader 专属工具的边界，语义更清晰（"leader 独占什么"比"member 允许什么"更容易推理）。

---

### 决策 3：不修改 subprocess 后端路径

**选择**：本次变更仅修改 in-process 后端（`swarm/in_process.py`），不修改 subprocess/tmux 后端。

**理由**：subprocess/tmux 后端 spawn 独立进程，该进程有自己的 `create_default_tool_registry()` 调用，天然隔离。要限制其工具集需通过 `--disallowed-tools` CLI flag，是独立且更复杂的工作，不应与本次变更捆绑。

---

### LEADER_EXCLUSIVE_TOOLS 边界（完整清单）

以下工具仅限 leader 调用，member 工具注册表中将排除它们：

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

`team_create` / `team_delete` 是 team 模板管理工具，也归入 leader 专属（member 无需创建或删除团队）。

## Risks / Trade-offs
```

Full source: openspec/changes/dynamic-role-tool-registry/design.md

## openspec/changes/dynamic-role-tool-registry/tasks.md

- Source: openspec/changes/dynamic-role-tool-registry/tasks.md
- Lines: 1-20
- SHA256: a57a0890b8b4afed7446554945cd1b00622cb4702832f3fad568f15bc3a12708

```md
## 1. 工具集边界定义（tools/__init__.py）

- [ ] 1.1 在 `src/openharness/tools/__init__.py` 中添加 `LEADER_EXCLUSIVE_TOOLS: frozenset[str]` 常量，包含所有 leader 专属 `team_*` 工具名称（`team_create_run`、`team_spawn_member`、`team_list_members`、`team_wait`、`team_read_mailbox`、`team_send_message`、`team_shutdown_member`、`team_request_plan`、`team_review_plan`、`team_request_shutdown`、`team_create`、`team_delete`）
- [ ] 1.2 在 `src/openharness/tools/__init__.py` 中添加 `create_member_tool_registry(mcp_manager=None) -> ToolRegistry` 函数，从全量注册表中排除 `LEADER_EXCLUSIVE_TOOLS`
- [ ] 1.3 将 `create_member_tool_registry` 加入 `__all__` 导出列表

## 2. In-Process 后端接入（swarm/in_process.py）

- [ ] 2.1 在 `src/openharness/swarm/in_process.py` 的 `_build_member_query_context()` 函数中，将 `create_default_tool_registry()` 替换为 `create_member_tool_registry()`
- [ ] 2.2 更新对应的 import 语句，引入 `create_member_tool_registry`

## 3. 系统提示词简化（可选，降低提示词冗余）

- [ ] 3.1 在 `src/openharness/tools/team_spawn_member_tool.py` 的 `member_system` 字符串中，移除或精简"IMPORTANT — Do NOT call team coordination tools..."段落（因工具已从 API schema 层消失，文字禁令变为多余）

## 4. 验证

- [ ] 4.1 运行现有测试套件，确认无回归（`pytest tests/` 或项目对应的测试命令）
- [ ] 4.2 手动验证：启动一个 swarm team，检查 member session 的工具列表中不含 `team_spawn_member` 等 leader 专属工具
- [ ] 4.3 手动验证：确认 leader session 的工具列表完整，包含所有 `team_*` 协调工具
```

## openspec/changes/dynamic-role-tool-registry/specs/role-scoped-tool-registry/spec.md

- Source: openspec/changes/dynamic-role-tool-registry/specs/role-scoped-tool-registry/spec.md
- Lines: 1-43
- SHA256: db919c153edc29b931f9d61b20f696defc7bd3bac9ee48285d58138b82f0d3ba

```md
## ADDED Requirements

### Requirement: Leader 工具注册表包含全量工具集
系统 SHALL 为 leader session 提供包含所有已注册工具（含全部 `team_*` 协调工具）的工具注册表。`create_default_tool_registry()` 继续作为 leader 的工具来源，不做任何削减。

#### Scenario: Leader session 可调用所有协调工具
- **WHEN** leader session 通过 `SwarmService.start_team()` 或 `SwarmService.create_team_with_agent()` 创建
- **THEN** 其工具注册表包含 `team_spawn_member`、`team_wait`、`team_read_mailbox`、`team_request_plan`、`team_review_plan`、`team_request_shutdown` 等所有协调工具

---

### Requirement: Member 工具注册表排除 Leader 专属工具
系统 SHALL 为 member session（in-process 后端）提供排除 `LEADER_EXCLUSIVE_TOOLS` 后的受限工具注册表。member 的工具注册表中 SHALL NOT 出现任何 leader 专属 `team_*` 协调工具。

#### Scenario: Member session 无法调用 leader 专属协调工具
- **WHEN** member 通过 `TeamSpawnMemberTool` 以 in-process 模式启动
- **THEN** 其工具注册表不包含 `team_spawn_member`、`team_wait`、`team_read_mailbox`、`team_request_plan`、`team_review_plan`、`team_request_shutdown`、`team_create_run`、`team_list_members`、`team_shutdown_member`、`team_send_message`、`team_create`、`team_delete`

#### Scenario: Member session 保留全部基础工具
- **WHEN** member 通过 `TeamSpawnMemberTool` 以 in-process 模式启动
- **THEN** 其工具注册表仍包含 `bash`、`file_read`、`file_edit`、`file_write`、`glob`、`grep`、`web_fetch`、`web_search`、`agent`、`skill`、`todo_write` 等所有非协调工具

---

### Requirement: LEADER_EXCLUSIVE_TOOLS 作为工具集划分的单一数据源
`tools/__init__.py` SHALL 导出 `LEADER_EXCLUSIVE_TOOLS: frozenset[str]` 常量，作为 leader 专属工具名称集合的唯一来源。任何需要区分 leader/member 工具集的代码 SHALL 引用此常量，而不是各自维护独立的排除列表。

#### Scenario: LEADER_EXCLUSIVE_TOOLS 覆盖所有 team_* 协调工具
- **WHEN** 检查 `LEADER_EXCLUSIVE_TOOLS` 的内容
- **THEN** 其中包含且仅包含需要 leader 权限的 `team_*` 工具名称（至少包括 `team_create_run`、`team_spawn_member`、`team_list_members`、`team_wait`、`team_read_mailbox`、`team_send_message`、`team_shutdown_member`、`team_request_plan`、`team_review_plan`、`team_request_shutdown`、`team_create`、`team_delete`）

---

### Requirement: create_member_tool_registry() 工厂函数
`tools/__init__.py` SHALL 提供 `create_member_tool_registry(mcp_manager=None) -> ToolRegistry` 函数，返回排除 `LEADER_EXCLUSIVE_TOOLS` 后的工具注册表。

#### Scenario: 工厂函数返回正确的受限注册表
- **WHEN** 调用 `create_member_tool_registry()`
- **THEN** 返回的 `ToolRegistry` 中所有工具名均不在 `LEADER_EXCLUSIVE_TOOLS` 集合中

#### Scenario: MCP 工具正常传递给 member
- **WHEN** 调用 `create_member_tool_registry(mcp_manager=some_manager)`
- **THEN** 返回的 `ToolRegistry` 中包含 MCP 工具（MCP 工具不在 `LEADER_EXCLUSIVE_TOOLS` 中）
```

