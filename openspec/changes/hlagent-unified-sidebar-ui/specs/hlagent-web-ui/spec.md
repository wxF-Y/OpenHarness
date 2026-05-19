## MODIFIED Requirements

### Requirement: Web UI 全局三栏布局
Web UI SHALL 采用左侧可折叠导航侧边栏（220px 展开 / 48px 折叠）+ 右侧主内容区的两栏布局，通过 AppLayout 组件实现，替代原有每个功能页面独立实现顶部栏的模式。主内容区根据侧边栏激活的功能视图动态渲染对应组件，所有功能在同一 DOM 树内切换，无完整路由跳转。

#### Scenario: 默认布局渲染
- **WHEN** 用户完成 Onboarding 进入主界面
- **THEN** AppLayout 渲染：左侧侧边栏（220px，分三组）+ 右侧主内容区（Chat 视图默认），底部 StatusBar（32px）全宽跨越两栏

#### Scenario: 折叠左侧栏
- **WHEN** 用户点击侧边栏顶部的折叠按钮「←」
- **THEN** 左侧栏收缩为 48px 图标模式，主内容区水平扩展；再次点击展开至 220px

#### Scenario: 各功能视图高度适配
- **WHEN** AppLayout 渲染任意功能视图（Memory/Skills/Cron 等）
- **THEN** 视图高度为 `100%` 填充父容器（主内容区），不使用 `100vh`，内部 scroll 由各视图自管理
