## ADDED Requirements

### Requirement: Web UI 提供首次使用 Onboarding 向导
Web UI SHALL 检测首次使用状态（无 API Key 配置），对聊天功能展示强制向导，对其他功能展示软提示横幅，引导用户完成 Provider 选择、凭据配置、项目初始化（可选）和功能导览。

#### Scenario: 访问聊天页时强制跳转 Onboarding
- **WHEN** 用户访问 `/chat/*` 路由，`GET /api/onboarding/status` 返回 `auth_configured: false`
- **THEN** 路由守卫强制跳转到 `/onboarding`，不展示聊天界面

#### Scenario: 访问非聊天页时展示软提示横幅
- **WHEN** 用户访问 `/memory`、`/skills`、`/cron` 等非聊天路由，`auth_configured: false`
- **THEN** 页面正常渲染，但顶部显示黄色 `AuthBanner`："⚠️ 未配置 AI Provider，对话功能不可用。 [立即配置 →]"，点击按钮跳转 /onboarding

#### Scenario: Onboarding 完成后不再重定向
- **WHEN** `GET /api/onboarding/status` 返回 `auth_configured: true`（服务端状态为准）
- **THEN** OnboardingGuard 通过，AuthBanner 不显示，正常渲染所有功能

#### Scenario: Step 1 — 欢迎与环境诊断
- **WHEN** 用户进入 /onboarding Step 1
- **THEN** 展示 HLAgent 品牌标识；使用 `GET /api/onboarding/status` 已有数据（无需额外请求）展示：Gateway 版本、Python 版本、当前 cwd；若已有配置的 provider 显示"已检测到 {provider} 配置"；底部显示"开始配置"按钮

#### Scenario: Step 2 — 选择 AI Provider
- **WHEN** 用户进入 Step 2
- **THEN** 调用 `GET /api/settings/profiles` 展示 Provider 卡片：Anthropic API Key（🌟 推荐标签）、Claude Subscription（需 CLI）、OpenAI Compatible、GitHub Copilot（需 CLI）、自定义；用户点击卡片选中后高亮，点击"下一步"进入 Step 3

#### Scenario: Step 3 — 输入 Anthropic API Key
- **WHEN** 用户在 Step 2 选择了"Anthropic API Key"
- **THEN** Step 3 展示密码型输入框（占位符 "sk-ant-api-..."）+ 说明文字"从 console.anthropic.com 获取 API Key"；点击"保存"调用 `POST /api/auth/login{provider:"anthropic", api_key:"..."}`；成功（HTTP 200）时显示"✓ 已保存（将在首次对话时验证有效性）"，自动进入 Step 4

#### Scenario: Step 3 — API Key 保存失败
- **WHEN** `POST /api/auth/login` 返回非 200 状态
- **THEN** 显示红色错误："保存失败，请重试"；输入框保持当前内容，用户可修改后重试

#### Scenario: Step 3 — OpenAI Compatible Provider
- **WHEN** 用户在 Step 2 选择了"OpenAI Compatible"
- **THEN** Step 3 展示 base_url 输入框（必填，占位符 "https://api.openai.com/v1"）+ API Key 输入框；两者均填写后"保存"才可点击

#### Scenario: Step 3 — Claude Subscription（OAuth 类）
- **WHEN** 用户在 Step 2 选择了"Claude Subscription"
- **THEN** Step 3 展示说明："此 Provider 需通过 CLI 完成 OAuth 绑定，运行：`oh auth claude-login`"，提供"刷新检查"按钮；点击刷新按钮重新调用 `GET /api/onboarding/status`，若 `auth_configured=true` 则显示"✓ 已检测到认证"并自动进入 Step 4

#### Scenario: Step 3 — 跳过 Provider 直接进入后续（高级用户）
- **WHEN** 用户点击 Step 3 底部的"跳过，稍后配置"链接
- **THEN** 直接进入 Step 4（允许完成 Onboarding，AuthBanner 后续仍会提示）

#### Scenario: Step 4 — 项目初始化（可选）
- **WHEN** 用户进入 Step 4
- **THEN** 展示：若 `project_initialized=false` 显示提示"为当前目录（{cwd}）创建 CLAUDE.md 项目指令文件和 .openharness/ 配置目录，帮助 AI 更好地理解你的项目"；若 `project_initialized=true` 显示"✓ 当前目录已初始化"；提供 [跳过] [初始化项目] 按钮

#### Scenario: Step 4 — 执行项目初始化
- **WHEN** 用户点击"初始化项目"
- **THEN** 调用 `POST /api/onboarding/init-project`（新的独立 REST 端点，不需要创建 WebSocket 会话）；成功后显示创建文件列表（CLAUDE.md、.openharness/memory/MEMORY.md 等）；自动进入 Step 5

#### Scenario: Step 5 — 功能导览
- **WHEN** 用户进入 Step 5
- **THEN** 展示功能介绍卡片网格（2×3）：💬 Chat / 🧠 Memory / ⏰ Cron / 🤝 Swarm / ✅ Tasks / ⚡ Skills；每卡片含标题、一句描述、图标；底部显示"开始使用 HLAgent →"按钮

#### Scenario: 点击"开始使用"完成 Onboarding
- **WHEN** 用户在 Step 5 点击"开始使用 HLAgent →"
- **THEN** 设置 `localStorage.hlagent_tour_seen=true`（仅标记"导览已看"，不作为 auth 检查依据）；调用 `POST /api/sessions` 创建新会话并跳转到 `/chat/{sessionId}`

#### Scenario: 已配置 Provider 的用户手动访问 /onboarding
- **WHEN** 用户手动导航到 /onboarding（auth 已配置）
- **THEN** 展示"✓ 你已完成初始化"提示，显示当前 active_profile 和 auth_status，提供"进入应用"和"重新配置 Provider"两个按钮

#### Scenario: API Key 无效的后续处理
- **WHEN** 用户完成 Onboarding 存储了错误的 API Key，首次在 ChatPage 创建 WS 连接
- **THEN** `build_runtime()` 在 Gateway 内部失败，WS 连接关闭或 ErrorToast 显示"API Key 无效，请前往设置重新配置"，同时 AuthBanner 在非聊天页重新显示

### Requirement: Web UI 全局三栏布局
Web UI SHALL 采用顶部导航栏 + 左侧栏 + 主内容区 + 右侧面板的三栏布局，左侧栏和右侧面板均可折叠。

#### Scenario: 默认布局渲染
- **WHEN** 用户进入聊天页
- **THEN** 左侧栏（220px）显示会话列表和状态信息，主内容区（flex-grow）显示对话，右侧面板（280px）显示 TaskBoard 和 SwarmPanel，底部 StatusBar（32px）全宽

#### Scenario: 折叠左侧栏
- **WHEN** 用户点击 TopNav 的 "≡" 菜单按钮
- **THEN** 左侧栏折叠为仅图标模式（56px），主内容区扩展；再次点击展开

#### Scenario: 折叠右侧面板
- **WHEN** 右侧面板无内容（无任务、无 swarm 活动）
- **THEN** 右侧面板自动隐藏，主内容区占满宽度

### Requirement: Web UI 提供欢迎/首页
Web UI SHALL 在路由 `/` 展示欢迎页面，包含产品名称、快速开始按钮，以及最近会话列表（如有）。

#### Scenario: 首次访问欢迎页
- **WHEN** 用户访问 `http://localhost:5173/`（无历史会话）
- **THEN** 展示 HLAgent 品牌标识、"开始新对话"按钮、功能介绍卡片（列出 Agent 能力：工具调用/记忆/技能/Swarm）

#### Scenario: 有历史会话时的欢迎页
- **WHEN** 用户访问欢迎页（有历史会话记录）
- **THEN** 展示最近 5 条会话摘要（时间、第一条消息预览），用户可点击直接恢复

### Requirement: Web UI 提供对话聊天页
Web UI SHALL 在路由 `/chat/:sessionId` 提供完整的 Agent 对话界面，对应 TUI 的 ConversationView + TranscriptPane。

