## Why

当前 Swarm 协作体验割裂：用户点击"启动团队"后被导航到 ChatPage 看到一条裸露的 `/swarm start` 命令，无法在 ChatPage 直接看到各成员的实时执行内容，也缺乏优雅的任务分发机制。此次优化使 Swarm 协作体验从"开发者工具"升级为"普通用户可用的 AI 团队产品"。

## What Changes

- **新增** ChatPage 内嵌 Swarm 成员面板：Leader session 旁可折叠展开查看各成员实时对话，无需跳转 SwarmPage
- **新增** Gateway 端的 `POST /api/swarm/teams/{name}/start` API：接收任务描述，内部自动创建 Orchestrator session、写入系统提示、执行团队启动，UI 侧不再显示 `/swarm start` 命令
- **新增** 后端在 spawn Agent 时将 `session_id` 回写到 `TeamMember`（"task 10.1" 补全），为 transcript 查看提供基础
- **新增** WebSocket 实时推送替代前端轮询：Agent 状态变化（active/idle/stopped）通过 `swarm_status` 事件实时下发
- **修改** Leader Agent 系统提示：注入动态任务分发指令，引导 Leader 根据任务内容规划后按需分派给具体成员，而非固定工作流
- **修改** `launchTeam` 前端函数：调用新 REST API，不再通过 prefill + autosubmit 方式绕行 ChatPage
- **BREAKING** 移除 `prefill`/`autosubmit` URL 参数对 Swarm 启动的依赖

## Capabilities

### New Capabilities

- `swarm-start-api`: Gateway 端原子化团队启动 API，一次调用完成 session 创建 + 系统提示注入 + 团队元数据记录
- `swarm-chatpage-member-panel`: ChatPage 内嵌成员面板，展示 Leader 和各成员的实时 transcript，可折叠，无需跳转
- `swarm-session-id-tracking`: spawn 时将 Agent session_id 回写 TeamMember，使 transcript API 正常工作
- `swarm-realtime-status`: 通过已有 WebSocket `swarm_status` 事件实时通知前端状态变化，前端移除轮询

### Modified Capabilities

- `hlagent-web-ui`: ChatPage 布局新增 Swarm 成员面板区域；launchTeam 改走新 API

## Impact

- **前端**：`swarmApi.ts`（launchTeam 改 REST 调用）、`AppLayout.tsx`（新增 SwarmMemberPanel 侧栏）、移除 autosubmit 逻辑
- **后端 Gateway**：新增 `POST /api/swarm/teams/{name}/start` 路由
- **后端 SDK**：`swarm/subprocess_backend.py` 和 `in_process.py` 补全 session_id 回写；`ui/backend_host.py` 确保 `swarm_status` 在 spawn/状态变化时实时推送
- **后端 Prompt**：Leader 系统提示模板中注入动态分配指令
