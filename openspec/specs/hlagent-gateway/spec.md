## ADDED Requirements

### Requirement: Gateway 提供 Onboarding 状态检查端点
Gateway SHALL 提供专用的 Onboarding 状态检查端点，一次性返回 Web UI 向导所需的所有初始化状态信息，避免前端多次请求。

#### Scenario: 首次运行无 API Key
- **WHEN** 客户端发送 `GET /api/onboarding/status`，系统未配置任何 API Key
- **THEN** 返回 HTTP 200，body 含 `{"auth_configured": false, "auth_status": "missing", "active_profile": "claude-api", "cwd": "/path/to/cwd", "project_initialized": false, "version": "x.x.x"}`

#### Scenario: 已配置 API Key 的状态
- **WHEN** 客户端发送 `GET /api/onboarding/status`，API Key 已存储
- **THEN** 返回 HTTP 200，body 含 `{"auth_configured": true, "auth_status": "configured", "active_profile": "claude-api", "cwd": "...", "project_initialized": true}`

#### Scenario: project_initialized 判断逻辑
- **WHEN** 当前 cwd 下 `CLAUDE.md` 文件存在或 `.openharness/` 目录存在
- **THEN** `project_initialized: true`；否则 `false`

### Requirement: Gateway 提供项目初始化端点
Gateway SHALL 提供独立的项目初始化 REST 端点，不需要创建 Agent 会话或 WebSocket 连接，直接在当前 cwd 创建 CLAUDE.md 和 .openharness/ 目录结构。

#### Scenario: 初始化未初始化的项目
- **WHEN** 客户端发送 `POST /api/onboarding/init-project`（可选 body `{"cwd": "..."}` 覆盖默认 cwd）
- **THEN** 返回 HTTP 201，body 含 `{"created": ["CLAUDE.md", ".openharness/memory/MEMORY.md", ...]}` 创建的文件列表

#### Scenario: 项目已初始化时幂等执行
- **WHEN** 客户端发送 `POST /api/onboarding/init-project`，CLAUDE.md 已存在
- **THEN** 返回 HTTP 200，body 含 `{"created": [], "message": "Project already initialized"}` — 幂等，不报错

### Requirement: Gateway 提供认证管理 REST API（API Key 存储，不验证有效性）
Gateway SHALL 提供查询认证状态和存储 API Key 的端点。**重要约束：`POST /api/auth/login` 仅存储凭据，不测试 API 连通性；有效性在首次 Agent 会话启动时自然验证。**

#### Scenario: 查询认证状态
- **WHEN** 客户端发送 `GET /api/auth/status`
- **THEN** 返回 HTTP 200，body 含 `{"auth_status": "configured"/"missing", "active_profile": "...", "providers": {...}}` 从 `auth_status(settings)` 和 `AuthManager.get_auth_status()` 聚合

#### Scenario: 存储 API Key（仅存储，不验证）
- **WHEN** 客户端发送 `POST /api/auth/login`，body `{"provider": "anthropic", "api_key": "sk-ant-..."}`
- **THEN** 返回 HTTP 200，调用 `AuthManager.store_profile_credential(profile_name, "api_key", api_key)` 存储到文件；**不发起 API 测试请求**；body 含 `{"status": "stored", "message": "API Key 已保存，将在首次对话时验证有效性"}`

#### Scenario: 存储失败（文件系统错误等）
- **WHEN** `POST /api/auth/login` 因文件权限等原因写入失败
- **THEN** 返回 HTTP 500，body 含错误描述

#### Scenario: 清除凭据
- **WHEN** 客户端发送 `DELETE /api/auth`，body `{"provider": "anthropic"}`
- **THEN** 返回 HTTP 204，清除对应 provider 的存储凭据

### Requirement: Gateway 提供健康检查端点
Gateway SHALL 在 `GET /health` 暴露健康检查端点，返回服务状态和版本信息。