#### Scenario: 展示对话历史
- **WHEN** 用户进入聊天页面
- **THEN** 加载并展示该会话的历史 transcript_item，区分 user/assistant/tool/system 角色，assistant 消息渲染 Markdown，tool+tool_result 配对为 ToolCallCard

#### Scenario: 实时显示 assistant 流式输出
- **WHEN** Gateway 推送 `assistant_delta` 事件
- **THEN** 消息区域实时追加新内容，无闪烁，自动滚动到底部；用户手动向上滚动后停止自动滚动，出现"↓ 回到底部"浮动按钮

#### Scenario: 展示工具调用卡片
- **WHEN** Gateway 推送 `tool_started` 事件
- **THEN** 在对话流中插入 ToolCallCard，显示工具名称、旋转 spinner、参数（JSON 格式，可折叠展开），卡片左侧有工具图标

#### Scenario: 工具调用完成更新卡片
- **WHEN** Gateway 推送 `tool_completed` 事件
- **THEN** ToolCallCard spinner 变为 ✓（成功绿色）或 ✗（失败红色），展示工具输出（最多 500 字符，超出显示"展开查看完整输出"）

### Requirement: Web UI 提供消息输入组件
Web UI SHALL 在聊天页底部提供消息输入框，对应 TUI 的 Composer + PromptInput，支持多行输入、发送/中断切换、命令补全。

#### Scenario: 发送消息
- **WHEN** 用户在输入框输入文本并按 Enter（或点击"发送"按钮）
- **THEN** 通过 WebSocket 发送 `submit_line` 请求，输入框清空，发送按钮变为红色"■ 停止"按钮，输入框变为 dimmed 禁用状态

#### Scenario: 多行输入
- **WHEN** 用户在输入框按 Shift+Enter
- **THEN** 输入框换行，高度自动增加（最多 8 行），不发送消息

#### Scenario: 中断 Agent 执行
- **WHEN** 用户在 Agent 执行期间点击"■ 停止"按钮或按 Escape
- **THEN** 发送 `interrupt` 请求，Agent 停止后输入框恢复可用状态，"■ 停止"按钮恢复为"发送"

#### Scenario: 历史消息导航
- **WHEN** 输入框为空且用户按上箭头键
- **THEN** 输入框填入上一条发送的消息；继续按上箭头显示更早的消息；按下箭头返回更新的消息或空

#### Scenario: 空消息不发送
- **WHEN** 用户提交空消息
- **THEN** 不发送请求，输入框保持焦点

#### Scenario: 输入 / 触发命令补全
- **WHEN** 用户在输入框键入 "/"
- **THEN** 输入框正上方弹出命令补全层（CommandPicker），列出以 "/" 开头匹配的命令，最多 10 条

### Requirement: Web UI 提供行内命令补全（CommandPicker）
Web UI SHALL 在用户输入以 "/" 开头的文本时，在输入框正上方显示命令补全列表（而非全局命令面板）。

#### Scenario: 命令列表导航
- **WHEN** CommandPicker 显示且用户按 ↑↓ 方向键
- **THEN** 高亮项在列表中移动，不影响输入框内容

#### Scenario: Tab 补全
- **WHEN** CommandPicker 显示且用户按 Tab
- **THEN** 输入框填入当前高亮命令（不提交），用户可继续输入参数

#### Scenario: 选中特殊命令触发 SelectModal
- **WHEN** 用户选中 /model、/theme、/provider、/output-style、/permissions、/resume、/effort、/passes、/turns、/fast、/vim、/voice 之一并按 Enter
- **THEN** 发送 `select_command` 请求，CommandPicker 关闭，等待 Gateway 推送 `select_request` 事件，触发 SelectModal

#### Scenario: 选中 /plan 命令
- **WHEN** 用户选中 /plan 并按 Enter
- **THEN** 若当前 permission_mode 为 "plan"，发送 `submit_line "\/plan off"`；否则发送 `submit_line "\/plan on"`

#### Scenario: 按 Esc 关闭补全
- **WHEN** CommandPicker 显示且用户按 Escape
- **THEN** CommandPicker 关闭，输入框清空

### Requirement: Web UI 提供全局命令面板（Ctrl+K）
Web UI SHALL 提供全局命令面板，通过 `Ctrl+K`（Windows/Linux）或 `Cmd+K`（Mac）触发，支持模糊搜索。

#### Scenario: 打开命令面板
- **WHEN** 用户按 `Ctrl+K` / `Cmd+K`
- **THEN** 居中弹出全局命令面板，自带搜索框（自动聚焦），列出所有可用命令

#### Scenario: 搜索并执行命令
- **WHEN** 用户在命令面板输入关键字并按 Enter 选择命令
- **THEN** 命令面板关闭，若是特殊命令触发 SelectModal，否则发送 `select_command` 请求

### Requirement: Web UI 提供任务面板（TaskBoard）
Web UI SHALL 在右侧面板提供任务看板，同时支持 `tasks_snapshot`（结构化）和 `todo_update`（todo_markdown Markdown）两种数据源。

#### Scenario: 结构化任务状态实时更新
- **WHEN** Gateway 推送 `tasks_snapshot` 事件
- **THEN** TaskBoard 展示任务列表，每条任务显示：状态图标（⏳pending / 🔄in_progress / ✅completed）+ 描述文字

#### Scenario: Markdown 任务列表更新
- **WHEN** Gateway 推送 `todo_update`，`todo_markdown` 含 `- [ ] / - [x]` 格式
- **THEN** TaskBoard 切换为 Markdown 渲染模式，复选框样式展示，已完成项显示删除线

#### Scenario: 无任务时的空状态
- **WHEN** 当前会话没有任务且无 todo_markdown
- **THEN** TaskBoard 显示"暂无任务"空状态，右侧面板可折叠

### Requirement: Web UI 提供群集管理面板（SwarmPanel）
Web UI SHALL 在右侧面板展示 Swarm 状态，收到 `swarm_status` 事件时更新。可折叠（对应 TUI Ctrl+W）。

#### Scenario: 展示 Swarm 成员
- **WHEN** `swarm_teammates` 有成员
- **THEN** 右侧面板显示 SwarmPanel，每个 teammate 一行：状态图标（🟢running / 🟡idle / ✅done / 🔴error）+ name + 当前任务描述 + 运行时长

#### Scenario: 展示 Swarm 通知
- **WHEN** `swarm_notifications` 有新通知
- **THEN** SwarmPanel 通知区域显示从（from）+ 消息内容 + 时间戳，同时 StatusBar 显示 `🔔 n` 徽章

#### Scenario: 折叠 SwarmPanel
- **WHEN** 用户点击 SwarmPanel 折叠按钮
- **THEN** SwarmPanel 收起为一行摘要（"⚡ Swarm: n agents (k active)"），点击再展开

### Requirement: Web UI 提供左侧栏（Sidebar）
Web UI SHALL 提供左侧栏，包含五个子面板（对应 TUI SidePanel 的五个子组件）：Status、Sessions、MCP、Bridge、Commands。

#### Scenario: Status 子面板
- **WHEN** Sidebar 展开
- **THEN** 显示当前 AppState 信息：model、provider、auth_status、cwd、vim_enabled、voice_enabled、fast_mode、effort、passes

#### Scenario: Sessions 子面板
- **WHEN** 用户在 Sidebar Sessions 区域
- **THEN** 显示历史会话列表（从 GET /api/sessions 获取），点击会话跳转到 /chat/:id

#### Scenario: MCP 子面板
- **WHEN** mcp_servers 数据从 `ready`/`state_snapshot` 事件加载
- **THEN** 显示每个 MCP server：name、state（connected/failed）、transport、tool_count、resource_count

#### Scenario: Bridge 子面板
- **WHEN** bridge_sessions 数据从 `ready`/`state_snapshot` 事件加载
- **THEN** 显示每个 bridge session：session_id、command、pid、status

