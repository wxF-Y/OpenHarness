## MODIFIED Requirements

### Requirement: Gateway 支持完整会话管理 REST API
Gateway SHALL 提供以下 REST 端点管理 Agent 会话：
- `POST /api/sessions` — 创建新会话，支持传递 `model`、`cwd`（可选，未传则自动分配托管目录）、`permission_mode`、`system_prompt`、`max_turns`、`role_prefix`（专家角色前缀，注入为系统提示词前缀）、`expert_role`（专家角色机器名，可选）、`expert_role_label`（专家角色中文描述，可选）参数；若 `cwd` 指向不存在路径或非目录，返回 422
- `GET /api/sessions` — 获取所有会话列表，每条记录含 `expert_role` 字段（null 表示普通对话）和 `expert_role_label` 字段（专家角色的人类可读描述）
- `GET /api/sessions/{session_id}` — 获取会话当前完整 AppState（含 model、provider、auth_status、cwd、fast_mode、plan_mode、`expert_role` 等）
- `DELETE /api/sessions/{session_id}` — 关闭会话并清理资源；若该会话使用托管 cwd（位于 `~/.hlagent/workspaces/` 下），一并递归删除该目录；**同时删除 `~/.openharness/data/sessions/` 下对应的持久化快照文件（`session-<internal-id>.json` 及 `latest.json`（若其指向同一 session））**
- `GET /api/sessions/{session_id}/commands` — 获取该会话可用的命令列表

#### Scenario: 创建新会话（带参数）
- **WHEN** 客户端发送 `POST /api/sessions`，body 为 `{"model": "claude-sonnet-4-6", "cwd": "/home/user/project"}`
- **THEN** 返回 HTTP 201，body 包含 `{"session_id": "<uuid>", "status": "ready"}`，Gateway 内部用指定参数初始化 Agent 运行时

#### Scenario: 创建会话时未指定 cwd
- **WHEN** 客户端发送 `POST /api/sessions`，body 不含 `cwd` 字段
- **THEN** 返回 HTTP 201；`cwd` 自动设为新建的 `~/.hlagent/workspaces/<session_id>/`；响应中的 `cwd` 字段反映该路径

#### Scenario: 创建专家对话时携带 expert_role 和 expert_role_label
- **WHEN** 客户端发送 `POST /api/sessions`，body 含 `{"role_prefix": "...", "expert_role": "frontend-developer", "expert_role_label": "前端开发工程师"}`
- **THEN** 返回 HTTP 201，响应 body 中 `expert_role` 字段值为 `"frontend-developer"`，`expert_role_label` 字段值为 `"前端开发工程师"`；Session 以 role_prefix 内容作为系统提示词前缀初始化

#### Scenario: 获取 Session 列表时返回 expert_role 和 expert_role_label 字段
- **WHEN** 客户端发送 `GET /api/sessions`
- **THEN** 响应数组中每条 SessionSummary 均含 `expert_role` 和 `expert_role_label` 字段；普通对话两者均为 null，专家对话分别为机器名和中文描述

#### Scenario: 查询会话完整状态
- **WHEN** 客户端发送 `GET /api/sessions/{session_id}`（session 存在）
- **THEN** 返回 HTTP 200，body 包含完整 AppState 快照，含 model、provider、auth_status、cwd、vim_enabled、fast_mode、effort、passes、mcp_connected、mcp_failed、bridge_sessions、output_style

#### Scenario: 删除会话触发托管目录清理
- **WHEN** 客户端发送 `DELETE /api/sessions/{id}`，该会话 cwd 在 `~/.hlagent/workspaces/` 下
- **THEN** 返回 HTTP 204；对应 workspaces 子目录已递归删除

#### Scenario: 删除会话不清理用户自定义目录
- **WHEN** 客户端发送 `DELETE /api/sessions/{id}`，该会话 cwd 为用户指定路径
- **THEN** 返回 HTTP 204；用户指定的 cwd 目录不受影响
