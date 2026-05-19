## ADDED Requirements

### Requirement: AppLayout 提供统一的单页应用外壳
AppLayout SHALL 作为所有已登录页面的顶层容器，包含左侧可折叠导航侧边栏和右侧主内容区，主内容区根据当前激活视图渲染对应功能组件，无需整页刷新。

#### Scenario: 默认进入应用显示 Chat 视图
- **WHEN** 用户完成 Onboarding 进入 AppLayout
- **THEN** 主内容区默认渲染 ChatPage，左侧侧边栏展开（220px），若无活跃会话则显示新建对话提示

#### Scenario: 切换功能视图不卸载 ChatPage
- **WHEN** 用户点击侧边栏中的"Memory"、"Skills"或其他功能项
- **THEN** 主内容区切换显示对应功能组件，ChatPage 保持挂载但隐藏（不卸载），WebSocket 连接不断开

#### Scenario: 从功能视图返回 Chat
- **WHEN** 用户在非 Chat 视图中点击侧边栏的当前活跃会话或"新建对话"按钮
- **THEN** 主内容区切换回 ChatPage，显示该会话的对话内容

#### Scenario: 折叠侧边栏扩大主内容区
- **WHEN** 用户点击侧边栏的折叠按钮
- **THEN** 侧边栏收缩为 48px 图标模式，主内容区水平扩展填充空间，功能视图不重新渲染

#### Scenario: 展开侧边栏恢复导航
- **WHEN** 用户在图标模式下点击展开按钮
- **THEN** 侧边栏恢复 220px 展开模式，主内容区收缩，当前视图内容不变

#### Scenario: 主内容区高度填满视口
- **WHEN** AppLayout 渲染任意功能视图
- **THEN** 主内容区高度为 `calc(100vh - StatusBar高度)`，各功能视图内部自管理 overflow/scroll

### Requirement: AppLayout 保持对话 WebSocket 连接在视图切换中存活
AppLayout SHALL 在用户切换到非 Chat 视图时保持 ChatPage 组件挂载状态，防止 WebSocket 连接因组件卸载而断开。

#### Scenario: 切换视图期间 WS 保持连接
- **WHEN** Chat 视图的 WebSocket 状态为 `ready`，用户点击侧边栏切换到 Memory 视图
- **THEN** WebSocket 连接状态仍为 `ready`，切换回 Chat 视图时无需重新握手

#### Scenario: 无活跃会话时 ChatPage 隐藏不报错
- **WHEN** AppLayout 初始化时尚未创建任何会话，ChatPage 处于隐藏状态
- **THEN** 不发起任何 WebSocket 连接，不显示错误
