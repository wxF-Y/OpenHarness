## MODIFIED Requirements

### Requirement: Gateway 支持完整会话管理 REST API
Gateway SHALL 提供以下 REST 端点管理 Agent 会话：
- `POST /api/sessions` — 创建新会话，支持传递 `model`、`cwd`（可选，未传则自动分配托管目录）、`permission_mode`、`system_prompt`、`max_turns` 参数；若 `cwd` 指向不存在路径或非目录，返回 422
- `GET /api/sessions/{session_id}` — 获取会话当前完整 AppState（含 model、provider、auth_status、cwd、fast_mode、plan_mode 等）
- `DELETE /api/sessions/{session_id}` — 关闭会话并清理资源；若该会话使用托管 cwd（位于 `~/.hlagent/workspaces/` 下），一并递归删除该目录；**同时删除 `~/.openharness/data/sessions/` 下对应的持久化快照文件（`session-<internal-id>.json` 及 `latest.json`（若其指向同一 session））**
- `GET /api/sessions/{session_id}/commands` — 获取该会话可用的命令列表

#### Scenario: 创建新会话（带参数）
- **WHEN** 客户端发送 `POST /api/sessions`，body 为 `{"model": "claude-sonnet-4-6", "cwd": "/home/user/project"}`
- **THEN** 返回 HTTP 201，body 包含 `{"session_id": "<uuid>", "status": "ready"}`，Gateway 内部用指定参数初始化 Agent 运行时

#### Scenario: 创建会话时未指定 cwd
- **WHEN** 客户端发送 `POST /api/sessions`，body 不含 `cwd` 字段
- **THEN** 返回 HTTP 201；`cwd` 自动设为新建的 `~/.hlagent/workspaces/<session_id>/`；响应中的 `cwd` 字段反映该路径

#### Scenario: 查询会话完整状态
- **WHEN** 客户端发送 `GET /api/sessions/{session_id}`（session 存在）
- **THEN** 返回 HTTP 200，body 包含完整 AppState 快照，含 model、provider、auth_status、cwd、vim_enabled、fast_mode、effort、passes、mcp_connected、mcp_failed、bridge_sessions、output_style

#### Scenario: 删除会话触发托管目录清理
- **WHEN** 客户端发送 `DELETE /api/sessions/{id}`，该会话 cwd 在 `~/.hlagent/workspaces/` 下
- **THEN** 返回 HTTP 204；对应 workspaces 子目录已递归删除

#### Scenario: 删除会话不清理用户自定义目录
- **WHEN** 客户端发送 `DELETE /api/sessions/{id}`，该会话 cwd 为用户指定路径
- **THEN** 返回 HTTP 204；用户指定的 cwd 目录不受影响

#### Scenario: 删除会话时清理持久化快照文件
- **WHEN** 客户端发送 `DELETE /api/sessions/{id}`，且 host 已就绪（internal session_id 可获取）
- **THEN** 返回 HTTP 204；`~/.openharness/data/sessions/` 下对应的 `session-<internal-id>.json` 被删除；若 `latest.json` 指向同一 session，也一并删除

#### Scenario: host 未就绪时删除会话不报错
- **WHEN** 客户端发送 `DELETE /api/sessions/{id}`，但 host 尚未完成初始化（`get_session_id()` 返回 None）
- **THEN** 返回 HTTP 204；跳过快照文件删除，不报错

#### Scenario: 获取命令列表
- **WHEN** 客户端发送 `GET /api/sessions/{session_id}/commands`
- **THEN** 返回 HTTP 200，body 包含命令名称数组（如 `["/help", "/memory", "/compact"]`）

#### Scenario: 查询不存在的会话
- **WHEN** 客户端发送 `GET /api/sessions/{invalid_id}`
- **THEN** 返回 HTTP 404，body 包含错误信息