### Requirement: Web UI 提供状态栏
Web UI SHALL 在页面底部展示状态栏（32px），包含：WebSocket 连接状态、模型名、计划模式标签、fast mode 指示、MCP 状态徽章、任务数量、token 用量、Swarm 通知徽章。

#### Scenario: 连接正常时完整状态显示
- **WHEN** WebSocket 连接正常
- **THEN** 状态栏左起：● 绿色点 | 模型名 | [PLAN MODE 黄色标签，仅 plan mode 时] | ⚡fast（仅 fast mode 时）| MCP:n●（绿色）| tasks:n | ↓input ↑output tokens | 🔔swarm:n（仅有 swarm 时）

#### Scenario: WebSocket 断开时提示
- **WHEN** WebSocket 连接断开（非 shutdown 导致）
- **THEN** 状态栏 ● 变红，显示"已断开"，右侧出现"重连"按钮（触发手动重连）

#### Scenario: 计划模式指示
- **WHEN** `plan_mode_change` 推送 plan_mode="plan"
- **THEN** 状态栏出现黄色背景 [PLAN MODE] 标签；若当前活跃工具是写操作（Bash/Write/Edit/MultiEdit），同时显示红色 "🚫 {toolName} blocked"

### Requirement: Web UI 提供权限授权弹窗
Web UI SHALL 在收到 `modal_request(kind="permission")` 时弹出权限弹窗。支持键盘 Y/N 响应。

#### Scenario: Agent 请求权限授权
- **WHEN** Gateway 推送 `modal_request`，`modal.kind="permission"`，`modal.tool_name="bash"`，`modal.reason="rm -rf ./tmp"`
- **THEN** 弹出居中 PermissionModal：标题"⚠️ 权限请求"、工具名称、操作说明、[Y 允许] [N 拒绝] 两个按钮，背景遮罩

#### Scenario: 键盘响应权限请求
- **WHEN** PermissionModal 显示时用户按 Y 或 N
- **THEN** 等同于点击对应按钮，发送 `permission_response`

### Requirement: Web UI 处理问题弹窗（QuestionModal）
Web UI SHALL 在收到 `modal_request(kind="question")` 时弹出问题弹窗，等待用户输入文字后发送 `question_response`。

#### Scenario: Agent 向用户提问
- **WHEN** Gateway 推送 `modal_request`，`modal.kind="question"`，`modal.question="请输入项目名称"`
- **THEN** 弹出居中 QuestionModal：标题"💬 请回答"、问题文字、文字输入框（自动聚焦）、[确认] 按钮，按 Enter 提交

#### Scenario: 用户回答问题
- **WHEN** 用户输入答案并按 Enter 或点击"确认"
- **THEN** 发送 `question_response`（含 request_id、answer），弹窗关闭

### Requirement: Web UI 处理选项选择弹窗（SelectModal）
Web UI SHALL 在收到 `select_request` 事件时弹出选项列表弹窗，当前激活项高亮，支持键盘导航和数字快选。

#### Scenario: 模型切换选项弹窗
- **WHEN** Gateway 推送 `select_request`，`modal.title="Model"`，`select_options` 含多个模型选项
- **THEN** 弹出 SelectModal：标题"Model"，列表每项显示 value + description，当前 active 项有 ● 高亮；键盘 ↑↓ 导航，Enter 确认，1-9 快选，Esc 取消

#### Scenario: 用户选择新模型
- **WHEN** 用户选中某项并按 Enter（或点击）
- **THEN** 发送 `apply_select_command`（含 command、value），弹窗关闭

### Requirement: Web UI 显示上下文压缩进度（CompactProgressBar）
Web UI SHALL 在收到 `compact_progress` 事件时在对话区顶部展示进度提示横幅。

#### Scenario: 开始压缩时显示进度
- **WHEN** Gateway 推送 `compact_progress`，`compact_phase="compacting"`
- **THEN** 对话区顶部出现蓝色进度横幅（非阻断性），显示"正在压缩上下文… 第 {attempt} 次"，有动态省略号动画

#### Scenario: 压缩完成时隐藏
- **WHEN** Gateway 推送 `compact_progress`，`compact_phase="done"` 或后续 `transcript_item` 出现
- **THEN** CompactProgressBar 淡出消失（transition 300ms）

### Requirement: Web UI 处理清空对话指令（clear_transcript）
Web UI SHALL 在收到 `clear_transcript` 事件时清空对话显示区，保留会话连接。

#### Scenario: 接收清空指令
- **WHEN** Gateway 推送 `clear_transcript` 事件
- **THEN** TranscriptViewer 清空所有消息，显示"对话已清空"空状态提示

### Requirement: Web UI 处理 Todo Markdown 更新（todo_update）
Web UI SHALL 在收到 `todo_update` 事件时，用 `todo_markdown` 字段内容更新 TaskBoard。

#### Scenario: Agent 更新任务列表（Markdown 格式）
- **WHEN** Gateway 推送 `todo_update`，`todo_markdown="- [ ] 任务A\n- [x] 任务B"`
- **THEN** TaskBoard 渲染 Markdown 复选框列表：✓ 已完成项有绿色删除线，未完成项正常显示

### Requirement: Web UI 显示计划模式状态（PlanModeIndicator）
Web UI SHALL 在 StatusBar 中实时反映计划模式状态，收到 `plan_mode_change` 事件时更新。

#### Scenario: 进入计划模式
- **WHEN** Gateway 推送 `plan_mode_change`，`plan_mode="plan"` 或 `plan_mode="Plan Mode"`
- **THEN** StatusBar 出现黄色 [PLAN MODE] 标签；若同时有写操作工具正在执行，显示红色 "🚫 {toolName} blocked"

#### Scenario: 退出计划模式（flash 动画）
- **WHEN** Gateway 推送 `plan_mode_change`，`plan_mode!="plan"`
- **THEN** StatusBar 显示绿色 "PLAN MODE OFF" 文字 800ms 后消失（对应 TUI flash 效果）

### Requirement: Web UI 显示 Swarm 详细状态
Web UI SHALL 在右侧面板 SwarmPanel 中完整展示 `swarm_teammates` 和 `swarm_notifications`。

#### Scenario: 展示 Swarm 成员状态
- **WHEN** Gateway 推送 `swarm_status`，含 `swarm_teammates` 数组（每项含 name/status/duration/task）
- **THEN** SwarmPanel 展示每个 teammate：状态图标 + name + task 描述 + formatDuration(duration)

#### Scenario: 展示 Swarm 通知徽章
- **WHEN** `swarm_notifications` 有新通知
- **THEN** StatusBar 右侧显示 🔔 n（n = 未读通知数）徽章，SwarmPanel 通知区显示 from + message + 相对时间

### Requirement: Web UI 显示 MCP 连接状态
Web UI SHALL 在 StatusBar 中展示 MCP 状态，从 `state_snapshot`/`ready` 事件的 `mcp_connected`/`mcp_failed` 字段获取。

#### Scenario: MCP 正常连接时状态显示
- **WHEN** `mcp_connected > 0`，`mcp_failed = 0`
- **THEN** StatusBar 显示绿色 "MCP:n●"（n 为连接数）；鼠标悬浮显示服务器详情 tooltip

#### Scenario: MCP 部分失败时警告
- **WHEN** `mcp_failed > 0`
- **THEN** StatusBar 显示 "MCP:n● m✗"（m 为失败数，红色）

### Requirement: Web UI 显示错误通知（ErrorToast）
Web UI SHALL 在收到 `error` 事件时在右上角显示非阻断性 Toast 通知。

#### Scenario: Agent 运行时错误通知
- **WHEN** Gateway 推送 `error` 事件，`message="工具执行失败：权限不足"`
- **THEN** 右上角出现红色 Toast：错误图标 + 消息文字 + ×关闭按钮，5 秒后自动消失；多个 error 时堆叠显示

### Requirement: Web UI 优雅处理 shutdown 事件
Web UI SHALL 在收到 `shutdown` 事件时显示会话结束提示，禁用输入，不触发自动重连。

