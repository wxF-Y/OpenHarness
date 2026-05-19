## Why

HLAgent 当前采用多页路由架构，各功能（Memory、Skills、Cron、Swarm 等）分散在独立页面，用户需要频繁跳转导航，对普通用户不友好。整合为单页侧边栏布局，让所有功能通过点击即可访问，减少上下文切换，提升易用性。

## What Changes

- **新增统一布局外壳**：引入 `AppLayout` 组件，包含可折叠左侧导航侧边栏 + 右侧主内容区，替代当前各页面独立布局
- **侧边栏分组导航**：三个分组——"对话"（会话列表 + 新建）、"助手工具"（Memory/Skills/专家库）、"高级功能"（Cron/Swarm/Autopilot/权限，默认折叠）
- **会话列表嵌入侧边栏**：会话列表作为"对话"分组的子项，直接在侧边栏内展示和切换，不再单独跳页
- **主内容区页面切换**：点击侧边栏功能项，主内容区整体切换到对应功能页面（布局方案B），各功能页面保留独立内容
- **移除顶层路由跳转**：Memory/Skills/Cron/Swarm/Experts/Autopilot/Permissions 不再作为独立路由页面跳转，统一在 AppLayout 内渲染
- **WelcomePage 合并**：首页欢迎内容整合进 AppLayout，不再是独立路由

## Capabilities

### New Capabilities
- `app-layout`: 统一单页应用布局外壳，包含可折叠侧边栏和主内容区切换逻辑
- `sidebar-navigation`: 分组式侧边栏导航，支持"对话/助手工具/高级功能"三级分组，每组可折叠，包含会话列表

### Modified Capabilities
- `hlagent-web-ui`: 整体布局从多页路由改为单页侧边栏布局，路由结构变更，各功能页面作为主内容区子视图

## Impact

- **前端文件**：`App.tsx`（路由重构）、`Sidebar.tsx`（重写为分组导航）、`ChatPage.tsx`（移除顶部返回栏，适配新布局）、各功能页面组件（移除独立页面样式外壳）
- **新增组件**：`AppLayout.tsx`
- **路由变更**：`/cron`、`/swarm`、`/memory`、`/skills`、`/autopilot`、`/permissions-settings`、`/experts` 路由可保留用于直接访问，但主要通过侧边栏导航
- **无后端变更**：纯前端重构，API 不变
