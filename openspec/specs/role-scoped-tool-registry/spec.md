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
