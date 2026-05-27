## ADDED Requirements

### Requirement: 启动团队后 Orchestrator session 自动出现在会话列表
启动团队时，系统 SHALL 在创建 Orchestrator session 后立即触发左侧会话列表刷新，使新 session 出现在侧边栏"对话"分组中，并附带团队名称标签以标识来源。

#### Scenario: 点击启动团队成功后会话列表刷新
- **WHEN** 用户填写任务描述并点击"启动团队"按钮
- **THEN** 前端向 `/api/sessions` 发起 POST 请求并获得 session_id
- **THEN** 侧边栏会话列表 SHALL 在导航前触发刷新（通过 `uiStore.incrementSidebarRefreshKey()`）
- **THEN** 左侧"对话"分组立即显示该 session 条目（无需用户手动刷新页面）

#### Scenario: 团队 session 显示团队名称标签
- **WHEN** 新创建的 Orchestrator session 出现在会话列表
- **THEN** 该 session 条目 SHALL 展示团队名称标签（如"🤝 research-team"），复用已有的 `expertRoleLabels` 标签渲染机制
- **THEN** 其他已有 session（非团队启动）的展示 SHALL 不受影响

#### Scenario: 启动失败时不刷新会话列表
- **WHEN** POST `/api/sessions` 返回非 2xx 状态码
- **THEN** `uiStore.incrementSidebarRefreshKey()` SHALL NOT 被调用
- **THEN** `uiStore.setExpertRoleLabels()` SHALL NOT 被调用
- **THEN** 用户 SHALL 在 SwarmPage 中间栏看到明确的错误提示（toast 通知，显示"启动失败，请重试"并保持在 SwarmPage，不导航）

#### Scenario: 启动过程中按钮显示加载状态
- **WHEN** 用户点击"启动团队"按钮后请求尚未完成
- **THEN** 按钮 SHALL 显示"⟳ 启动中…"文案且处于禁用状态（现有 `launchBusy` 已实现，需确认文案正确）
- **THEN** 请求完成（成功或失败）后 SHALL 恢复按钮可点击状态

#### Scenario: 点击团队 session 可跳转对话
- **WHEN** 用户在左侧会话列表点击团队 Orchestrator session 条目
- **THEN** 右侧 SHALL 展示该 session 的 ChatPage 对话内容（与普通 session 行为一致）

### Requirement: ChatPage 中团队 session 提供返回 SwarmPage 的入口
当用户在 ChatPage 查看团队 Orchestrator session 时，系统 SHALL 在页面顶部显示一条提示横幅，标识这是 Swarm 团队任务并提供跳转回 SwarmPage 的入口。

#### Scenario: 团队 session 在 ChatPage 显示引导横幅
- **WHEN** 用户进入 ChatPage，当前 session 的 `expertRoleLabel` 以"🤝 "开头（即团队 session 标识）
- **THEN** ChatPage 顶部 SHALL 显示一条浅色提示横幅："🤝 {teamName} 团队任务运行中 — [查看团队进展 →]"
- **THEN** 点击"查看团队进展 →"SHALL 导航到 SwarmPage 并自动选中对应团队

#### Scenario: 非团队 session 不显示横幅
- **WHEN** 用户进入 ChatPage，当前 session 不含团队标签
- **THEN** ChatPage SHALL NOT 显示 Swarm 引导横幅