#### Scenario: 会话正常关闭
- **WHEN** Gateway 推送 `shutdown` 事件
- **THEN** TranscriptViewer 底部追加灰色"— 会话已结束 —"分隔线；输入框禁用并显示"会话已结束"；StatusBar ● 变灰色（不是红色），不触发自动重连

### Requirement: Web UI 通过 WebSocket 实时同步状态
Web UI SHALL 接收 BackendEvent 流并通过 Zustand store 管理全局状态。

#### Scenario: 接收 state_snapshot 更新全局状态
- **WHEN** Gateway 推送 `state_snapshot` 事件
- **THEN** sessionStore 整体替换 AppState（含 model、provider、auth_status、cwd、vim_enabled、voice_enabled、fast_mode、effort、passes、mcp_connected、mcp_failed、bridge_sessions、output_style、keybindings），所有订阅组件自动重渲染

#### Scenario: WebSocket 意外断开后自动重连
- **WHEN** WebSocket 连接意外中断（非 shutdown 导致）
- **THEN** 以指数退避策略重试（1s、2s、4s、8s…最大 30s），StatusBar 显示重连倒计时

### Requirement: Web UI 使用深色主题
Web UI SHALL 默认使用深色主题（#1e1e2e 背景，类 VSCode / Catppuccin Mocha 风格），支持切换亮色主题。

#### Scenario: 默认深色主题渲染
- **WHEN** 用户首次访问 Web UI
- **THEN** 界面以 `#1e1e2e` 背景、`#cdd6f4` 文字渲染，代码块使用 `#313244` 背景，可读性符合 WCAG AA（对比度 ≥ 4.5:1）

#### Scenario: 通过 /theme 命令切换主题
- **WHEN** 用户执行 /theme 命令，SelectModal 选择 "light"
- **THEN** Gateway 发送 state_snapshot 更新 theme 字段，Web UI 切换为亮色主题（#ffffff 背景）

Web UI SHALL 在路由 `/` 展示欢迎页面，包含产品名称、快速开始按钮，以及最近会话列表（如有）。

#### Scenario: 首次访问欢迎页
- **WHEN** 用户访问 `http://localhost:5173/`（无历史会话）
- **THEN** 展示 HLAgent 品牌标识、"开始新对话"按钮、功能介绍卡片

#### Scenario: 有历史会话时的欢迎页
- **WHEN** 用户访问欢迎页（有历史会话记录）
- **THEN** 展示最近 5 条会话摘要，用户可点击直接恢复

### Requirement: Web UI 提供对话聊天页
Web UI SHALL 在路由 `/chat/:sessionId` 提供完整的 Agent 对话界面，对应 TUI 的 ConversationView + TranscriptPane。

#### Scenario: 展示对话历史
- **WHEN** 用户进入聊天页面
- **THEN** 加载并展示该会话的历史 transcript_item，区分 user/assistant/tool/system 角色，assistant 消息渲染 Markdown

#### Scenario: 实时显示 assistant 流式输出
- **WHEN** Gateway 推送 `assistant_delta` 事件
- **THEN** 消息区域实时追加新内容，无闪烁，自动滚动到底部

#### Scenario: 展示工具调用卡片
- **WHEN** Gateway 推送 `tool_started` 事件
- **THEN** 在对话流中插入工具调用卡片，显示工具名称和参数（可折叠展开）

#### Scenario: 工具调用完成更新卡片
- **WHEN** Gateway 推送 `tool_completed` 事件
- **THEN** 对应工具卡片更新状态（success/error），展示工具输出（截断过长内容）

### Requirement: Web UI 提供消息输入组件
Web UI SHALL 在聊天页底部提供消息输入框，对应 TUI 的 Composer + PromptInput。

#### Scenario: 发送消息
- **WHEN** 用户在输入框输入文本并按 Enter（或点击发送按钮）
- **THEN** 通过 WebSocket 发送 `submit_line` 请求，输入框清空，发送按钮变为"中断"按钮

#### Scenario: 中断 Agent 执行
- **WHEN** 用户在 Agent 执行期间点击"中断"按钮
- **THEN** 发送 `interrupt` 请求，Agent 停止后输入框恢复可用状态

#### Scenario: 空消息不发送
- **WHEN** 用户提交空消息
- **THEN** 不发送请求，输入框获得焦点提示

### Requirement: Web UI 提供任务面板
Web UI SHALL 提供任务看板面板，对应 TUI 的 TodoPanel，展示 Agent 当前执行的任务列表及状态。

#### Scenario: 任务状态实时更新
- **WHEN** Gateway 推送 `tasks_snapshot` 事件
- **THEN** 任务面板更新，以卡片/列表形式展示每个任务的 status（pending/in_progress/completed）和描述

#### Scenario: 无任务时的空状态
- **WHEN** 当前会话没有任务
- **THEN** 展示"暂无任务"空状态提示

### Requirement: Web UI 提供群集管理页（基础版）
Web UI SHALL 在路由 `/swarm` 提供群集（Swarm）管理页面，对应 TUI 的 SwarmPanel（详细版见下方 SwarmPage 完整规格）。

#### Scenario: 展示 Agent 状态摘要（右侧面板 SwarmPanel）
- **WHEN** Gateway 推送 `swarm_status` 事件
- **THEN** 右侧面板展示 teammates 状态行（🟢/🟡/✅/🔴 + name + task 摘要），点击跳转到 /swarm 详情页

#### Scenario: 查看 sub-agent 完整内容
- **WHEN** 用户在 /swarm 页点击某个 teammate 卡片
- **THEN** 加载并展示该 agent 的完整对话 transcript（通过 session_id 从 Gateway 获取）

### Requirement: Web UI 提供全局命令面板
Web UI SHALL 提供命令面板（Command Palette），对应 TUI 的 CommandPicker，通过 `Cmd+K` / `Ctrl+K` 快捷键触发。

#### Scenario: 打开命令面板
- **WHEN** 用户按 `Ctrl+K`（Windows/Linux）或 `Cmd+K`（Mac）
- **THEN** 命令面板弹出，显示可用命令列表，输入框聚焦

#### Scenario: 搜索并执行命令
- **WHEN** 用户在命令面板输入关键字并选择命令
- **THEN** 命令面板关闭，选中命令通过 WebSocket 发送 `select_command` 请求执行

### Requirement: Web UI 提供状态栏
Web UI SHALL 在页面底部展示状态栏，对应 TUI 的 StatusBar + Footer，显示连接状态、当前模型、token 用量等信息。

#### Scenario: 连接正常时状态显示
- **WHEN** WebSocket 连接正常
- **THEN** 状态栏显示绿色连接指示、当前 AI 模型名称、本次会话 token 用量

#### Scenario: WebSocket 断开时提示
- **WHEN** WebSocket 连接断开
- **THEN** 状态栏显示红色断开提示，并提供"重新连接"按钮

### Requirement: Web UI 提供权限授权弹窗
Web UI SHALL 在收到权限请求事件时弹出授权对话框，对应 TUI 的 permission_dialog。

#### Scenario: Agent 请求权限授权
- **WHEN** Gateway 推送 `permission_request` 类型的 BackendEvent
- **THEN** 弹出模态框，展示操作描述和风险说明，提供"允许"/"拒绝"按钮

#### Scenario: 用户响应权限请求
- **WHEN** 用户点击"允许"或"拒绝"
- **THEN** 发送 `permission_response` 请求（含 `allowed: true/false`），弹窗关闭

### Requirement: Web UI 通过 WebSocket 实时同步状态
Web UI SHALL 使用 WebSocket 连接 Gateway，接收 BackendEvent 流并通过 Zustand store 管理全局状态，无需手动刷新页面。

#### Scenario: 接收 state_snapshot 更新全局状态
- **WHEN** Gateway 推送 `state_snapshot` 事件
- **THEN** Zustand store 整体替换为新快照数据，所有订阅该 store 的组件自动重渲染