#### Scenario: 服务正常运行时健康检查
- **WHEN** 客户端发送 `GET /health`
- **THEN** 返回 HTTP 200，body 包含 `{"status": "ok", "version": "x.x.x"}`

### Requirement: Gateway 支持完整会话管理 REST API
Gateway SHALL 提供以下 REST 端点管理 Agent 会话：
- `POST /api/sessions` — 创建新会话，支持传递 `model`、`cwd`（可选，未传则自动分配托管目录）、`permission_mode`、`system_prompt`、`max_turns` 参数；若 `cwd` 指向不存在路径或非目录，返回 422
- `GET /api/sessions/{session_id}` — 获取会话当前完整 AppState（含 model、provider、auth_status、cwd、fast_mode、plan_mode 等）
- `DELETE /api/sessions/{session_id}` — 关闭会话并清理资源；若该会话使用托管 cwd（位于 `~/.hlagent/workspaces/` 下），一并递归删除该目录
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

#### Scenario: 获取命令列表
- **WHEN** 客户端发送 `GET /api/sessions/{session_id}/commands`
- **THEN** 返回 HTTP 200，body 包含命令名称数组（如 `["/help", "/memory", "/compact"]`）

#### Scenario: 查询不存在的会话
- **WHEN** 客户端发送 `GET /api/sessions/{invalid_id}`
- **THEN** 返回 HTTP 404，body 包含错误信息

### Requirement: Gateway 通过 WebSocket 支持全部 FrontendRequest 类型
Gateway SHALL 处理 `FrontendRequest` 的全部 8 种类型并路由到正确的 SDK 行为：`submit_line`、`interrupt`、`permission_response`、`question_response`、`select_command`、`apply_select_command`、`list_sessions`、`shutdown`。

#### Scenario: 用户提交输入
- **WHEN** 客户端发送 `{"type": "submit_line", "line": "帮我列出当前目录文件"}`
- **THEN** Gateway 调用 SDK，依次推送 transcript_item、tool_started、tool_completed、assistant_delta、assistant_complete 等事件流

#### Scenario: 发送中断指令
- **WHEN** 客户端发送 `{"type": "interrupt"}`
- **THEN** Gateway 通知 SDK 中断当前 Agent 执行，推送 `line_complete` 事件

#### Scenario: 权限请求响应
- **WHEN** 客户端发送 `{"type": "permission_response", "request_id": "xxx", "allowed": true}`
- **THEN** Gateway 解析 request_id，resolve 对应的 asyncio Future，Agent 继续执行

#### Scenario: 问题应答响应
- **WHEN** 客户端发送 `{"type": "question_response", "request_id": "xxx", "answer": "yes"}`
- **THEN** Gateway 解析 request_id，resolve 对应的 asyncio Future（问题应答），Agent 继续执行

#### Scenario: 命令选择（CommandPalette）
- **WHEN** 客户端发送 `{"type": "select_command", "command": "/compact"}`
- **THEN** Gateway 将命令路由到 SDK handle_line，执行对应命令逻辑

#### Scenario: 选项确认（SelectModal 如模型切换）
- **WHEN** 客户端发送 `{"type": "apply_select_command", "command": "model", "value": "claude-opus-4-7"}`
- **THEN** Gateway 更新 Agent 运行时使用的模型，推送 `state_snapshot` 反映变更

#### Scenario: 会话列表刷新
- **WHEN** 客户端发送 `{"type": "list_sessions"}`
- **THEN** Gateway 推送可用会话列表（从 SessionBackend 查询）

#### Scenario: 关闭会话
- **WHEN** 客户端发送 `{"type": "shutdown"}`
- **THEN** Gateway 推送 `BackendEvent(type="shutdown")`，关闭 WebSocket 连接，清理运行时

#### Scenario: WebSocket 连接到不存在的会话
- **WHEN** 客户端连接 `ws://localhost:8000/ws/{invalid_id}`
- **THEN** Gateway 关闭连接，返回关闭码 4004（Session Not Found）

