## Why

当前团队模式（Swarm）的核心模块存在职责膨胀问题：`team_lifecycle.py`（1022行）、`in_process.py`（929行）、`swarm.py` 路由（705行）、`SwarmPage.tsx`（655行）均已超出可维护边界，业务逻辑与框架胶水混杂，导致扩展新后端类型和调试状态流转时成本极高。随着 Leader 编排工具集（5 个新工具）和三种前端面板组件（SwarmAgentPanel/SwarmMemberBar/SwarmMemberPane）的加入，重构窗口期已至。

## What Changes

- **拆分 `team_lifecycle.py`**：分离 TeamMember 数据模型、TeamFile 持久化、TeamLifecycleManager 操作 和清理逻辑到独立模块
- **拆分 `in_process.py`**：分离 AbortController、TeammateContext、查询驱动循环、SSE 流管理到子模块
- **提取 `swarm.py` 路由业务逻辑**：将路由层降为薄适配层，业务逻辑迁移至 `swarm_service.py`
- **重构 `SwarmPage.tsx`**：拆分为数据层 hook (`useSwarmTeam`)、成员列表容器、详情面板容器，消除 混合轮询+WebSocket 的状态同步
- **统一 Team Run 生命周期**：明确 template → snapshot → running → idle → archived 状态机，消除 `teams/` 与 `teams-tasks/` 命名二义性
- **BREAKING**：`/api/swarm/teams/{team}/tasks` 重命名为 `/api/swarm/teams/{team}/runs`，与内部 `run_slug` 概念对齐

## Capabilities

### New Capabilities

- `swarm-state-machine`: 显式的团队运行状态机（template→running→idle→archived），提供状态转换 API 和持久化
- `swarm-service-layer`: Gateway 路由与业务逻辑分离，统一 `SwarmService` 类封装所有编排操作
- `swarm-frontend-hooks`: 前端数据层 hook（`useSwarmTeam`、`useSwarmMember`），使 SwarmPage 成为纯视图

### Modified Capabilities

- `hlagent-gateway`: `/api/swarm/teams/{team}/tasks` 端点 **BREAKING** 重命名为 `/api/swarm/teams/{team}/runs`；新增 `GET /api/swarm/teams/{team}/runs/{run_slug}/status` 状态查询端点
- `hlagent-web-ui`: SwarmPage 从单体组件拆分，提取 `useSwarmTeam` hook；移除 15s 轮询，改为纯 WebSocket 驱动状态更新

## Impact

- **受影响代码**：`src/openharness/swarm/`（全目录），`HLAgent/gateway/routers/swarm.py`，`HLAgent/web/src/pages/SwarmPage.tsx`，`HLAgent/web/src/stores/`
- **API 破坏性变更**：`/api/swarm/teams/{team}/tasks` → `/api/swarm/teams/{team}/runs`（需前端同步更新）
- **依赖关系**：后端拆分不影响公开 API 契约；前端 hook 拆分不影响组件接口
- **测试影响**：需新增 `swarm_service.py` 单元测试；`SwarmPage` 现有集成测试路径不变