#### Scenario: WebSocket 自动重连
- **WHEN** WebSocket 连接意外中断
- **THEN** Web UI 以指数退避策略（1s、2s、4s...最大 30s）自动重试连接

### Requirement: Web UI 使用深色主题
Web UI SHALL 默认使用深色主题（类 VSCode 风格），支持通过用户设置切换亮色主题。

#### Scenario: 默认深色主题渲染
- **WHEN** 用户首次访问 Web UI
- **THEN** 界面以深色背景（#1e1e2e 或类似色）渲染，文字可读性符合 WCAG AA 标准

### Requirement: Web UI 处理问题弹窗（QuestionModal）
Web UI SHALL 在收到 `modal_request(kind="question")` 事件时弹出问题应答弹窗，等待用户输入文字后发送 `question_response`。

#### Scenario: Agent 向用户提问
- **WHEN** Gateway 推送 `modal_request` 事件，`modal.kind="question"`，`modal.question="你确定要继续吗？"`
- **THEN** 弹出 QuestionModal，展示问题文字，提供文字输入框和"确认"按钮

#### Scenario: 用户回答问题
- **WHEN** 用户在 QuestionModal 输入答案并点击"确认"
- **THEN** 发送 `{"type": "question_response", "request_id": "xxx", "answer": "是的"}` 请求，弹窗关闭

### Requirement: Web UI 处理选项选择弹窗（SelectModal）
Web UI SHALL 在收到 `select_request` 事件时弹出选项列表弹窗，支持模型切换等操作，响应后发送 `apply_select_command`。

#### Scenario: 模型切换选项弹窗
- **WHEN** Gateway 推送 `select_request`，`modal.title="Model"`，`select_options` 含多个模型选项
- **THEN** 弹出 SelectModal，展示模型列表，当前激活模型高亮显示

#### Scenario: 用户选择新模型
- **WHEN** 用户在 SelectModal 选择某个模型并确认
- **THEN** 发送 `{"type": "apply_select_command", "command": "model", "value": "claude-opus-4-7"}` 请求，弹窗关闭

### Requirement: Web UI 显示上下文压缩进度（CompactProgressBar）
Web UI SHALL 在收到 `compact_progress` 事件时在对话区顶部展示上下文压缩进度提示。

#### Scenario: 开始压缩时显示进度
- **WHEN** Gateway 推送 `compact_progress`，`compact_phase="compacting"`
- **THEN** 在 ChatPage 顶部出现 CompactProgressBar，显示压缩阶段说明（如"正在压缩上下文..."）

#### Scenario: 压缩完成时隐藏进度条
- **WHEN** Gateway 推送 `compact_progress`，`compact_phase="done"` 或后续对话恢复
- **THEN** CompactProgressBar 自动消失

### Requirement: Web UI 处理清空对话指令（clear_transcript）
Web UI SHALL 在收到 `clear_transcript` 事件时清空当前对话显示区，保留会话连接。

#### Scenario: 接收清空指令
- **WHEN** Gateway 推送 `clear_transcript` 事件
- **THEN** TranscriptViewer 清空所有消息，显示空状态提示

### Requirement: Web UI 处理 Todo Markdown 更新（todo_update）
Web UI SHALL 在收到 `todo_update` 事件时，用 `todo_markdown` 字段内容更新 TaskBoard（以 Markdown 渲染展示）。

#### Scenario: Agent 更新任务列表
- **WHEN** Gateway 推送 `todo_update`，`todo_markdown` 含 Markdown 格式任务列表
- **THEN** TaskBoard 以 Markdown 渲染展示任务内容，若含复选框则展示完成/未完成状态

### Requirement: Web UI 显示计划模式状态（PlanModeIndicator）
Web UI SHALL 在 StatusBar 中显示当前计划模式状态，在收到 `plan_mode_change` 事件时实时更新。

#### Scenario: 进入计划模式
- **WHEN** Gateway 推送 `plan_mode_change`，`plan_mode="plan"`
- **THEN** StatusBar 显示"Plan Mode"标签，用醒目颜色（如黄色）高亮

#### Scenario: 退出计划模式
- **WHEN** Gateway 推送 `plan_mode_change`，`plan_mode="default"`
- **THEN** StatusBar 的计划模式标签消失

### Requirement: Web UI 显示 Swarm 详细状态
Web UI SHALL 在 SwarmDashboard 中完整展示 `swarm_status` 事件的 `swarm_teammates` 和 `swarm_notifications` 数据。

#### Scenario: 展示 Swarm 成员状态
- **WHEN** Gateway 推送 `swarm_status`，含 `swarm_teammates` 数组
- **THEN** SwarmDashboard 展示每个 teammate 的 id、name、status，在线状态用颜色区分

#### Scenario: 展示 Swarm 通知
- **WHEN** `swarm_notifications` 有新通知
- **THEN** SwarmDashboard 通知列表更新，同时在全局 StatusBar 显示通知数量徽章

### Requirement: Web UI 显示 MCP 连接状态
Web UI SHALL 在 StatusBar 中展示 MCP 服务器连接状态（`mcp_connected` 和 `mcp_failed` 字段），从 `state_snapshot` 事件获取。

#### Scenario: MCP 正常连接时状态显示
- **WHEN** `state_snapshot.mcp_connected > 0`，`mcp_failed = 0`
- **THEN** StatusBar 显示绿色 MCP 状态徽章和连接数量

#### Scenario: MCP 部分失败时警告
- **WHEN** `state_snapshot.mcp_failed > 0`
- **THEN** StatusBar 显示黄色 MCP 警告徽章，悬浮提示失败数量

### Requirement: Web UI 显示错误通知（ErrorToast）
Web UI SHALL 在收到 `error` 事件时显示非阻断性错误通知（Toast），不打断当前对话。

#### Scenario: Agent 运行时错误通知
- **WHEN** Gateway 推送 `error` 事件，`message="工具执行失败：权限不足"`
- **THEN** 右上角出现红色 Toast 通知，展示错误消息，5 秒后自动消失

### Requirement: Web UI 优雅处理 shutdown 事件
Web UI SHALL 在收到 `shutdown` 事件时显示会话结束提示，禁用输入，不触发自动重连。

#### Scenario: 会话正常关闭
- **WHEN** Gateway 推送 `shutdown` 事件（WebSocket 随后关闭）
- **THEN** 对话区显示"会话已结束"分隔线，输入框禁用，StatusBar 显示"已断开"状态，不触发自动重连

### Requirement: Web UI 展示工具执行卡片（按工具类型分类，覆盖所有 44 个工具）
Web UI SHALL 根据工具名称类型，以不同 UI 样式展示 ToolCallCard，左边框颜色按分类区分，摘要文字对应 TUI 的 `summarizeInput` 逻辑并扩展。

#### Scenario: Bash 工具执行展示（含命令代码块和输出）
- **WHEN** `tool_started.tool_name="bash"` 事件到达，`tool_input.command="npm install --save-dev webpack"`
- **THEN** ToolCallCard 展示：🖥️ 图标 + 命令代码块（深色背景 #313244，等宽字体，最多 120 字符）+ 旋转 spinner；完成后显示输出代码块（等宽字体，最多 500 字符，超出显示"▼ 展开完整输出（n行）"）；左边框橙色

#### Scenario: 文件写入工具展示（write_file / edit_file / notebook_edit）
- **WHEN** `tool_started.tool_name` 为 `write_file`、`edit_file`、`notebook_edit` 之一
- **THEN** ToolCallCard 展示：✏️ 图标 + 文件路径（等宽字体，可点击）；edit_file 同时显示 old_string 前 60 字符；完成后显示 diff 风格（+绿色/-红色，按行展示）；左边框蓝色

#### Scenario: 文件读取工具展示（read_file / glob / grep）
- **WHEN** `tool_started.tool_name` 为 `read_file`、`glob`、`grep` 之一
- **THEN** ToolCallCard 展示：📄/🔍 图标 + 文件路径或 /pattern/；完成后输出默认折叠（"n行输出 ▶ 展开"），点击展开；左边框灰色

