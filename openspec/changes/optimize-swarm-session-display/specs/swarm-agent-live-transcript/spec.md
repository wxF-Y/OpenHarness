## ADDED Requirements

### Requirement: 内容区展示每个 Agent 成员的实时执行内容
当团队处于 running 或 idle 状态时，SwarmPage 的内容区 SHALL 自动切换为"团队进展"全览视图，为每个 Agent 成员渲染一个独立的可折叠面板，展示该成员的 transcript（对话历史）。

#### Scenario: 团队运行中显示多 Agent 面板
- **WHEN** teamState 为 `running` 或 `idle`，且 `selectedMember` 为 null
- **THEN** 右侧内容区 SHALL 显示"团队进展"全览视图，包含与团队成员数量相等的 Agent 面板
- **THEN** 每个面板 SHALL 显示该 Agent 的名称、当前状态徽章（active/idle/stopped）以及 transcript 内容

#### Scenario: 全览视图顶部显示整体进度摘要
- **WHEN** "团队进展"全览视图显示，teamState 为 `running`
- **THEN** 全览顶部 SHALL 显示一行摘要："N 个 Agent 运行中 / M 个已完成"
- **WHEN** teamState 为 `idle`
- **THEN** 摘要栏 SHALL 显示"✅ 全部完成（共 N 个 Agent）"

#### Scenario: Agent 面板可折叠，active 状态默认展开
- **WHEN** "团队进展"全览视图首次渲染
- **THEN** `active` 状态的 Agent 面板 SHALL 默认展开
- **THEN** `idle` / `stopped` 状态的 Agent 面板 SHALL 默认折叠
- **WHEN** 用户点击某个 Agent 面板的折叠/展开按钮
- **THEN** 该面板的 transcript 区域 SHALL 切换显示/隐藏状态

#### Scenario: transcript 加载中显示骨架占位
- **WHEN** Agent 面板展开但 transcript 请求尚未返回
- **THEN** 面板 SHALL 显示加载中骨架占位（如三行灰色横条或"加载中…"文案），不显示空白

#### Scenario: transcript 请求失败时显示错误提示
- **WHEN** `GET /api/swarm/agents/{agent_id}/transcript` 返回非 2xx 或网络超时
- **THEN** 面板 SHALL 显示"加载失败，点击重试"（可点击触发重新拉取），不崩溃

#### Scenario: 收到 swarm_status 事件时自动刷新 transcript
- **WHEN** WebSocket 收到 `swarm_status` 事件，且某 Agent 的状态发生变化（active/idle/stopped）
- **THEN** 对应 Agent 的面板 SHALL 重新拉取 `/api/swarm/agents/{agent_id}/transcript`
- **THEN** 若该 Agent 当前已有飞行中的 transcript 请求，则 SHALL 跳过本次拉取（去重）

#### Scenario: transcript 为空时的占位显示
- **WHEN** Agent 面板已展开但 transcript 返回空列表
- **THEN** 面板 SHALL 显示占位文案（如"暂无执行记录"），不显示空白区域

#### Scenario: 团队尚未启动时不显示 Agent 面板
- **WHEN** teamState 为 `empty` 或 `configured`
- **THEN** 内容区 SHALL NOT 显示"团队进展"全览视图
- **THEN** 内容区 SHALL 显示原有的"选择 Agent 查看详情"占位或 Agent 成员配置视图

#### Scenario: 从全览切换到单 Agent 详情视图
- **WHEN** 用户在全览视图中点击某个 Agent 成员卡片（或在中间列成员卡片中点击选中）
- **THEN** 内容区 SHALL 切换为单 Agent 三标签视图（Transcript / Mailbox / 角色定义）
- **THEN** 视图顶部 SHALL 显示"← 返回全览"按钮

#### Scenario: 从单 Agent 详情返回全览
- **WHEN** 用户点击"← 返回全览"按钮
- **THEN** `selectedMember` 被清空，内容区 SHALL 返回"团队进展"全览视图
- **THEN** 全览视图中各 Agent 的 transcript 状态 SHALL 保持返回前的内容（不重新拉取）

#### Scenario: transcript 数据缓存不因切换视图而丢失
- **WHEN** 用户从全览切换到单 Agent 详情再返回全览
- **THEN** 各 Agent 的 transcript 缓存 SHALL 保留，不触发重复网络请求
- **THEN** 若 swarm_status 事件在切换期间触发，返回全览后 SHALL 显示最新 transcript