### Requirement: Gateway 推送全部 BackendEvent 类型
Gateway SHALL 将 SDK 产生的所有 18 种 `BackendEvent` 类型完整转发给 WebSocket 客户端，不丢失任何字段（含 `compact_progress`、`modal_request`、`select_request`、`todo_update`、`plan_mode_change`、`swarm_status`、`error`、`shutdown`）。

#### Scenario: 推送上下文压缩进度
- **WHEN** Agent 触发上下文压缩（compact）
- **THEN** Gateway 推送 `compact_progress` 事件，含 `compact_phase`、`attempt`、`compact_checkpoint`、`compact_metadata` 字段

#### Scenario: 推送问题弹窗请求
- **WHEN** Agent 需要向用户提问
- **THEN** Gateway 推送 `modal_request(kind="question")`，含 `request_id` 和 `question` 字段

#### Scenario: 推送选项选择请求
- **WHEN** Agent 或命令触发选项选择（如模型切换）
- **THEN** Gateway 推送 `select_request`，含 `select_options` 数组和 `modal.title/command`

#### Scenario: 推送 Todo 更新
- **WHEN** Agent 更新任务列表（todo_markdown）
- **THEN** Gateway 推送 `todo_update`，含 `todo_markdown` 字段（Markdown 格式）

#### Scenario: 推送计划模式变更
- **WHEN** Agent 进入或退出 Plan Mode
- **THEN** Gateway 推送 `plan_mode_change`，含 `plan_mode` 字段（"plan" 或 "default"）

#### Scenario: 推送 Swarm 状态更新
- **WHEN** Swarm 中有 agent 状态变更
- **THEN** Gateway 推送 `swarm_status`，含 `swarm_teammates` 数组（每个成员含 id、name、status）和 `swarm_notifications` 数组

#### Scenario: 推送错误事件
- **WHEN** Agent 运行时发生错误
- **THEN** Gateway 推送 `error` 事件，含 `message` 字段描述错误原因

#### Scenario: 推送关闭事件
- **WHEN** 会话正常关闭
- **THEN** Gateway 推送 `shutdown` 事件后关闭 WebSocket 连接

### Requirement: Gateway 支持 CORS 跨域
Gateway SHALL 配置 CORS，允许本地开发时 Web UI（默认 `http://localhost:5173`）跨域访问。

#### Scenario: Web UI 跨域请求
- **WHEN** 运行在 `localhost:5173` 的 Web UI 发起 CORS 请求
- **THEN** Gateway 返回正确的 `Access-Control-Allow-Origin` 头，请求不被浏览器拦截

### Requirement: Gateway 提供定时任务（Cron）CRUD REST API
Gateway SHALL 直接调用 openharness cron 服务层，提供 Cron job 的增删查改接口，不依赖 Agent 会话。

#### Scenario: 列出所有 cron job
- **WHEN** 客户端发送 `GET /api/cron/jobs`
- **THEN** 返回 HTTP 200，body 为 `CronJob[]` 数组，含 name/schedule/enabled/last_run/next_run/last_status 字段

#### Scenario: 创建/更新 cron job
- **WHEN** 客户端发送 `POST /api/cron/jobs`，body 含 name、schedule（如 `"0 9 * * 1-5"`）、message 或 command、可选 timezone/payload/notify/cwd
- **THEN** 返回 HTTP 201，body 含新建 job 信息；若 name 已存在则更新（upsert 语义）

#### Scenario: 无效 cron 表达式
- **WHEN** 客户端发送 `POST /api/cron/jobs`，schedule 为非法表达式（如 `"* * * *"`，只有4字段）
- **THEN** 返回 HTTP 422，body 含错误说明 "Invalid cron expression"

#### Scenario: 删除 cron job
- **WHEN** 客户端发送 `DELETE /api/cron/jobs/{name}`（job 存在）
- **THEN** 返回 HTTP 204，job 从 registry 中移除

#### Scenario: 切换 job 启用/禁用
- **WHEN** 客户端发送 `PATCH /api/cron/jobs/{name}/toggle`，body `{"enabled": false}`
- **THEN** 返回 HTTP 200，job 的 enabled 字段更新；调度器在下次 tick 前不会执行该 job

