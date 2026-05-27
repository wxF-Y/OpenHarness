## ADDED Requirements

### Requirement: 状态变化通过 WebSocket 实时推送，减少前端轮询
Agent 生命周期关键节点（spawn 成功、状态变化、任务完成）SHALL 通过 `swarm_status` WebSocket 事件主动推送到前端，前端无需主动轮询团队状态。

#### Scenario: spawn 成功时推送事件
- **WHEN** 任意 Agent spawn 成功，`session_id` 已设置
- **THEN** Gateway SHALL 立即发出 `swarm_status` 事件
- **THEN** 事件 `swarm_teammates` 字段 SHALL 包含该 Agent 的最新 `session_id` 和 `status: "active"`

#### Scenario: Agent 进入 idle 时推送事件
- **WHEN** Agent 完成任务，发送 `idle_notification` 到 leader mailbox
- **THEN** Gateway 处理 `idle_notification` 时 SHALL 发出 `swarm_status` 事件
- **THEN** 事件中该 Agent 的 `status` SHALL 为 `"idle"`

#### Scenario: 前端收到事件后更新面板无需轮询
- **WHEN** 前端的 `swarmStore` 收到 `swarm_status` 事件
- **THEN** `swarmStore.teammates` SHALL 更新
- **THEN** ChatPage 成员面板和 SwarmPage 团队进展视图 SHALL 响应更新，无需额外轮询调用
- **THEN** SwarmPage 的 3s 轮询 SHALL 仅作为兜底机制（超过 30s 无事件时才触发一次刷新）

#### Scenario: 首次打开成员面板时一次性加载
- **WHEN** 用户首次展开 ChatPage 成员面板
- **THEN** 系统 SHALL 调用 `GET /api/swarm/teams/{name}` 一次获取当前完整成员状态（非轮询）
- **THEN** 之后状态更新依赖 `swarm_status` 事件，不再定时拉取成员列表