#### Scenario: Web 工具展示（web_fetch / web_search）
- **WHEN** `tool_started.tool_name` 为 `web_fetch`、`web_search` 之一
- **THEN** ToolCallCard 展示：🌐/🔍 图标 + url/query（截断 80 字符）；完成后展示内容摘要（前 300 字符）；左边框绿色

#### Scenario: Agent 工具展示（含子任务关联）
- **WHEN** `tool_started.tool_name="agent"` 事件到达，`tool_input.subagent_type="code-reviewer"`, `tool_input.description="..."`
- **THEN** ToolCallCard 展示：🤖 图标 + subagent_type 标签 + description 前 80 字符；执行期间若 taskStore 中出现对应 subagent task，在 ToolCallCard 底部展示 "→ 子任务: {task.description}" 链接；完成后展示结果摘要；左边框紫色

#### Scenario: Cron 工具展示（含 CronPage 刷新触发）
- **WHEN** `tool_started.tool_name` 为 `cron_create`、`cron_delete`、`cron_toggle`、`cron_list` 之一
- **THEN** ToolCallCard 展示：⏰ 图标 + 工具操作摘要（cron_create 显示 name + schedule，cron_delete 显示 name，cron_list 显示"列出 cron jobs"）；完成后若 /cron 页面打开则自动刷新列表；左边框黄色

#### Scenario: Task 工具展示（task_create/task_get/task_stop 等）
- **WHEN** `tool_started.tool_name` 含 `task_` 前缀
- **THEN** ToolCallCard 展示：📋 图标 + task_id（若有）+ 操作类型；左边框灰色

#### Scenario: Team/消息/Todo 工具展示
- **WHEN** `tool_started.tool_name` 为 `team_create`、`team_delete`、`send_message`、`todo_write`
- **THEN** ToolCallCard 展示：🤝/💬/✅ 图标 + 对应摘要（team 名/收件人 + 消息前 60 字符/todo 数量）；左边框青色

#### Scenario: 计划/Worktree 模式工具展示
- **WHEN** `tool_started.tool_name` 为 `enter_plan_mode`、`exit_plan_mode`、`enter_worktree`、`exit_worktree`
- **THEN** ToolCallCard 展示：📋/🌿 图标 + 操作说明；完成后 StatusBar PlanMode 或 Worktree 状态更新

#### Scenario: MCP 工具展示（`mcp__{server}__{tool}` 格式）
- **WHEN** `tool_started.tool_name` 以 `mcp__` 开头
- **THEN** ToolCallCard 展示：⚙️ 图标 + "server: {serverName}" + "tool: {toolName}" + 第一个输入参数摘要；左边框灰蓝色

#### Scenario: 图片/创意工具展示
- **WHEN** `tool_started.tool_name` 为 `image_generation`、`image_to_text`
- **THEN** ToolCallCard 展示：🎨/🖼️ 图标 + prompt 前 80 字符；完成后若有图片 URL 则内嵌预览（max-height 200px）；左边框玫红色

#### Scenario: 只读工具不触发权限 Modal（含完整列表）
- **WHEN** Agent 执行只读工具（read_file/glob/grep/web_fetch/web_search/image_to_text/list_mcp_resources/read_mcp_resource/cron_list/task_get/task_list/task_output/tool_search/brief/sleep/ask_user_question）
- **THEN** 直接执行，不弹出 PermissionModal，ToolCallCard 无 ⚠️ 等待图标

#### Scenario: 工具输出展开/折叠
- **WHEN** ToolCallCard 输出超过 500 字符
- **THEN** 截断并显示"▼ 展开完整输出（n 行）"按钮；点击展开全部；再次点击收起

### Requirement: Web UI 展示权限模式（三种模式行为区分，对应 PermissionChecker 逻辑）
Web UI SHALL 精确反映 PermissionChecker.evaluate() 的三种模式决策，在 StatusBar 和各 ToolCallCard 中直观展示。

#### Scenario: Default 模式权限弹窗（requires_confirmation=true）
- **WHEN** Agent 在 DEFAULT 模式下执行非只读工具（bash/write_file/edit_file/notebook_edit/agent/cron_create/cron_delete/cron_toggle/task_stop/send_message/team_create/team_delete/mcp_auth/image_generation/remote_trigger 等），Gateway 推送 `modal_request(kind=permission)`
- **THEN** ToolCallCard 显示 ⏳ 脉冲动画"等待授权"；PermissionModal 弹出（含 tool_name/reason/request_id），用户允许后 ToolCallCard 继续执行，拒绝后显示 ✗ "被用户拒绝"

#### Scenario: Default 模式 - 包管理命令特殊提示
- **WHEN** `tool_input.command` 包含 `npm install`、`pip install` 等包安装命令
- **THEN** PermissionModal 的 reason 区域额外展示 "📦 包管理命令会修改工作区，默认模式不会自动执行" 黄色提示横幅（来自 `_bash_permission_hint` 逻辑）

#### Scenario: Default 模式 - 敏感路径访问拦截
- **WHEN** 工具尝试访问 `~/.ssh/*`、`~/.aws/credentials`、`~/.openharness/credentials.json` 等敏感路径，Gateway 推送 permission 被拒绝（allowed=false）
- **THEN** PermissionModal **不弹出**（直接拒绝）；ToolCallCard 显示 ✗ 红色"🔴 敏感文件访问已被拦截"

#### Scenario: Plan 模式阻断写操作（不弹 Modal，直接拒绝）
- **WHEN** Agent 在 PLAN 模式下尝试执行写操作工具（bash/write_file/edit_file/notebook_edit，即 WRITE_TOOLS 集合），Gateway 推送 `tool_completed(is_error=true, reason="Plan mode blocks mutating tools...")`
- **THEN** 不弹出 PermissionModal；ToolCallCard 显示 🚫 橙色左边框 + "PLAN MODE 阻断：{toolName}"；StatusBar [PLAN MODE] 标签红色闪烁 400ms

#### Scenario: Full Auto 模式无弹窗无提示
- **WHEN** Agent 在 FULL_AUTO 模式下执行任何工具
- **THEN** 不弹出 PermissionModal，所有工具直接执行，ToolCallCard 无 ⚠️ 图标；状态栏显示 "auto" 绿色标签

#### Scenario: 通过状态栏切换权限模式
- **WHEN** 用户点击 StatusBar 的 "mode: default/plan/auto" 徽章
- **THEN** 发送 `select_command{command:"permissions"}` → Gateway 推送 `select_request` → SelectModal 弹出含 3 个选项（Default/Plan Mode/Full Auto），选择后发送 `apply_select_command`

### Requirement: Web UI 提供 Swarm 团队协作完整管理（SwarmPage）
Web UI SHALL 在路由 `/swarm` 提供完整的 Swarm 团队管理页，支持团队 CRUD、成员详情展示（含 agent_type/model/color/permissions/subscriptions）、Agent 对话内容查看（通过 session_id）、跨 Agent 权限审批流。

#### Scenario: SwarmPage 三栏布局
- **WHEN** 用户访问 `/swarm`
- **THEN** 页面分三区：左侧团队列表（GET /api/swarm/teams，含 name/description/member_count）、中间成员卡片区（选中团队后显示该团队所有成员）、右侧 Agent 详情面板（选中成员后展示）

#### Scenario: 展示 TeamMember 卡片（完整字段）
- **WHEN** 用户选择某个团队
- **THEN** 成员卡片展示完整 TeamMember 信息：
  - 顶部：颜色色块（对应 member.color 字段）+ name + `@{team}` 格式 agent_id
  - 状态徽章：🟢 active / 🟡 idle / ⬛ stopped（对应 member.status）
  - 类型标签：member.agent_type（如 "researcher"、"test-runner"）
  - 模型标签：member.model（如 "claude-sonnet-4-6"）
  - backend_type 标签：in_process / subprocess / tmux
  - 功能标签：若 plan_mode_required 显示 📋 Plan Mode；若有 worktree_path 显示 🌿 Worktree
  - 权限列表：member.permissions（可展开折叠）
  - 订阅主题：member.subscriptions（可展开折叠）
  - 加入时间：joined_at 相对时间

