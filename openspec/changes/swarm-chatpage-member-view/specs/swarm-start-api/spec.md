## ADDED Requirements

### Requirement: 后端提供原子化团队启动 API（任务副本隔离）
系统 SHALL 提供 `POST /api/swarm/teams/{teamName}/start` 端点。每次调用 SHALL 克隆模板团队为独立的任务副本，成员 spawn 和状态写入副本，原模板永不修改。

#### Scenario: 成功启动团队并创建任务副本
- **WHEN** 客户端发送 `POST /api/swarm/teams/{teamName}/start`，body 含 `task` 字符串
- **THEN** Gateway SHALL 创建 `{teamName}-{yyyymmdd-HHMMss}` 任务副本团队（从模板克隆成员定义）
- **THEN** Gateway SHALL 在任务副本中 spawn 各成员（session_id/task_id 写入副本，不修改模板）
- **THEN** 响应 SHALL 包含 `{ session_id: string, task_team: string, members: TeamMember[] }`
- **THEN** 原模板团队 `{teamName}/team.json` SHALL NOT 被修改

#### Scenario: 多次启动同一团队任务完全隔离
- **WHEN** 同一模板团队被启动两次
- **THEN** 第一次创建 `{teamName}-20260524-100000`，第二次创建 `{teamName}-20260524-110000`
- **THEN** 两次运行的成员 session_id、task_id、状态互不影响
- **THEN** SwarmPage 的团队列表 SHALL 只显示模板团队，不显示任务副本
- **THEN** 整个过程对前端透明，用户不看到任何 `/swarm start` 命令

#### Scenario: 团队不存在时返回 404
- **WHEN** 请求的 teamName 在磁盘上不存在
- **THEN** API SHALL 返回 HTTP 404

#### Scenario: 团队无成员时返回 400
- **WHEN** 团队存在但 member 数量为 0
- **THEN** API SHALL 返回 HTTP 400，message 为 "团队无成员，请先添加成员"

#### Scenario: Leader 系统提示含动态分配指令
- **WHEN** API 被调用
- **THEN** Orchestrator session 的系统提示 SHALL 包含团队成员列表描述和动态任务分配指令模板
- **THEN** 系统提示 SHALL NOT 硬编码固定工作流步骤

### Requirement: 前端 launchTeam 改走新 API
前端 `launchTeam()` 函数 SHALL 调用新的 REST API，移除 prefill/autosubmit URL 参数逻辑。

#### Scenario: 前端启动团队
- **WHEN** 用户点击"启动团队"
- **THEN** 前端 SHALL POST 到 `/api/swarm/teams/{name}/start`
- **THEN** 拿到 `session_id` 后 navigate 到 `/chat/{session_id}?team={name}`
- **THEN** ChatPage 中 Leader SHALL 已收到第一条用户消息（`task` 内容），并自动开始响应
- **THEN** ChatPage 中 SHALL NOT 显示任何 `/swarm start` 命令

#### Scenario: Leader 自动开始工作无需用户输入
- **WHEN** 用户到达 ChatPage
- **THEN** 聊天区 SHALL 显示第一条用户消息（内容为任务描述）和 Leader 的响应（正在生成或已生成）
- **THEN** 用户 SHALL NOT 需要手动输入任何内容来触发 Leader 开始工作

#### Scenario: 启动失败显示错误
- **WHEN** API 返回非 2xx
- **THEN** 用户 SHALL 在 SwarmPage 看到 toast 错误提示
- **THEN** 页面 SHALL 保持在 SwarmPage，不导航