#### Scenario: 查询 job 执行历史
- **WHEN** 客户端发送 `GET /api/cron/jobs/{name}/history`
- **THEN** 返回 HTTP 200，body 为最近 50 条执行记录，含 started_at、ended_at、status（success/error）、output 摘要

#### Scenario: 查询调度器状态
- **WHEN** 客户端发送 `GET /api/cron/scheduler/status`
- **THEN** 返回 HTTP 200，body 含 `{"running": true/false, "tick_interval_seconds": 30}`

### Requirement: Gateway 提供 Swarm 团队协作完整 REST API
Gateway SHALL 通过 openharness swarm 服务层提供完整的团队管理接口，包括团队 CRUD、成员详情、agent 内容查看、Mailbox 消息管理（含 permission 审批）。

#### Scenario: 列出所有团队（含摘要信息）
- **WHEN** 客户端发送 `GET /api/swarm/teams`
- **THEN** 返回 HTTP 200，body 为团队摘要数组，每项含 `{name, description, created_at, member_count, lead_agent_id, active_count}`

#### Scenario: 获取团队完整详情（含所有成员）
- **WHEN** 客户端发送 `GET /api/swarm/teams/{team}`
- **THEN** 返回 HTTP 200，body 为完整 TeamFile JSON：`{name, description, lead_agent_id, lead_session_id, members: {agentId: TeamMember}, team_allowed_paths, created_at}`；TeamMember 含完整字段（agent_id/name/agent_type/model/color/status/session_id/worktree_path/permissions/subscriptions/plan_mode_required/backend_type/cwd/is_active）

#### Scenario: 创建新团队
- **WHEN** 客户端发送 `POST /api/swarm/teams`，body `{"name": "feature-team", "description": "功能开发团队"}`
- **THEN** 返回 HTTP 201，调用 `TeamLifecycleManager.create_team()`，返回新建 TeamFile JSON

#### Scenario: 删除团队
- **WHEN** 客户端发送 `DELETE /api/swarm/teams/{team}`
- **THEN** 返回 HTTP 204，删除团队目录（`~/.openharness/teams/{team}/`）

#### Scenario: 获取单个成员详情
- **WHEN** 客户端发送 `GET /api/swarm/teams/{team}/members/{agent_id}`
- **THEN** 返回 HTTP 200，body 为完整 TeamMember JSON

#### Scenario: 生成 teammate（spawn）
- **WHEN** 客户端发送 `POST /api/sessions/{session_id}/spawn`，body 含 name、team、prompt、model（可选）、permissions（可选）、plan_mode_required（可选）、color（可选）、worktree_path（可选）
- **THEN** 返回 HTTP 201，body 含 `{"task_id": "...", "agent_id": "name@team", "backend_type": "in_process"}`

#### Scenario: 获取 agent 的对话内容（transcript）
- **WHEN** 客户端发送 `GET /api/swarm/agents/{agent_id}/transcript`（需要 agent 的 session_id 字段不为空）
- **THEN** 从 TeamMember.session_id 找到对应 SessionBackend 记录，返回 HTTP 200，body 含 Markdown 格式 transcript；若 session_id 为空则返回 HTTP 404

#### Scenario: 向 teammate 发送用户消息
- **WHEN** 客户端发送 `POST /api/swarm/agents/{agent_id}/message`，body `{"text": "请检查 PR #123", "sender": "leader"}`
- **THEN** 返回 HTTP 200，调用 `create_user_message()` 写入 agent mailbox

#### Scenario: 关闭 teammate
- **WHEN** 客户端发送 `DELETE /api/swarm/agents/{agent_id}`
- **THEN** 返回 HTTP 204，调用 `create_shutdown_request()` 写入 mailbox

