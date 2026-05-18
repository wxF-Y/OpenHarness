## MODIFIED Requirements

### Requirement: 团队列表展示
SwarmPage 的团队列表区域 SHALL 在标题旁显示"+"按钮，点击打开团队创建向导（替代原有简单弹窗）。空状态 SHALL 显示引导文字"点击 + 创建你的第一个 Swarm 团队"。

#### Scenario: 空状态引导
- **WHEN** 团队列表为空
- **THEN** 在列表区域显示引导文字和"创建团队"按钮，不只是"无团队"文字

#### Scenario: 有团队时的列表
- **WHEN** 已有一个或多个团队
- **THEN** 显示团队名、成员数、创建时间，点击选中高亮

## ADDED Requirements

### Requirement: 成员状态面板
选中团队后，成员列表 SHALL 显示每个成员的状态图标（running/idle/stopped）、角色名、和"查看对话"入口。

#### Scenario: 查看成员 transcript
- **WHEN** 用户点击成员卡片的"对话"按钮
- **THEN** 右侧面板切换为该成员的 transcript（Markdown 渲染）

### Requirement: 启动 Swarm 提示
团队详情页 SHALL 显示启动提示：若团队有成员但无 `session_id`（尚未运行），显示横幅"在 Chat 中发起：/swarm start <team_name>"，说明如何激活该团队。

### Requirement: 一键启动 Swarm
团队处于 configured 状态时，详情面板 SHALL 显示横幅，提供任务描述输入框和"启动团队 →"按钮，用户点击后无需输入任何命令即可启动 Swarm。

#### Scenario: 一键启动团队
- **WHEN** 用户在 configured 状态横幅填写任务描述并点击"启动团队 →"
- **THEN** 系统在后台创建 Chat session 并 autosubmit `/swarm start <team> <task_desc>` 命令，跳转到 Chat 页时命令已在执行中；任务描述为空时命令回退为 `/swarm start <team>`

#### Scenario: 启动中加载态
- **WHEN** 用户点击"启动团队 →"
- **THEN** 按钮立即变为"⟳ 启动中..."并禁用，直至导航完成

#### Scenario: 开始新任务（从完成状态重启）
- **WHEN** 用户在完成横幅点击"开始新任务"
- **THEN** UI 切换回 configured 横幅（`forceConfiguredView` 覆盖 idle 状态），任务描述草稿清空；下次 autosubmit 创建新 session，原成员 session_id 不受影响

### Requirement: 运行中自动监控
SwarmPage 在团队处于 running 状态时 SHALL 每 15 秒自动刷新成员状态，并提供手动刷新按钮。

#### Scenario: 自动轮询刷新
- **WHEN** 选中团队处于 running 状态（至少一个成员 `session_id≠null` + `status=active`）
- **THEN** 每 15 秒调用 `GET /api/swarm/teams/{team}` 刷新成员状态，成员卡片无刷新地更新状态图标

#### Scenario: 离开页面停止轮询
- **WHEN** 用户离开 Swarm 页面或切换到其他团队
- **THEN** 停止当前轮询计时器

### Requirement: 成员角色定义查看
SwarmPage 成员详情面板 SHALL 提供"角色定义"Tab，显示该成员的 system_prompt（Markdown 渲染）。

#### Scenario: 查看成员角色定义
- **WHEN** 成员 `prompt` 字段非空，用户点击"📄 角色定义"Tab
- **THEN** 面板显示成员 system_prompt 的 Markdown 渲染内容

#### Scenario: 无角色定义时的占位
- **WHEN** 成员 `prompt` 为空
- **THEN** "📄"图标不显示；Tab 内容显示"未配置角色定义"

### Requirement: 任务完成引导
当团队所有成员均已运行过（`session_id≠null`）且全部处于 idle/stopped 状态时，SwarmPage SHALL 显示任务完成横幅，提供"查看结果"和"开始新任务"入口。

#### Scenario: 显示完成横幅
- **WHEN** 选中团队所有成员 `session_id≠null` 且 `status` 全为 `idle` 或 `stopped`
- **THEN** 成员列表上方显示"✅ 任务已完成"横幅，含"查看 Lead 对话"和"开始新任务"按钮

#### Scenario: 查看 Lead 对话
- **WHEN** 用户点击"查看 Lead 对话"
- **THEN** 自动选中 `lead_agent_id` 对应的成员并切换到 Transcript Tab（无 lead 时选第一个有 session_id 的成员）

#### Scenario: 开始新任务
- **WHEN** 用户点击"开始新任务"
- **THEN** 清空该团队的任务描述草稿，将 UI 切换回 configured 横幅（纯前端状态）
