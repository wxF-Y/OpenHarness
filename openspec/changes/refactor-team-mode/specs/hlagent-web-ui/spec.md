## MODIFIED Requirements

### Requirement: SwarmPage 使用 hook 获取数据
SwarmPage SHALL 通过 `useSwarmTeam` hook 获取团队数据，组件自身 SHALL 不直接调用 `swarmApi` 中的 fetch 函数，不包含 `useEffect` + `fetch` 组合，不包含 `setInterval` 调用。

#### Scenario: SwarmPage 加载团队成员
- **WHEN** 用户导航到 SwarmPage 并选中某个团队
- **THEN** 页面 SHALL 通过 `useSwarmTeam` hook 获取成员列表并展示，`isLoading` 为 true 期间显示加载指示器

#### Scenario: SwarmPage 在 RUNNING 状态下不轮询
- **WHEN** 团队处于 RUNNING 状态
- **THEN** SwarmPage SHALL 不触发任何 `setInterval`，成员状态更新 SHALL 仅由 WebSocket `swarm_status` 事件驱动

## ADDED Requirements

### Requirement: 团队运行状态显示 TeamRunState
前端 SHALL 从后端获取并展示显式的 `TeamRunState`（`TEMPLATE/RUNNING/IDLE/ARCHIVED`），不再由前端推断团队状态。

#### Scenario: 显示 RUNNING 状态
- **WHEN** 后端返回 `state: "RUNNING"` 的团队运行快照
- **THEN** 前端 SHALL 在团队视图顶部展示运行中状态标识

#### Scenario: 显示 IDLE 状态
- **WHEN** 后端返回 `state: "IDLE"` 的团队运行快照
- **THEN** 前端 SHALL 展示空闲状态，并提供"重新启动"操作入口