#### Scenario: 读取 agent mailbox 全部消息
- **WHEN** 客户端发送 `GET /api/swarm/agents/{agent_id}/messages?unread_only=false`
- **THEN** 返回 HTTP 200，body 为 `MailboxMessage[]` 数组（含 id/type/sender/recipient/payload/timestamp/read）；type 枚举：user_message/permission_request/permission_response/sandbox_permission_request/sandbox_permission_response/shutdown/idle_notification

#### Scenario: 标记消息为已读
- **WHEN** 客户端发送 `PATCH /api/swarm/agents/{agent_id}/messages/{message_id}/read`
- **THEN** 返回 HTTP 200，调用 `TeammateMailbox.mark_read(message_id)`

#### Scenario: Leader 批准 Worker 权限请求
- **WHEN** 客户端发送 `POST /api/swarm/agents/{worker_agent_id}/permission-response`，body `{"request_id": "...", "approved": true, "permission_updates": [...]}`
- **THEN** 返回 HTTP 200，调用 `create_permission_response_message()` 将批准消息写入 worker 的 mailbox

#### Scenario: Leader 拒绝 Worker 权限请求
- **WHEN** 客户端发送 `POST /api/swarm/agents/{worker_agent_id}/permission-response`，body `{"request_id": "...", "approved": false, "error": "Permission denied by user"}`
- **THEN** 返回 HTTP 200，调用 `create_permission_response_message(subtype="error")` 写入 worker mailbox

#### Scenario: 获取所有 agent 的待处理 Permission 请求（Leader 视角）
- **WHEN** 客户端发送 `GET /api/swarm/teams/{team}/pending-permissions`
- **THEN** 返回 HTTP 200，body 为待处理 permission_request 数组（from leader mailbox），每项含 sender/request_id/tool_name/description/input

### Requirement: Gateway 提供权限模式管理 REST API
Gateway SHALL 提供读取和切换 Agent 会话权限模式的端点。

#### Scenario: 获取当前权限模式
- **WHEN** 客户端发送 `GET /api/sessions/{session_id}/permission-mode`
- **THEN** 返回 HTTP 200，body 含 `{"mode": "default", "path_rules": [...]}`（三种模式：default/plan/full_auto）

#### Scenario: 切换权限模式
- **WHEN** 客户端发送 `POST /api/sessions/{session_id}/permission-mode`，body `{"mode": "plan"}`
- **THEN** 返回 HTTP 200，Gateway 更新 Agent 运行时权限设置，推送 WebSocket `state_snapshot` 和 `plan_mode_change` 事件

### Requirement: Gateway 提供 Memory 文件管理 REST API
Gateway SHALL 直接操作 openharness memory 文件系统，支持读取、创建、删除 memory 条目和触发 dream 整合，不依赖 Agent 会话。

#### Scenario: 列出 memory 文件
- **WHEN** 客户端发送 `GET /api/memory/files`（可选 `?cwd=...` 参数）
- **THEN** 返回 HTTP 200，body 为文件路径数组（`list_memory_files(cwd)` 输出）

#### Scenario: 读取 memory 文件
- **WHEN** 客户端发送 `GET /api/memory/{filename}`
- **THEN** 返回 HTTP 200，body 含 `{"filename": "...", "content": "...", "path": "..."}`

#### Scenario: 添加 memory 条目
- **WHEN** 客户端发送 `POST /api/memory`，body `{"title": "用户偏好", "content": "喜欢深色主题"}`
- **THEN** 返回 HTTP 201，创建新 memory 文件（`add_memory_entry(cwd, title, content)`）

#### Scenario: 删除 memory 条目
- **WHEN** 客户端发送 `DELETE /api/memory/{filename}`
- **THEN** 返回 HTTP 204，文件从 memory 目录移除（`remove_memory_entry(cwd, name)`）

#### Scenario: 触发 memory 整合（dream）
- **WHEN** 客户端发送 `POST /api/memory/dream`
- **THEN** 启动后台整合任务，返回 HTTP 202；整合完成后 memory 文件合并优化

