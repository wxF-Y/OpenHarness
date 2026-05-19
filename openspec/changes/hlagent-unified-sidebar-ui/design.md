## Context

HLAgent Web UI 目前采用 React Router 多页架构：`/`（欢迎页）、`/chat/:id`（对话）、`/memory`、`/skills`、`/cron`、`/swarm`、`/experts`、`/autopilot`、`/permissions-settings` 各自独立路由。用户每次切换功能都需要完整页面跳转，导致：1）没有持久的上下文视图；2）路由导航对普通用户不直观；3）各页面重复实现顶部栏布局。

目标用户是非技术的普通用户，需要所有功能"点到即用"，不希望在多个 URL 之间跳转。

## Goals / Non-Goals

**Goals:**
- 将所有功能整合到单一 `AppLayout` 外壳，左侧导航侧边栏 + 右侧主内容区
- 侧边栏三分组：对话（Sessions 列表）、助手工具（Memory/Skills/专家库）、更多工具（Cron/Swarm/Autopilot/权限，默认折叠）
- 主内容区视图切换：侧边栏点击功能项，主区域整体替换为对应功能视图，无页面跳转感
- 侧边栏内嵌会话列表，点击会话条目切换 Chat 视图，新建按钮创建并进入新会话
- 保持现有 WebSocket 连接逻辑、API 调用、状态管理不变

**Non-Goals:**
- 不重写各功能页面的业务逻辑（Memory/Skills/Cron/Swarm 内部实现不变）
- 不改变后端 API
- 不实现响应式/移动端适配（桌面端优先）
- 不修改 Onboarding 流程（OnboardingGuard 继续工作）

## Decisions

### 决策 1：视图状态管理用 React state 而非 React Router

**选择**：用 `activeView: string` state（在 `AppLayout` 或 `uiStore`）控制主内容区显示哪个视图，而不是用 `navigate('/memory')` 路由跳转。

**理由**：用户感知是"单页应用"——切换视图不需要 URL 变化，也不会触发组件完全卸载/重挂载（避免 Memory/Skills 等页面每次都重新 fetch 数据）。路由跳转会导致 ChatPage 的 WebSocket 断开重连。

**备选**：保留路由 + 用 `<Outlet>` 嵌套路由。排除原因：Chat WebSocket 连接无法跨路由保持，且嵌套路由增加路由配置复杂度。

**保留路由**：`/chat/:sessionId`、`/onboarding`、`/` 仍保留路由用于直链访问；其他功能路由可作为别名重定向到 `/?view=xxx`，向后兼容。

### 决策 2：侧边栏宽度和折叠方式

**选择**：展开 220px / 折叠 48px（图标模式），沿用现有 `Sidebar.tsx` 的尺寸。折叠状态只显示图标按钮，不显示分组文字。

**理由**：与现有设计保持一致，无需调整 Chat 区域已有的布局计算。

### 决策 3：会话列表位置与展示内容

**选择**：放入侧边栏"对话"分组，展示最近 10 条会话。每条优先显示 **cwd 路径末段 + 相对时间**（如 `my-project · 今天 14:30`），无法获取时回退到 `对话 #N` 序号。顶部固定"+ 新建对话"按钮。

**理由**：`session_id` 前 12 字符对普通用户无意义，无法区分不同会话。cwd 末段是用户最熟悉的上下文标识，相对时间帮助快速定位最近的对话。

### 决策 4：各功能视图的 height 适配

**选择**：主内容区设为 `flex: 1; overflow: hidden`，各功能视图内部自管理 scroll。ChatPage 中的 `height: 100vh` 改为 `height: 100%`。

**理由**：各功能页面当前使用 `height: 100vh` 假设自身是全屏容器。嵌入 AppLayout 后需改为 `height: 100%` 适配父容器高度，其余内部逻辑不变。

### 决策 5：无会话时的欢迎态

**选择**：AppLayout 初始化时若无活跃会话，主内容区渲染内嵌欢迎组件（品牌 Logo + 大「开始新对话」按钮 + 3 个功能亮点说明），不跳转到独立路由，不显示空白页。

**理由**：空白主内容区让普通用户不知所措。欢迎组件在原地渲染，点击按钮后直接创建会话并切换为 Chat 视图，无路由跳转。

### 决策 6：Agent 忙碌时的跨视图感知

**选择**：当 Chat 处于 `busy` 状态时，侧边栏「对话」分组标题旁显示脉冲动画绿点（`●` + CSS animation），让用户在任意功能视图都能感知任务正在运行。

**理由**：用户切换到 Memory/Skills 查看内容时，若 Agent 正在执行任务，当前设计完全无感知。脉冲点是最低侵入性的状态提示，不打断用户当前操作。

### 决策 7：折叠模式下「更多工具」图标行为

**选择**：折叠状态下点击 `⚙`（更多工具汇总图标），触发**展开侧边栏**并自动展开「更多工具」分组，而不是直接切换到某个功能视图。

**理由**：`⚙` 图标对应多个功能，点击后直接跳转某一个功能不符合用户预期。展开侧边栏 + 展开分组，让用户看到所有选项后自己选择，符合"渐进披露"原则。

## Risks / Trade-offs

- **Chat WebSocket 切换视图时断连** → 切换到其他视图时 ChatPage 不卸载，保持挂载但隐藏（`display: none`），保持 WS 连接活跃。代价是内存占用略增，但对桌面应用可接受。
- **各功能页面 100vh 硬编码** → 需逐个修改为 `height: 100%`，工作量已知且可控（~7 个文件）。
- **直接访问旧路由** → 旧路由（`/memory` 等）仍保留但重定向到 AppLayout 内对应视图，不破坏已有书签或外部链接。
- **折叠侧边栏时分组标题消失** → 折叠模式仅显示图标，通过 tooltip 提示功能名称，`⚙` 点击展开侧边栏而非直跳功能。
- **会话标题依赖 cwd** → 若 cwd 路径末段雷同（如多个 `src` 目录），仍无法区分。当前阶段接受此限制，后续可用会话第一条消息作为标题（需 API 支持）。
- **[技术债] 协议类型定义跨层漂移** → `types/protocol.ts` 中的 `BackendEventType` 和 `FrontendRequestType` 与 Python Gateway/SDK 各自独立维护。Gateway 新增事件类型时，前端不会有编译时错误，只在运行时静默忽略。长期解法：将协议定义集中到 `protocol.json` 或 OpenAPI schema，通过代码生成工具同步前后端类型；当前阶段接受此限制，变更协议时需人工同步两侧。

## Migration Plan

1. 新建 `AppLayout.tsx` 和 `useViewStore`（或扩展 `uiStore`）
2. 重构 `Sidebar.tsx` 为三分组样式，接收 `activeView` + `onViewChange` props
3. 修改 `App.tsx`：`/chat/:id`、`/` 路由用 `<AppLayout>` 包裹，其他路由重定向
4. 各功能页面高度适配（`100vh` → `100%`）
5. ChatPage 移除顶部独立导航栏（与 AppLayout 顶部栏合并）

回滚：所有旧路由保留，若出问题可临时恢复 App.tsx 路由配置。