#### Scenario: 查看 Agent 对话内容（Transcript）
- **WHEN** 用户点击某 TeamMember 卡片，Agent 有 session_id（member.session_id 不为空）
- **THEN** 右侧面板展示 Agent 完整 Transcript：
  - 调用 `GET /api/swarm/agents/{agent_id}/transcript`
  - 以 MDRenderer 渲染对话内容（assistant Markdown 渲染、tool calls 折叠展示）
  - 显示刷新按钮（轮询最新内容）
  - 若 agent 是活跃的（status=active），显示"实时"标签，每 5s 自动刷新

#### Scenario: Agent 无 session_id 时的提示
- **WHEN** 用户点击 TeamMember 卡片，但 member.session_id 为空
- **THEN** 右侧面板显示"此 Agent 暂无对话记录（session_id 未设置）"，提供"刷新成员信息"按钮

#### Scenario: 查看 Agent Mailbox（含所有 7 种消息类型）
- **WHEN** 用户点击 TeamMember 卡片的"📬 邮箱"标签
- **THEN** 切换右侧面板到 Mailbox 视图，展示消息列表，每条消息显示对应图标和内容：
  - ✉️ user_message：sender + payload.text 内容
  - ⚠️ permission_request：🔧 tool_name + 操作描述 + input 摘要 + **[批准] [拒绝]** 操作按钮（若本地用户是 leader）
  - ✅/❌ permission_response：请求 ID + 结果（success/error）+ 响应内容
  - 🌐 sandbox_permission_request：host pattern + **[批准] [拒绝]** 操作按钮
  - 🌐 sandbox_permission_response：requestId + allow/deny 结果
  - 🔴 shutdown：发送者 + 时间
  - 🟡 idle_notification：summary 文字
  - 所有消息显示 sender/recipient、相对时间戳、已读/未读状态（未读加粗）

#### Scenario: Leader 批准 Worker 权限请求
- **WHEN** 用户在 Mailbox 视图点击 permission_request 消息的"批准"按钮
- **THEN** 调用 `POST /api/swarm/agents/{worker_agent_id}/permission-response`（approved=true），消息状态更新为"已批准 ✅"，调用 `PATCH /messages/{id}/read` 标记已读

#### Scenario: Leader 拒绝 Worker 权限请求
- **WHEN** 用户在 Mailbox 视图点击 permission_request 消息的"拒绝"按钮
- **THEN** 调用同一端点（approved=false），消息状态更新为"已拒绝 ❌"

#### Scenario: 待处理权限请求通知（Leader 视角）
- **WHEN** 用户访问 /swarm，调用 `GET /api/swarm/teams/{team}/pending-permissions` 返回待处理项
- **THEN** 页面顶部显示黄色横幅"⚠️ {n} 个待处理权限请求"，点击跳转到对应 Worker 的 Mailbox；StatusBar 的 🔔swarm:n 徽章也反映此数量

#### Scenario: 生成新 teammate（SpawnForm）
- **WHEN** 用户点击 SwarmPage 的"+ 生成 Agent"按钮
- **THEN** 弹出 SpawnAgentForm 对话框，含字段：
  - name（必填，Agent 名称）、team（选择/创建团队）、prompt（初始任务）
  - model（可选，下拉选择）、agent_type（可选，如 "researcher"）
  - color（可选，颜色选择器）、worktree_path（可选，git worktree）
  - permissions（多选，Tool 权限列表）、plan_mode_required（开关）
  - subscriptions（可选，事件订阅主题）
  提交后调用 `POST /api/sessions/{active_session_id}/spawn`，成功后卡片出现在成员列表中

#### Scenario: 关闭 teammate（含确认）
- **WHEN** 用户点击 TeamMember 卡片的"🔴 关闭"按钮并在确认弹窗中确认
- **THEN** 调用 `DELETE /api/swarm/agents/{agent_id}`，卡片状态变为 "stopped"；30s 后从活跃列表移至"已停止"折叠区域

#### Scenario: 创建新团队
- **WHEN** 用户点击左侧团队列表的"+ 新建团队"按钮，填写 name 和 description
- **THEN** 调用 `POST /api/swarm/teams`，成功后团队出现在左侧列表，自动选中该团队

#### Scenario: 删除团队（含确认）
- **WHEN** 用户点击某团队行的"删除"按钮，确认弹窗提示"确认删除团队及其所有成员记录？"
- **THEN** 调用 `DELETE /api/swarm/teams/{team}`，团队从列表移除

#### Scenario: Team Allowed Paths 展示
- **WHEN** 用户在团队详情中查看 "共享权限路径"
- **THEN** 展示 team_allowed_paths 列表，每项含 path/tool_name/added_by/added_at；Leader 可手动添加或删除

#### Scenario: SwarmPanel 与 SwarmPage 数据同步
- **WHEN** `swarm_status` BackendEvent 推送新 swarm_teammates 数据
- **THEN** 右侧面板 SwarmPanel 摘要（name + status icon + task）和 /swarm 页面的成员卡片均更新；数据源为同一 swarmStore，两个视图共享状态

### Requirement: Web UI 提供定时任务（Cron）管理页
Web UI SHALL 在路由 `/cron` 提供完整的 Cron job 管理界面，支持 CRUD 操作和执行历史查看，不需要 Agent 会话。

#### Scenario: 展示 Cron job 列表
- **WHEN** 用户访问 `/cron`
- **THEN** 调用 `GET /api/cron/jobs` 展示 job 列表，每行显示：启用开关（toggle）| name | schedule（含人类可读描述如"每天 9 AM 工作日"）| 状态徽章（enabled 绿/disabled 灰）| last_run 相对时间 | next_run 绝对时间 | 操作按钮（编辑/删除/历史）

#### Scenario: 创建 Cron job（弹窗表单）
- **WHEN** 用户点击"+ 新建任务"按钮
- **THEN** 弹出 CronJobForm 对话框，含字段：name（必填）、schedule（cron 表达式 + 人类可读预览）、类型选择（Shell 命令 / Agent 消息）、command 或 message（二选一必填）、timezone（可选）、payload.channel + payload.to（若为 agent_turn 类型）、notify（可选飞书通知）、enabled 开关；实时验证 cron 表达式有效性

#### Scenario: Cron 表达式实时验证
- **WHEN** 用户在 CronJobForm 的 schedule 字段输入 `"0 9 * * 1-5"`
- **THEN** 表单实时显示人类可读描述 "每周一至周五 09:00"，下方显示未来 5 次执行时间预览

#### Scenario: 启用/禁用 job
- **WHEN** 用户拨动某 job 行的 enabled 开关
- **THEN** 立即调用 `PATCH /api/cron/jobs/{name}/toggle`，开关状态更新，无需重新加载列表

#### Scenario: 查看执行历史
- **WHEN** 用户点击某 job 行的"历史"按钮
- **THEN** 展开历史面板，显示最近 20 条执行记录：时间 | 状态（✅success / ❌error）| 运行时长 | 输出摘要（可展开查看完整输出）

#### Scenario: 调度器状态显示
- **WHEN** 用户访问 `/cron`
- **THEN** 页面顶部显示调度器状态横幅：🟢 "调度器运行中 (每 30 秒检查)" 或 🔴 "调度器未运行，运行 `oh cron start` 启动"（从 GET /api/cron/scheduler/status 获取）

#### Scenario: Cron 工具触发 UI 刷新
- **WHEN** Agent 在聊天中执行 `cron_create` / `cron_delete` / `cron_toggle` 工具，ToolCallCard 完成
- **THEN** `/cron` 页面的 job 列表自动刷新（通过 WebSocket 推送触发），无需手动刷新

### Requirement: Web UI 提供 Memory 管理页
Web UI SHALL 在路由 `/memory` 提供 Memory 文件浏览、编辑、删除和 dream 整合功能。

