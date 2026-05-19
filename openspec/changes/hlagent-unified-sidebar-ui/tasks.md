## 1. 视图状态管理

- [x] 1.1 在 `uiStore.ts` 中添加 `activeView: string`（默认 `'chat'`）和 `activeChatSessionId: string | null` 状态及对应 setter
- [x] 1.2 定义视图枚举类型 `AppView`：`chat | memory | skills | experts | cron | swarm | autopilot | permissions`

## 2. 新建 AppLayout 组件

- [x] 2.1 创建 `HLAgent/web/src/components/AppLayout.tsx`，包含左侧 `Sidebar` + 右侧主内容区的两栏 flex 布局
- [x] 2.2 主内容区根据 `activeView` 渲染对应视图组件，ChatPage 始终挂载（`display: none` 隐藏，不卸载）
- [x] 2.3 主内容区视图切换加 80ms opacity fade（`transition: opacity 80ms ease-out`），用 `key={activeView}` 触发，不使用 transform 避免布局抖动
- [x] 2.4 将 StatusBar 移入 AppLayout 底部，跨两栏全宽展示
- [x] 2.5 在 AppLayout 中将 `PermissionModal`、`QuestionModal`、`SelectModal`、`ErrorToastContainer` 全局挂载（从 ChatPage 移出）
- [x] 2.6 AppLayout 初始化时若 `activeChatSessionId` 为 null，主内容区渲染内嵌欢迎组件：垂直居中、max-width 480px、水平居中；「开始新对话」为唯一主操作按钮（全宽）；功能亮点改为水平 3 列 icon + 单行文字，不用卡片

## 3. 重构 Sidebar 为分组导航

- [x] 3.1 重写 `Sidebar.tsx`：移除原有 Pages section，改为「对话」/「助手工具」/「更多工具」三个 Section 分组；分组标题样式：全大写、0.65rem、颜色 `#6c7086`，与功能项形成层次
- [x] 3.2 「更多工具」分组默认 `open=false`（折叠），其余分组默认展开
- [x] 3.3 Sidebar 接收 `activeView`、`onViewChange` props；功能项激活态：左侧 2px 蓝色指示线（`border-left: 2px solid #89b4fa`）+ 背景 `#45475a`；悬停态背景 `#313244`
- [x] 3.4 「对话」分组顶部添加「+ 新建对话」按钮：带圆角边框（`border: 1px solid #313244`）、字色 `#89b4fa`；点击期间显示加载态（`创建中… + disabled`）；调用 `POST /api/sessions` 成功后切换到 Chat 视图
- [x] 3.5 「对话」分组内展示最近 10 条会话列表；每条优先显示 `cwd 末段路径 · 相对时间`，无 cwd 时回退为 `对话 #N`；会话条目字号 0.75rem、左侧缩进，视觉上低于功能入口层级；loading 态显示 3 条骨架条（`#313244, opacity 0.4`）；empty 态显示 `暂无历史对话` 灰色小字；error 静默降级为空态不弹 toast；新建成功的会话条目出现时有短暂高亮动画（黄色 → 透明）
- [x] 3.6 「对话」分组标题旁：当 `sessionStore.busy === true` 时，显示脉冲绿点（CSS `@keyframes pulse`），提示 Agent 正在运行
- [x] 3.7 更新折叠模式（48px）：图标按钮统一 `width: 36px; height: 36px; borderRadius: 8px`，图标间距收紧为 `gap: 4px`；图标垂直排列为 `≡ + 🧠 ⚡ 🎭 ⚙`；点击 `⚙` 触发**展开侧边栏并展开「更多工具」分组**（非跳转功能）；折叠按钮（≡）固定顶部，展开入口固定底部；所有图标悬停显示 tooltip

## 4. 修改 App.tsx 路由结构

- [x] 4.1 将 `/`、`/chat/:sessionId` 路由用 `<AppLayout>` 包裹（保持 OnboardingGuard 在外层）
- [x] 4.2 `/memory`、`/skills`、`/cron`、`/swarm`、`/experts`、`/autopilot`、`/permissions-settings` 路由重定向到 `/?view=<name>`（向后兼容旧书签）
- [x] 4.3 移除 `WelcomePage` 独立路由，欢迎态由 AppLayout 内嵌欢迎组件承担（任务 2.6）

## 5. 各功能视图高度适配

- [x] 5.1 `ChatPage.tsx`：`height: 100vh` 改为 `height: 100%`，移除顶部独立导航栏（`backLabel` 返回按钮）；顶部栏更新为 `模型名 · session末4位`（左）+ 连接状态 + 设置齿轮图标（右，点击打开 SettingsDrawer）
- [x] 5.2 `MemoryPage.tsx`：外层容器 `height: 100vh` 改为 `height: 100%`
- [x] 5.3 `SkillsPage.tsx`：外层容器 `height: 100vh` 改为 `height: 100%`
- [x] 5.4 `CronPage.tsx`：外层容器 `height: 100vh` 改为 `height: 100%`，移除独立顶部导航栏
- [x] 5.5 `SwarmPage.tsx`：外层容器 `height: 100vh` 改为 `height: 100%`，移除独立顶部导航栏
- [x] 5.6 `ExpertsPage.tsx`：外层容器 `height: 100vh` 改为 `height: 100%`，移除独立顶部导航栏
- [x] 5.7 `AutopilotPage.tsx`：外层容器 `height: 100vh` 改为 `height: 100%`
- [x] 5.8 `PermissionsPage.tsx`：外层容器 `height: 100vh` 改为 `height: 100%`