### Requirement: Gateway 提供 Session 扩展 REST API
Gateway SHALL 提供 session 历史列表、导出、回退等操作，对应 /resume、/export、/rewind、/tag 命令。

#### Scenario: 列出所有已保存会话
- **WHEN** 客户端发送 `GET /api/sessions`（无参数）
- **THEN** 返回 HTTP 200，body 为会话摘要数组（含 session_id、created_at、cwd、model、message 数量），供 /resume 使用

#### Scenario: 获取 session 的 system prompt
- **WHEN** 客户端发送 `GET /api/sessions/{id}/context`
- **THEN** 返回 HTTP 200，body 含 `{"system_prompt": "..."}` 当前有效系统提示词

#### Scenario: 获取对话摘要
- **WHEN** 客户端发送 `GET /api/sessions/{id}/summary?max_messages=8`
- **THEN** 返回 HTTP 200，body 含 `{"summary": "..."}` 对话摘要文本

#### Scenario: 导出完整 transcript
- **WHEN** 客户端发送 `GET /api/sessions/{id}/transcript?format=markdown`
- **THEN** 返回 HTTP 200，body 含 Markdown 或 JSON 格式的完整对话记录

#### Scenario: 回退最后一轮 (/rewind)
- **WHEN** 客户端发送 `DELETE /api/sessions/{id}/messages/last`
- **THEN** 返回 HTTP 200，移除最后一次 user + assistant 消息对，body 含新的消息数量

#### Scenario: 创建命名快照 (/tag)
- **WHEN** 客户端发送 `POST /api/sessions/{id}/tag`，body `{"name": "v1-stable"}`
- **THEN** 返回 HTTP 201，session 创建命名快照，body 含 `{"tag_id": "...", "name": "v1-stable"}`

### Requirement: Gateway 提供认证管理 REST API
Gateway SHALL 提供查询认证状态、登录（存储 API key）、登出（清除凭据）的端点。

#### Scenario: 查询所有 provider 认证状态
- **WHEN** 客户端发送 `GET /api/auth/status`
- **THEN** 返回 HTTP 200，body 含当前 provider、auth_status（ok/missing/invalid）、base_url、可用 provider 列表

#### Scenario: 存储 API Key（登录）
- **WHEN** 客户端发送 `POST /api/auth/login`，body `{"provider": "anthropic", "api_key": "sk-ant-..."}`
- **THEN** 返回 HTTP 200，API key 存储到 credential store，重建 API client；若 key 无效返回 HTTP 401

#### Scenario: 清除凭据（登出）
- **WHEN** 客户端发送 `DELETE /api/auth`，body `{"provider": "anthropic"}`
- **THEN** 返回 HTTP 204，对应 provider 的 credential 清除

### Requirement: Gateway 提供配置读取/更新 REST API
Gateway SHALL 提供读取有效配置和更新运行时设置的端点，对应 /config、/fast、/effort、/passes、/turns、/vim、/voice 命令。

#### Scenario: 读取当前配置
- **WHEN** 客户端发送 `GET /api/settings`
- **THEN** 返回 HTTP 200，body 含有效 settings 快照（model/provider/fast_mode/effort/passes/turns/vim_mode/voice_mode/output_style/theme）

#### Scenario: 更新配置字段
- **WHEN** 客户端发送 `PATCH /api/settings`，body `{"fast_mode": true, "effort": "high"}`
- **THEN** 返回 HTTP 200，settings 更新并持久化；若有活跃会话，推送 `state_snapshot` 反映变更

#### Scenario: 列出 Provider Profiles
- **WHEN** 客户端发送 `GET /api/settings/profiles`
- **THEN** 返回 HTTP 200，body 为 profile 数组（含 name/provider/model/auth_source/allowed_models）

### Requirement: Gateway 提供 MCP 服务器状态 REST API
Gateway SHALL 在无 Agent 会话时也能提供 MCP 服务器配置列表。

#### Scenario: 列出 MCP 服务器
- **WHEN** 客户端发送 `GET /api/mcp/servers`
- **THEN** 返回 HTTP 200，body 为 MCP server 数组（name/state/transport/auth_configured/tool_count/resource_count/detail）

