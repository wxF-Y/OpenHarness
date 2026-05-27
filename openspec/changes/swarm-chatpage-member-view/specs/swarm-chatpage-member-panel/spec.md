## ADDED Requirements

### Requirement: ChatPage 团队模式显示成员选择栏 + 分栏对比视图
当用户在 ChatPage 查看 Swarm 团队 session 时，系统 SHALL 在 header 下方显示成员选择栏；选中成员后，ChatPage 分为左侧 Leader 会话和右侧成员 transcript 的对比视图。

#### Scenario: 团队 session 显示成员选择栏
- **WHEN** 用户在 ChatPage 且当前 session 的 `expert_role_label` 以"🤝 "开头
- **THEN** ChatPage header 下方 SHALL 显示固定 36px 高的成员选择栏
- **THEN** 选择栏 SHALL 显示每个团队成员的名称 chip + 状态徽章（active/idle/stopped/⏳）
- **THEN** 非团队 session SHALL NOT 显示成员选择栏

#### Scenario: ChatView header 显示任务摘要
- **WHEN** 用户进入团队 session 的 ChatPage
- **THEN** header 中的 expert label 区域 SHALL 显示 `🤝 {teamName} · {task前40字}...`
- **THEN** `⊞ 管理团队` 按钮 SHALL 保留在 header 中用于跳转 SwarmPage

#### Scenario: 默认全宽 Leader 视图
- **WHEN** 用户进入团队 ChatPage，且没有选中任何成员
- **THEN** ChatPage 内容区 SHALL 全宽显示 Leader 的会话（TranscriptViewer + MessageInput）
- **THEN** 输入框 placeholder SHALL 为"可向 Leader 补充说明或调整方向..."

#### Scenario: 点击成员 chip 触发分栏视图
- **WHEN** 用户点击成员选择栏中的某个成员 chip
- **THEN** 被选中的 chip SHALL 高亮显示（`#89b4fa` 边框）
- **THEN** ChatPage 内容区 SHALL 变为左右分栏：左侧为 Leader 会话（保留输入框），右侧为该成员的 transcript（只读）
- **THEN** 右侧成员 pane 顶部 SHALL 显示 28px sticky 条（成员名称只读徽章 + `←` 收起按钮），详见"成员 pane 顶部固定名称标识"Scenario

#### Scenario: 成员 transcript 实时显示
- **WHEN** 成员 pane 展开且 session_id 已设置
- **THEN** 成员 pane SHALL 每 3s 轮询 `GET /api/swarm/agents/{agent_id}/transcript` 更新内容
- **THEN** 收到 `swarm_status` 事件含 `last_message` 字段时，SHALL 立即更新预览（无需等待轮询）
- **THEN** 自动滚动行为遵循"智能自动滚动"Scenario（不强制始终 scroll 到底部）

#### Scenario: 成员 session_id 未就绪时 chip 禁用
- **WHEN** 成员 session_id 为 null（Agent 尚未 spawn）
- **THEN** 该成员 chip SHALL 显示 `⏳` 图标，透明度 0.5，`pointer-events: none`（不可点击）
- **THEN** 成员选择栏 SHALL 显示"正在启动团队..."灰色提示文字，直到至少一个 chip 激活

#### Scenario: 智能自动滚动（不打断用户阅读）
- **WHEN** 用户在成员 pane 内向上滚动超过 100px
- **THEN** 自动滚动 SHALL 暂停，并在右下角显示"↓ 新内容"悬浮按钮
- **WHEN** 用户点击"↓ 新内容"或手动滚回底部（距底部 < 100px）
- **THEN** 自动滚动 SHALL 恢复

#### Scenario: 分栏分隔线与 resize
- **WHEN** LeaderPane 和 SwarmMemberPane 同时显示
- **THEN** 两栏之间 SHALL 显示 `1px solid #313244` 分隔线
- **THEN** 鼠标悬停分隔线时 cursor SHALL 变为 `col-resize`，支持拖动调节比例（最小每栏 30%）

#### Scenario: 成员 pane 顶部固定名称标识（轻量 sticky）
- **WHEN** 右侧 SwarmMemberPane 显示且用户滚动内容
- **THEN** pane 顶部 SHALL 显示一个轻量 sticky 条（高 28px）：成员名称 chip 副本（只读徽章样式）+ `←` 收起按钮（右对齐）
- **THEN** 该 sticky 条 SHALL 随滚动固定在视口，确保用户任何时候都知道当前看的是哪个成员
- **THEN** 点击 `←` 收起按钮与点击 ✕ chip 效果相同（恢复全宽 Leader 视图）

#### Scenario: 选中 chip 展开位置不影响其他 chip 布局
- **WHEN** 用户选中某成员 chip
- **THEN** 被选中 chip 的展开信息 SHALL 显示在选择栏**右对齐固定区域**（不在原 chip 位置就地展开）
- **THEN** 其他成员 chip 的位置 SHALL NOT 因选中操作而移动（避免布局跳动）

#### Scenario: chip 溢出横向滚动
- **WHEN** 成员数量 > 4，chips 超出选择栏宽度
- **THEN** 选择栏 SHALL 横向滚动（`overflow-x: auto`，隐藏滚动条）
- **THEN** 每个 chip 最大宽度 120px，超出名称截断 + `...`，hover 显示完整名称 tooltip

#### Scenario: 取消选中成员，返回全宽视图
- **WHEN** 用户点击已选中的成员 chip 或点击 ✕ 关闭按钮
- **THEN** 分栏 SHALL 收起，ChatPage 恢复全宽 Leader 视图
- **THEN** 成员 transcript 轮询 SHALL 停止

#### Scenario: 收到 swarm_status 事件刷新状态
- **WHEN** WebSocket 收到 `swarm_status` 事件
- **THEN** 成员选择栏中各成员 chip 的状态徽章 SHALL 立即更新（active/idle/stopped）
- **THEN** 右侧成员 pane（若展开）SHALL 更新状态徽章和 `last_message` 预览

#### Scenario: 任务完成状态更新
- **WHEN** swarmStore 中所有成员状态均变为 idle 或 stopped
- **THEN** 成员选择栏右侧 SHALL 显示 `✅ 全部完成` 标记（而非 pane header，因 pane 无独立 header）
- **THEN** ChatView header 中任务摘要徽章 SHALL 更新为 `✅` 完成状态

#### Scenario: 窄屏单栏切换
- **WHEN** 屏幕宽度 < 900px 且用户选中了成员（分栏触发）
- **THEN** 系统 SHALL NOT 同时压缩两栏至不可读（不硬性 50/50）
- **THEN** 成员选择栏**左侧** SHALL 显示 "← Leader / {成员名} →" Toggle 按钮（与 task 6.4 一致）
- **THEN** 默认显示 Leader pane，点击 Toggle 切换到成员 pane