## 6. ChatPage 适配 AppLayout

- [x] 6.1 ChatPage 从 props 或 `uiStore` 读取 `sessionId`（当 AppLayout 传入时），保持 `useParams` 作为后备（直链访问兼容）
- [x] 6.2 将 `PermissionModal`、`QuestionModal`、`SelectModal`、`ErrorToastContainer` 从 ChatPage JSX 移除（已移至 AppLayout 全局挂载）
- [x] 6.3 ChatPage 顶部栏：左侧显示 `模型名 · session末4位`，右侧显示连接状态 + 设置齿轮图标（`⚙`，点击打开 SettingsDrawer），移除「← 返回」导航按钮

## 7. Gateway 层改动

- [x] 7.1 `HLAgent/gateway/routers/sessions.py`：`GET /api/sessions` 的 `SessionSummary` 响应模型增加 `created_at: float` 字段（Unix timestamp），会话创建时在 `session_manager.py` 中记录
- [x] 7.2 `HLAgent/gateway/routers/sessions.py`：`POST /api/sessions` 响应从 `{"session_id": ...}` 改为返回完整 `SessionSummary`（含 `session_id, cwd, model, created_at`），前端收到后本地 prepend 到列表，无需二次 GET
- [x] 7.3 更新前端 `SessionSummary` TypeScript 类型定义（`Sidebar.tsx` 或抽取到 `types/`），增加 `created_at?: number` 字段，`POST /api/sessions` 调用处直接用返回值更新列表

## 8. UI 工程质量

- [x] 8.1 AppLayout 初始化时检测当前路由：若路径匹配 `/chat/:sessionId`，自动将 `activeChatSessionId` 和 `activeView` 同步到 uiStore，确保直链访问与内部导航状态一致
- [x] 8.2 确认 `ChatPage` 的 `useEffect([sessionId])` reset 逻辑在 AppLayout 不卸载 ChatPage 的场景下仍正确执行：`activeChatSessionId` 变化时触发 `sessionStore.reset()` 并重新建立 WebSocket
- [x] 8.3 `HLAgent/web/src/utils/swarmApi.ts` 的 `startExpertChat` 调用前校验 `role_prefix` 长度（≤ 5000 字），超出时调用 `uiStore.addErrorToast` 提示用户，不发起 API 请求

## 9. 验证与测试

- [x] 9.1 启动开发服务器，验证无会话时显示欢迎组件（max-width 480px，水平 3 列功能亮点），点击「开始新对话」创建并切换到 Chat 视图
- [ ] 9.2 验证点击 Memory/Skills/Cron 等功能项主内容区正确切换，切换有 opacity fade 过渡
- [ ] 9.3 验证切换视图时 Chat WebSocket 连接不断开（切回 Chat 后状态仍为 ready）
- [ ] 9.4 验证 Agent busy 时侧边栏「对话」标题旁显示脉冲绿点，切换到其他视图后绿点仍可见
- [ ] 9.5 验证新建对话：点击「+ 新建对话」→ 按钮进入加载态 → 创建成功（响应含完整 SessionSummary）→ 新会话条目高亮出现 → 切换到新会话 Chat 视图，无二次 GET
- [ ] 9.6 验证侧边栏折叠/展开，折叠状态点击 `⚙` 展开侧边栏并展开「更多工具」分组；图标按钮 36×36px 圆角悬停有背景色
- [ ] 9.7 验证旧路由 `/memory`、`/skills` 等重定向后正常展示对应视图
- [ ] 9.8 验证 Onboarding 流程不受影响（OnboardingGuard 仍正常拦截）
- [ ] 9.9 验证会话列表三态：loading 骨架屏、empty「暂无历史对话」、正常显示 `cwd 末段 · 相对时间`（依赖 Gateway created_at 字段）
- [ ] 9.10 验证 ChatPage 顶部栏显示 session 末 4 位，设置齿轮图标点击可打开 SettingsDrawer
- [ ] 9.11 验证功能项激活态：左侧蓝色指示线 + 背景加深；分组标题与功能项字号、颜色有明显层次差异
- [ ] 9.12 验证直链访问 `/chat/:sessionId` 时，uiStore 的 `activeView` 和 `activeChatSessionId` 自动同步正确
- [ ] 9.13 验证 ExpertsPage 选择超长 role_prefix（>5000 字）时显示 toast 错误，不发起 API 请求
