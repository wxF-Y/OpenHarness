## Why

启动 Swarm 团队后，新创建的 session 未出现在左侧会话列表中，且右侧内容区缺乏对每个 Agent 执行过程的实时可见性，导致用户无法感知团队协作的进展。

## What Changes

- **新增**：启动团队后，主会话（Orchestrator session）自动注册到左侧会话分组列表，并可点击跳转
- **新增**：内容区展示 Swarm 团队面板，列出所有 Agent 成员，每个成员卡片可展开查看实时执行内容（transcript）
- **修改**：`launchTeam` 流程在导航前将新建的 session_id 同步到会话列表 store
- **修改**：Agent 成员详情视图支持实时刷新 transcript，而非仅静态显示

## Capabilities

### New Capabilities

- `swarm-session-registration`: 启动团队时将 Orchestrator session 同步到会话列表，并附加团队标识
- `swarm-agent-live-transcript`: 在内容区为每个 Agent 成员提供实时 transcript 展示，支持轮询刷新

### Modified Capabilities

- `hlagent-web-ui`: 会话列表（SessionList）新增团队会话分组；SwarmPage 内容区布局调整以承载多 Agent transcript 面板

## Impact

- **前端**：`swarmApi.ts`（launchTeam 后通知 sessionStore）、`SwarmPage.tsx`（内容区布局）、`swarmStore.ts`（新增 orchestratorSessionId 字段）
- **前端**：可能需要新增 `SwarmAgentPanel.tsx` 子组件承载单个 Agent 的 transcript
- **API**：依赖已有 `/api/swarm/agents/{agent_id}/transcript` 端点，无需新增后端 API
- **WebSocket**：利用已有 `swarm_status` 事件触发 transcript 刷新，无需新增事件类型
