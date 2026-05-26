## ADDED Requirements

### Requirement: 所有团队工具使用 team_ 前缀

系统 SHALL 将所有与 Swarm/Team 相关的 Agent 工具以 `team_` 为前缀命名，包括：`team_create_run`、`team_list_members`、`team_send_message`、`team_shutdown_member`、`team_spawn_member`、`team_wait`、`team_read_mailbox`。原有的 `team_create` 和 `team_delete` 保持不变。

#### Scenario: Agent 调用团队工具

- **WHEN** Agent 通过工具名 `team_create_run` 创建任务运行
- **THEN** 系统成功执行，返回 `run_id`，功能与原 `swarm_create_run` 完全相同

#### Scenario: 旧工具名不再注册

- **WHEN** Agent 尝试调用 `swarm_create_run`（旧名）
- **THEN** 系统返回"未知工具"错误，因为该工具名不再注册

#### Scenario: read_mailbox 迁移到 team_read_mailbox

- **WHEN** Agent 通过 `team_read_mailbox` 读取 Leader 收件箱
- **THEN** 系统返回该 run 的未读消息列表，功能与原 `read_mailbox` 完全相同

### Requirement: 工具文件命名与 tool.name 字段同步

系统 SHALL 保持工具文件名（`team_*_tool.py`）与工具类中 `name` 字段（`team_*`）一致。

#### Scenario: 工具文件名与注册名匹配

- **WHEN** 开发者查看 `src/openharness/tools/` 目录
- **THEN** 每个 `team_*_tool.py` 文件中的 `BaseTool.name` 字段以 `team_` 开头，无 `swarm_` 前缀文件

### Requirement: Leader 系统提示词反映新工具名

系统 SHALL 在 `swarm_service.py` 的 `_LEADER_SYSTEM_PROMPT_TEMPLATE` 中使用 `team_*` 工具名。

#### Scenario: Leader 使用正确工具名编排任务

- **WHEN** Leader Agent 初始化并读取系统提示词
- **THEN** 提示词中的工具表格列出 `team_create_run`、`team_spawn_member` 等 `team_*` 名称，不含 `swarm_*`