#### Scenario: 展示 Memory 文件列表
- **WHEN** 用户访问 `/memory`
- **THEN** 调用 `GET /api/memory/files` 展示文件列表（文件名/大小/修改时间），点击文件展示内容；显示 MEMORY.md（主索引）、各子 memory 文件

#### Scenario: 编辑 Memory 文件
- **WHEN** 用户点击某文件并编辑内容
- **THEN** 提供 Markdown 编辑器（或纯文本），保存时调用 `POST /api/memory`（更新已有条目）

#### Scenario: 删除 Memory 条目
- **WHEN** 用户点击文件行的删除按钮并确认
- **THEN** 调用 `DELETE /api/memory/{filename}`，文件从列表中移除

#### Scenario: 触发 dream 整合
- **WHEN** 用户点击"🔮 整合记忆 (Dream)"按钮
- **THEN** 调用 `POST /api/memory/dream`，显示进度提示"正在整合..."，完成后刷新文件列表

#### Scenario: Memory 文件通过 Agent 工具更新
- **WHEN** Agent 在聊天中执行 Write/Edit 工具修改了 memory 目录下的文件
- **THEN** `/memory` 页面文件列表自动刷新（通过 WebSocket tool_completed 事件触发）

### Requirement: Web UI 提供认证状态面板（Auth Panel）
Web UI SHALL 在左侧 Sidebar 的 Status 子面板中展示认证状态，并提供 API Key 管理入口。

#### Scenario: 展示认证状态
- **WHEN** 用户在 Sidebar 查看 Status 面板
- **THEN** 显示当前 provider（如 "anthropic"）、auth_status（✅ok / ❌missing / ⚠️invalid）、base_url；来自 `GET /api/auth/status`

#### Scenario: 打开 API Key 配置弹窗
- **WHEN** 用户点击 Status 面板的 "🔑 配置 API Key" 按钮
- **THEN** 弹出 API Key 配置弹窗：provider 下拉选择 + API key 输入框（密码型）+ [保存] [清除]按钮

#### Scenario: 保存 API Key
- **WHEN** 用户输入 API Key 并点击"保存"
- **THEN** 调用 `POST /api/auth/login`，成功后 Status 面板的 auth_status 更新为 ✅ok，现有 WebSocket 会话推送 state_snapshot 更新

### Requirement: Web UI 提供设置面板（Settings Panel）
Web UI SHALL 提供设置管理 UI，支持修改 fast_mode/effort/passes/turns/vim_mode/voice_mode/output_style 等运行时配置。

#### Scenario: 打开设置面板
- **WHEN** 用户点击 TopNav 的 ⚙️ 设置图标
- **THEN** 从右侧滑入设置抽屉（Drawer）；从 `GET /api/settings` 加载当前配置

#### Scenario: 修改 Fast Mode
- **WHEN** 用户在设置面板拨动 "Fast Mode" 开关
- **THEN** 调用 `PATCH /api/settings`，body `{"fast_mode": true}`；若有活跃会话，StatusBar 的 ⚡fast 指示实时更新

#### Scenario: 修改 Effort 级别
- **WHEN** 用户在设置面板选择 Effort 下拉（low/medium/high）
- **THEN** 调用 `PATCH /api/settings`，body `{"effort": "high"}`

#### Scenario: 查看/切换 Provider Profile
- **WHEN** 用户在设置面板点击 "Provider Profiles"
- **THEN** 展示所有 profiles（`GET /api/settings/profiles`），显示 name/provider/model/auth_source；当前激活 profile 高亮

### Requirement: Web UI 提供背景任务面板（Background Tasks）
Web UI SHALL 在右侧面板提供背景任务列表，展示 subagent 任务和 shell 任务状态，对应 /tasks、/agents 命令。

#### Scenario: 展示背景任务列表
- **WHEN** 用户在右侧面板点击 "Tasks" 标签（或左侧栏点击任务图标）
- **THEN** 调用 `GET /api/tasks` 展示任务列表：type 图标（🤖 agent / 🖥️ shell）+ description + status（pending/running/done/error）+ metadata.progress

#### Scenario: 查看任务详情
- **WHEN** 用户点击某个运行中的任务行
- **THEN** 调用 `GET /api/tasks/{id}`，侧面展开任务输出文件内容（流式轮询或 WebSocket 推送）

#### Scenario: 停止运行中任务
- **WHEN** 用户点击任务行的 ■ 停止按钮并确认
- **THEN** 调用 `DELETE /api/tasks/{id}`，任务状态更新为"已停止"

#### Scenario: 任务状态从 WebSocket 实时更新
- **WHEN** Gateway 推送 `tasks_snapshot` 事件
- **THEN** 背景任务面板实时刷新（与 TaskBoard 数据分离，分别展示 todo 任务和后台运行任务）

### Requirement: Web UI 提供 Skills 浏览器
Web UI SHALL 在路由 `/skills` 提供 skill 内容浏览，方便用户了解可用技能。

#### Scenario: 展示 Skill 列表
- **WHEN** 用户访问 `/skills`（或从 Sidebar 进入）
- **THEN** 调用 `GET /api/skills` 展示 skill 卡片列表：name/description/tags；可按标签过滤；user_invocable skill 显示 "/" 命令标签

#### Scenario: 查看 Skill 内容
- **WHEN** 用户点击某 skill 卡片
- **THEN** 调用 `GET /api/skills/{name}`，右侧或弹层展示 skill 的 Markdown 内容

### Requirement: Web UI 提供 Repo Autopilot 页面
Web UI SHALL 在路由 `/autopilot` 提供 Repo Autopilot 任务队列管理，对应 /autopilot、/ship 命令。

#### Scenario: 展示 Autopilot 任务队列
- **WHEN** 用户访问 `/autopilot`
- **THEN** 调用 `GET /api/autopilot/tasks` 展示任务卡片：title/status（pending/running/completed/failed）/source/created_at；状态用颜色区分

#### Scenario: 提交新任务（/ship）
- **WHEN** 用户在 Autopilot 页面点击"+ 提交任务"，输入任务描述
- **THEN** 调用 `POST /api/autopilot/ship`，任务入队，新卡片出现在列表中

### Requirement: Web UI 在 Sidebar 展示 Git 上下文
Web UI SHALL 在左侧 Sidebar 中展示当前 git 仓库状态，提供 diff 和 branch 信息。

#### Scenario: 展示当前分支
- **WHEN** 用户在 Sidebar 查看 Git 子面板
- **THEN** 调用 `GET /api/git/branch` 显示当前分支名 + ahead/behind 信息（如 "main ↑2"）

#### Scenario: 展示 Git Diff 摘要
- **WHEN** 用户点击 Sidebar Git 子面板的"查看 Diff"
- **THEN** 调用 `GET /api/git/diff`，侧边展开 diff 内容（代码块，+ 绿色 - 红色）

#### Scenario: 非 git 目录时隐藏 Git 面板
- **WHEN** GET /api/git/branch 返回 HTTP 422
- **THEN** Sidebar Git 子面板隐藏，不显示错误

### Requirement: Web UI 在 Sidebar 展示 MCP 服务器状态
Web UI SHALL 在左侧 Sidebar 的 MCP 子面板展示 MCP 服务器列表，支持在无活跃会话时也可查看。

#### Scenario: 无会话时展示 MCP 配置列表
- **WHEN** 用户在欢迎页查看 Sidebar MCP 子面板
- **THEN** 调用 `GET /api/mcp/servers` 展示已配置的 MCP server（name/state/transport/tool_count）

### Requirement: Web UI 在 Sidebar 展示 Plugins 状态
Web UI SHALL 在左侧 Sidebar 的 Plugins 子面板展示已安装插件列表。

#### Scenario: 展示插件列表
- **WHEN** 用户查看 Sidebar Plugins 子面板
- **THEN** 调用 `GET /api/plugins` 展示插件列表（name/enabled 开关/commands_count/tools_count）；enabled 开关点击触发插件启用/禁用



