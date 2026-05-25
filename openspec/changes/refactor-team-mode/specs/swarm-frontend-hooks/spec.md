## ADDED Requirements

### Requirement: useSwarmTeam 自定义 Hook
`useSwarmTeam(teamName: string)` hook SHALL 封装团队数据的获取与状态管理，返回 `{ members, teamState, teamFile, isLoading, error, refresh }`。`SwarmPage` 组件 SHALL 通过此 hook 获取数据，不直接调用 `swarmApi`。

#### Scenario: Hook 提供成员列表
- **WHEN** `useSwarmTeam("my-team")` 被挂载
- **THEN** hook SHALL 自动获取成员列表并返回 `members` 对象，`isLoading` 先为 `true` 后变为 `false`

#### Scenario: WebSocket 事件触发成员更新
- **WHEN** WebSocket 收到 `swarm_status` 事件，包含团队成员的 `session_id` 更新
- **THEN** hook 返回的 `members` SHALL 自动更新，不需要手动调用 `refresh()`

### Requirement: 消除轮询机制
`SwarmPage` 及其相关 hook SHALL 不使用 `setInterval` 或 `setTimeout` 进行状态轮询。所有实时状态更新 SHALL 由 WebSocket 事件驱动。

#### Scenario: RUNNING 状态下不轮询
- **WHEN** 团队处于 `RUNNING` 状态且 WebSocket 连接正常
- **THEN** 前端 SHALL 不发起任何定时 HTTP 请求，成员状态仅由 WebSocket 事件更新

#### Scenario: WebSocket 断连重连后状态恢复
- **WHEN** WebSocket 连接断开后重新连接
- **THEN** `useWebSocket` 的 reconnect 逻辑 SHALL 触发一次完整状态刷新（调用 `refresh()`），确保状态一致

### Requirement: SwarmPage 行数约束
`SwarmPage.tsx` 的总行数 SHALL 不超过 250 行（当前 655 行）。数据逻辑 SHALL 迁移至 hook，子组件 SHALL 保持独立文件。

#### Scenario: SwarmPage 仅包含视图逻辑
- **WHEN** 审查 `SwarmPage.tsx`
- **THEN** 文件 SHALL 仅包含布局、条件渲染和事件处理，不包含 `fetch`、`axios` 调用或 `setInterval`