### Requirement: Gateway 提供 Skills 和 Plugins 列表 REST API
Gateway SHALL 提供 skill 和 plugin 的发现端点，无需 Agent 会话。

#### Scenario: 列出可用 Skills
- **WHEN** 客户端发送 `GET /api/skills`
- **THEN** 返回 HTTP 200，body 为 skill 数组（name/description/tags/user_invocable）

#### Scenario: 读取 Skill 内容
- **WHEN** 客户端发送 `GET /api/skills/{name}`
- **THEN** 返回 HTTP 200，body 含 skill 的 Markdown 内容

#### Scenario: 列出已安装 Plugins
- **WHEN** 客户端发送 `GET /api/plugins`
- **THEN** 返回 HTTP 200，body 为 plugin 数组（name/enabled/description/commands_count/tools_count）

### Requirement: Gateway 提供 Background Tasks REST API
Gateway SHALL 通过 openharness task manager 提供背景任务的列表、查询和停止接口，对应 /tasks、/agents 命令。

#### Scenario: 列出所有背景任务
- **WHEN** 客户端发送 `GET /api/tasks`
- **THEN** 返回 HTTP 200，body 为 task 数组（id/type/status/description/metadata），含 subagent 任务和 shell 任务

#### Scenario: 获取任务输出
- **WHEN** 客户端发送 `GET /api/tasks/{id}`
- **THEN** 返回 HTTP 200，body 含 task 状态、输出文件路径和输出内容摘要

#### Scenario: 停止运行中的任务
- **WHEN** 客户端发送 `DELETE /api/tasks/{id}`
- **THEN** 返回 HTTP 204，任务被中止（cancel asyncio task）

### Requirement: Gateway 提供 Git 集成 REST API
Gateway SHALL 提供 git diff/branch/commit 操作，对应 /diff、/branch、/commit 命令，直接通过 subprocess 执行 git。

#### Scenario: 获取 git diff
- **WHEN** 客户端发送 `GET /api/git/diff?cwd=...`
- **THEN** 返回 HTTP 200，body 含 diff 文本（`git diff` 输出）

#### Scenario: 获取分支信息
- **WHEN** 客户端发送 `GET /api/git/branch?cwd=...`
- **THEN** 返回 HTTP 200，body 含当前分支名、ahead/behind 信息

#### Scenario: 目录不是 git 仓库
- **WHEN** 客户端发送 `GET /api/git/diff`，cwd 不是 git 仓库
- **THEN** 返回 HTTP 422，body 含 "Not a git repository" 错误

### Requirement: Gateway 提供 Autopilot REST API
Gateway SHALL 提供 Repo Autopilot 任务列表和提交接口，对应 /autopilot、/ship 命令。

#### Scenario: 列出 Autopilot 任务
- **WHEN** 客户端发送 `GET /api/autopilot/tasks`
- **THEN** 返回 HTTP 200，body 为 `RepoTaskCard[]`（含 title/status/source/created_at）

#### Scenario: 提交 Repo 任务（/ship）
- **WHEN** 客户端发送 `POST /api/autopilot/ship`，body `{"task": "Fix the login bug", "cwd": "/path/to/repo"}`
- **THEN** 返回 HTTP 202，任务入队，返回 `{"task_id": "..."}`

### Requirement: Gateway 提供 Debug/诊断 REST API
Gateway SHALL 提供环境诊断和 hooks 列表端点，对应 /doctor、/hooks 命令。

#### Scenario: 获取环境诊断
- **WHEN** 客户端发送 `GET /api/debug/doctor`
- **THEN** 返回 HTTP 200，body 含环境检查结果（Python 版本、依赖状态、API 连通性等）

#### Scenario: 获取 hooks 列表
- **WHEN** 客户端发送 `GET /api/debug/hooks`
- **THEN** 返回 HTTP 200，body 为已配置的 hook 数组（event/command/enabled）


