## 1. 项目结构搭建

- [x] 1.1 创建 `HLAgent/` 顶层目录及三个子目录：`sdk/`、`gateway/`、`web/`
- [x] 1.2 在 `HLAgent/sdk/` 创建 `pyproject.toml`，声明依赖 `openharness-ai`（`pip install -e e:/AI/OpenHarness`），创建 `hlagent_sdk/` 包目录
- [x] 1.3 在 `HLAgent/sdk/hlagent_sdk/__init__.py` 导出 `WebBackendHost`、`AgentSessionConfig`、`create_host`（不暴露旧的 QueryEngine 接口）
- [x] 1.4 验证 `from openharness.ui.backend_host import ReactBackendHost` 可正常导入（是 WebBackendHost 的父类）

## 2. SDK 层实现（WebBackendHost）

- [x] 2.1 实现 `HLAgent/sdk/hlagent_sdk/web_host.py` — `WebBackendHost(ReactBackendHost)` 类：
  - 覆盖 `_read_requests()`：从 `_ws_input_queue` 读取（含 permission/question/interrupt 内部路由）
  - 覆盖 `_emit()`：写入 `_event_queue`（shutdown 后追加 None sentinel）
  - 实现 `push_request(req)` / `next_event()` / `start()` / `stop()` 公共接口
  - 实现只读属性 `app_state`、`commands`、`is_ready` 和方法 `get_system_prompt()`、`get_messages()`、`pop_last_turn()`、`get_session_id()`、`get_session_backend()`
- [x] 2.2 实现 `AgentSessionConfig` dataclass 和 `create_host(config)` 工厂函数（将 AgentSessionConfig 映射到 BackendHostConfig）
- [x] 2.3 安装 SDK：`pip install -e HLAgent/sdk/`，验证 `from hlagent_sdk import WebBackendHost, create_host` 成功
- [x] 2.4 写简单验证脚本：创建 WebBackendHost 实例，验证属性和方法存在，验证不依赖 Ink/Textual（`import ink` 不被触发）

## 3. Gateway 层实现

- [x] 3.1 在 `HLAgent/gateway/` 创建 `pyproject.toml`，声明 FastAPI、uvicorn、websockets、croniter、hlagent-sdk 依赖
- [x] 3.2 实现 `services/session_manager.py`：`SessionManager` 类，内部维护 `dict[str, WebBackendHost]`；提供 `create(session_id, config) → host`、`get(session_id) → host | None`、`remove(session_id)` 方法；`session_id` 用 `uuid4().hex`；初始化单例 `session_mgr = SessionManager()`
- [x] 3.3 创建 `main.py`，配置 FastAPI app、CORS（允许 localhost:5173）、挂载所有 router（**onboarding**/sessions/ws/cron/swarm/memory/auth/settings/mcp/skills/tasks/git/autopilot/debug）
- [x] 3.4 实现 `GET /health`，返回 `{"status": "ok", "version": "0.1.0"}`
- [x] 3.5 实现 `routers/sessions.py`：
  - `POST /api/sessions` → 生成 session_id + 调用 `session_mgr.create(session_id, AgentSessionConfig(...))` 返回 `{"session_id": ..., "status": "created"}`（host 此时未 start，等 WS 连接时 start）
  - `GET /api/sessions/{id}` → 检查 `host.is_ready` 返回 AppState dict，503 if not ready
  - `DELETE /api/sessions/{id}` → `host.stop()` + `session_mgr.remove(id)`
  - `GET /api/sessions/{id}/commands` → `host.commands` if ready
  - `GET /api/sessions/{id}/permission-mode` → `host.app_state.permission_mode` + path_rules
  - `POST /api/sessions/{id}/permission-mode` → `host.push_request(FrontendRequest(type="submit_line", line=f"/permissions {mode}"))` 后等待 state_snapshot（或直接修改 bundle settings + push state_snapshot）
  - `POST /api/sessions/{id}/spawn` → `host.push_request(FrontendRequest(type="submit_line", line=f"spawn teammate ..."))` — spawn 结果经 swarm_status BackendEvent 返回
- [x] 3.6 实现 `routers/ws.py` — WebSocket 主处理逻辑：
  - 连接建立 → `session_mgr.get(session_id)`，不存在 → close(code=4004)
  - `await host.start()` — 后台启动 `host.run()`（内部自动发 ready 事件，**Gateway 不手动发 ready**）
  - 两个并发 task：`[事件转发]` `while True: event=await host.next_event(); if event is None: break; await ws.send_json(event.model_dump())` 和 `[请求转发]` `async for raw in ws.iter_text(): req=FrontendRequest.model_validate_json(raw); await host.push_request(req)`
  - WS 断开 → cancel 两个 task，`await host.stop()`（若 host 仍运行）
- [x] 3.7 验证：在 WebSocket 测试中发送 `permission_response` 消息，确认 `WebBackendHost._read_requests()` 正确 resolve 对应 Future（无需 Gateway 额外路由代码）
- [x] 3.8 验证：发送 `apply_select_command{command:"model", value:"claude-opus-4-7"}`，确认模型切换由 `ReactBackendHost._apply_select_command()` 处理并推送 `state_snapshot`（无需 Gateway 额外实现）
- [x] 3.9 实现 `routers/cron.py`（使用 `croniter` 库验证表达式）：`GET /api/cron/jobs`（`load_cron_jobs()`）、`POST`（`upsert_cron_job()` + `validate_cron_expression()` 验证，无效表达式返回 HTTP 422）、`DELETE /api/cron/jobs/{name}`、`PATCH /api/cron/jobs/{name}/toggle`、`GET .../history`（读 cron_history.jsonl，最近 50 条）、`GET /api/cron/scheduler/status`（lockfile 检查 + `is_scheduler_running()`）
- [x] 3.10 初始化 `routers/swarm.py` 文件并注册路由到 main.py（完整实现在任务 10.1 中定义）；此任务创建文件骨架，包含以下 stub 路由函数占位：
  `get_teams / get_team_detail / create_team / delete_team / get_member / get_pending_permissions / spawn_teammate / get_agent_transcript / send_agent_message / agent_permission_response / delete_agent / get_agent_messages / mark_message_read`；在 main.py 中注册 `swarm_router`
- [x] 3.11 验证 WS 完整流程：连接 → 等待 host.start() → 收到 ready 事件 → 发送 submit_line → 收到 transcript_item/tool_started/assistant_delta/line_complete 系列事件 → 验证顺序正确

## 4. Web UI 基础框架

- [x] 4.1 在 `HLAgent/web/` 使用 `npm create vite@latest . -- --template react-ts` 初始化项目
- [x] 4.2 安装依赖：`tailwindcss`、`@shadcn/ui`、`zustand`、`react-router-dom`、`react-markdown`、`lucide-react`、`remark-gfm`（Markdown 复选框）、`react-syntax-highlighter`（代码高亮）
- [x] 4.3 配置 TailwindCSS，设置深色主题为默认（`darkMode: 'class'`，html 默认加 `dark` class，主色调 `#1e1e2e`/`#cdd6f4` Catppuccin Mocha 风格）
- [x] 4.4 创建全局三栏布局组件 `AppLayout.tsx`：TopNav(48px) + LeftSidebar(220px 可折叠) + MainContent(flex-grow) + RightPanel(280px 按需显示) + StatusBar(32px 固定底部)
- [x] 4.5 配置 `react-router-dom`：`/` → WelcomePage，`/chat/:sessionId` → ChatPage（嵌套在 AppLayout 中），`/memory`→MemoryPage，`/skills`→SkillsPage，`/autopilot`→AutopilotPage，`/cron`→CronPage，`/swarm`→SwarmPage
- [x] 4.6 创建 TypeScript 类型文件 `src/types/protocol.ts`，精确对应 openharness `protocol.py` 模型：
  - `FrontendRequest`：8 种 type + line/command/value/request_id/allowed/answer 字段
  - `BackendEvent`：18 种 type + 所有可选字段（select_options/message/item/state/tasks/mcp_servers/bridge_sessions/commands/modal/tool_name/tool_input/output/is_error/compact_phase/compact_trigger/attempt/compact_checkpoint/compact_metadata/todo_markdown/plan_mode/swarm_teammates/swarm_notifications）
  - `AppState`：精确对应 `state.py` — model/cwd/provider/auth_status/base_url/vim_enabled/voice_enabled/voice_available/voice_reason/fast_mode/effort/passes/mcp_connected/mcp_failed/bridge_sessions/output_style/keybindings
  - `TranscriptItem`：role（system/user/assistant/tool/tool_result/log）/text/tool_name/tool_input/is_error
  - `TaskSnapshot`：id/type/status/description/metadata
- [x] 4.7 创建 `src/hooks/useWebSocket.ts`：
  - 连接 `WS /ws/{sessionId}` 
  - 接收 JSON → 解析为 `BackendEvent` → 分发到对应 store
  - 接收 shutdown 事件后设置 `terminated=true`（不重连）
  - 意外断开后指数退避重连（1→2→4→8→16→30s）
  - 暴露 `sendRequest(req: FrontendRequest)` 方法

## 5. Web UI 状态管理

- [x] 5.1 创建 `src/stores/sessionStore.ts`（Zustand）：
  - `sessionId: string`、`wsStatus: 'connecting'|'ready'|'disconnected'|'terminated'`
  - `appState: AppState | null`（对应 state_snapshot.state，精确类型）
  - `transcript: TranscriptItem[]`（含 assistant 流式 buffer）
  - `assistantBuffer: string`（streaming delta 累积）
  - `commands: string[]`、`mcpServers: McpServerSnapshot[]`、`bridgeSessions: BridgeSessionSnapshot[]`
  - `busy: boolean`（true 期间 MessageInput 禁用）
  - `planMode: string`（plan/default/full_auto）
  - actions: `setAppState`、`addTranscriptItem`、`appendDelta`、`completeAssistant`、`clearTranscript`、`setTerminated`
- [x] 5.2 创建 `src/stores/taskStore.ts`（Zustand）：
  - `tasks: TaskSnapshot[]`（来自 tasks_snapshot）
  - `todoMarkdown: string | null`（来自 todo_update）
  - `backgroundTasks: BackgroundTask[]`（来自 GET /api/tasks，轮询）
- [x] 5.3 创建 `src/stores/swarmStore.ts`（Zustand）基础版本：`teammates: SwarmTeammate[]`（来自 swarm_status BackendEvent）、`notifications: SwarmNotification[]`、`unreadCount: number`；完整的 SwarmPage 管理状态（teams/selectedTeam/memberDetails/pendingPermissions）在任务 10.9 中扩展
- [x] 5.4 创建 `src/stores/uiStore.ts`（Zustand）：
  - `activeModal: PermissionModal | QuestionModal | SelectModal | null`
  - `compactPhase: string | null`（compact_progress 状态）
  - `errorToasts: ErrorToast[]`（含 id/message/createdAt，自动 5s 过期）
- [x] 5.5 在 `useWebSocket.ts` 中实现精确的 BackendEvent 分发：
  - `ready` → `sessionStore.setAppState(state)` + `taskStore.setTasks(tasks)` + `sessionStore.setCommands(commands)` + `sessionStore.setMcpServers(mcp_servers)` + `sessionStore.setBridgeSessions(bridge_sessions)` + `sessionStore.setWsStatus('ready')`
  - `state_snapshot` → `sessionStore.setAppState(state)` + 更新 mcpServers/bridgeSessions（若含这些字段）
  - `transcript_item` → `sessionStore.addTranscriptItem(item)`
  - `assistant_delta` → `sessionStore.appendDelta(message)`
  - `assistant_complete` → `sessionStore.completeAssistant(message)` + `sessionStore.addTranscriptItem(item)`
  - `line_complete` → `sessionStore.setBusy(false)` + 清空 assistantBuffer
  - `tool_started` → `sessionStore.addTranscriptItem(item)` + 插入 pending ToolCallCard
  - `tool_completed` → 更新对应 ToolCallCard（按 tool_name 匹配）+ `sessionStore.addTranscriptItem(item)`
  - `tasks_snapshot` → `taskStore.setTasks(tasks)`
  - `todo_update` → `taskStore.setTodoMarkdown(todo_markdown)`
  - `compact_progress` → `uiStore.setCompactPhase(compact_phase)`
  - `clear_transcript` → `sessionStore.clearTranscript()`
  - `modal_request` → `uiStore.setActiveModal({kind: modal.kind, ...})`
  - `select_request` → `uiStore.setActiveModal({kind: 'select', options: select_options, ...})`
  - `plan_mode_change` → `sessionStore.setPlanMode(plan_mode)`
  - `swarm_status` → `swarmStore.setTeammates(swarm_teammates)` + `swarmStore.addNotifications(swarm_notifications)`
  - `error` → `uiStore.addErrorToast(message)`
  - `shutdown` → `sessionStore.setWsStatus('terminated')` （不触发重连）

## 6. 核心页面实现

- [x] 6.1 实现 `pages/WelcomePage.tsx`：品牌标识 + "开始新对话"按钮（POST /api/sessions 并跳转 /chat/:id）+ 最近会话列表（GET /api/sessions 获取）+ 功能介绍卡片
- [x] 6.2 实现 `pages/ChatPage.tsx`：整合 CompactProgressBar + TranscriptViewer + MessageInput，初始化 WebSocket 连接，分发 BackendEvents 到各 store
- [x] 6.3 实现 `components/TranscriptViewer.tsx`：渲染 transcript_item 列表（groupToolPairs 配对逻辑，与 TUI ConversationView 一致）；自动滚动到底部；用户手动滚动时停止自动滚动 + 显示"↓ 回到底部"浮动按钮；接收 `clear_transcript` 时清空并显示"对话已清空"空状态
- [x] 6.4 实现 `components/ToolCallCard.tsx`：执行中状态（旋转 spinner + 工具名 + 参数 JSON 折叠展开）；完成状态（✓绿色/✗红色 + 输出最多 500 字符 + "展开查看"）
- [x] 6.5 实现 `components/MDRenderer.tsx`：react-markdown + remark-gfm（支持复选框）+ react-syntax-highlighter（代码高亮），`- [ ]`/`- [x]` 渲染为带样式复选框
- [x] 6.6 实现 `components/MessageInput.tsx`：多行 textarea（Shift+Enter 换行，最多 8 行）；Enter 发送；↑↓ 历史导航（维护 history 数组）；输入 "/" 触发 CommandPicker；忙碌时禁用并显示红色"■ 停止"按钮；Escape 键触发中断（忙碌时）或清空输入（空闲时）

## 7. 辅助组件实现

- [x] 7.1 实现 `components/TaskBoard.tsx`（TodoPanel 对应）：支持 tasks_snapshot（结构化列表，⏳/🔄/✅图标）和 todo_update（todo_markdown，remark-gfm 复选框渲染）两种数据源；空状态显示"暂无任务"；右侧面板无内容时自动隐藏
- [x] 7.2 实现 `components/SwarmPanel.tsx`（SwarmPanel 对应）：展示 swarm_teammates（🟢🟡✅🔴图标 + name + task + formatDuration）和 swarm_notifications（from + message + 相对时间）；折叠按钮显示摘要行；折叠状态持久到 sessionStore
- [x] 7.3 实现 `components/Sidebar.tsx`（SidePanel 对应）：五个子面板（Status/Sessions/MCP/Bridge/Commands），可整体折叠为图标模式；Sessions 子面板从 GET /api/sessions 加载历史；MCP/Bridge 数据从 sessionStore 读取
- [x] 7.4 实现 `components/CommandPicker.tsx`（行内命令补全，非全局 Palette）：输入 "/" 后在输入框正上方弹出，最多 10 条；↑↓ 导航，Tab 补全，Enter 选中，Esc 关闭；检测 SELECTABLE_COMMANDS 触发 select_command，/plan 特殊处理切换计划模式
- [x] 7.5 实现 `components/CommandPalette.tsx`（Ctrl+K 全局命令面板）：居中遮罩，带搜索框，模糊过滤所有命令，Enter 执行，Esc 关闭；特殊命令触发 SelectModal
- [x] 7.6 实现 `components/StatusBar.tsx`（StatusBar+Footer 对应）：●WebSocket 状态（green/red/gray）| 模型名 | [PLAN MODE 黄色标签 + PlanMode OFF 绿色 flash 800ms] | ⚡fast | MCP:n● m✗ | tasks:n | ↓input↑output tokens | 🔔swarm:n；断开时显示"重连"按钮
- [x] 7.7 实现 `components/PermissionModal.tsx`（permission_dialog 对应）：居中遮罩，工具名+操作描述，[Y 允许]/[N 拒绝] 按钮，支持键盘 Y/N 快捷键，发送 permission_response
- [x] 7.8 实现 `components/QuestionModal.tsx`（新增）：居中遮罩，问题文字，文字输入框（自动聚焦），Enter 或"确认"按钮提交，发送 question_response
- [x] 7.9 实现 `components/SelectModal.tsx`（新增）：居中遮罩，标题，选项列表（active 项 ● 高亮），↑↓ 导航，Enter/点击确认，1-9 数字快选，Esc 取消，发送 apply_select_command
- [x] 7.10 实现 `components/CompactProgressBar.tsx`（新增）：对话区顶部蓝色横幅，"正在压缩上下文… 第 n 次"，动态省略号动画；compact_phase="done" 时 transition 300ms 淡出
- [x] 7.11 实现 `components/ErrorToast.tsx`（新增）：右上角堆叠 Toast，红色错误图标 + 消息 + ×关闭按钮，5 秒自动消失，多条堆叠
- [x] 7.12 在 `pages/ChatPage.tsx` 集成全部 Modal/Toast/Progress 组件，通过 uiStore 的 activeModal/compactProgress/errorToasts 控制显示

## 8. 集成验证

- [x] 8.1 启动 Gateway（`uvicorn main:app --port 8000`）+ Web UI（`npm run dev`），验证首页可访问
- [x] 8.2 在 Web UI 创建新会话，验证 WebSocket 连接建立并收到 `ready` 事件（含 state/tasks/commands）
- [x] 8.3 发送一条消息，验证 transcript_item 实时显示，tool_call 卡片正常渲染
- [x] 8.4 验证权限弹窗（PermissionModal）正常弹出并可响应
- [x] 8.5 验证问题弹窗（QuestionModal）正常弹出并可响应
- [x] 8.6 验证 SelectModal（模型切换）正常弹出、选择后 StatusBar 模型名更新
- [x] 8.7 验证状态栏显示连接状态、模型名、MCP 状态、token 用量
- [x] 8.8 验证 compact_progress 事件触发时 CompactProgressBar 显示
- [x] 8.9 验证 error 事件触发时 ErrorToast 显示并自动消失
- [x] 8.10 验证 plan_mode_change 事件触发时 StatusBar PlanMode 标签更新
- [x] 8.11 验证 Ctrl+K 打开 CommandPalette，选择命令后正常执行
- [x] 8.12 验证 SwarmDashboard 展示 swarm_teammates 和 swarm_notifications
- [x] 8.13 验证 TaskBoard 同时支持 tasks_snapshot 结构化数据和 todo_markdown Markdown 渲染
- [x] 8.14 验证 ToolCallCard 对 Bash/文件/Agent/Cron 工具显示不同样式
- [x] 8.15 验证 DEFAULT 模式下写操作弹出 PermissionModal，PLAN 模式显示阻断提示，FULL_AUTO 模式无弹窗
- [x] 8.16 验证 /cron 页面可列出/创建/删除/切换 cron job
- [x] 8.17 验证 /swarm 页面可向 teammate 发消息并查看 mailbox（含所有 7 种消息类型展示）
- [x] 8.18 验证现有 TUI（`oh` 命令）不受影响，功能正常
- [x] 8.19 验证流程 D（REST 读取会话状态）：会话创建后 is_ready=true 时，`GET /api/sessions/{id}` 返回完整 AppState；is_ready=false 时返回 503
- [x] 8.20 验证流程 F（Settings PATCH 影响活跃会话）：调用 `PATCH /api/settings{fast_mode:true}` 后，活跃 WS 会话收到 `state_snapshot` 事件，StatusBar ⚡fast 指示实时更新
- [x] 8.21 验证 Onboarding 完整流程：未配置 API Key 时访问 /chat 强制跳转 /onboarding，完成 5 步向导后正常进入聊天页面
- [x] 8.22 验证 Swarm 跨 Agent 权限审批流：Worker spawn 后请求写操作权限，Leader mailbox 出现 permission_request，Web UI 点击"批准"后 worker 继续执行

## 9. 工具执行与权限 Web UI 组件

- [x] 9.1 实现 `src/utils/toolDisplay.ts` — 工具展示配置模块（对应 TUI 的 `summarizeInput` 函数，并扩展为完整 Web 展示配置）：

  **工具分类 + 图标 + 摘要函数（覆盖所有 44 个工具）：**

  | 分类 | 工具名称 | 图标 | 摘要提取字段 | 是否只读 |
  |------|---------|------|------------|---------|
  | Shell | `bash` | 🖥️ | command（前 120 字符）+ cwd（若非当前目录）| ❌ |
  | 文件写入 | `write_file` | ✏️ | file_path + "（新建/覆盖）" | ❌ |
  | 文件编辑 | `edit_file` | ✏️ | file_path + old_string 前 60 字符 | ❌ |
  | Notebook | `notebook_edit` | 📓 | notebook_path + cell_number + edit_mode | ❌ |
  | 文件读取 | `read_file` | 📄 | file_path + (offset/limit 若有) | ✅ |
  | 搜索 | `glob` | 🔍 | pattern + path（若非当前目录）| ✅ |
  | 搜索 | `grep` | 🔍 | /pattern/ + glob（若有）| ✅ |
  | Web | `web_fetch` | 🌐 | url（截断 80 字符）| ✅ |
  | Web | `web_search` | 🔍 | query | ✅ |
  | 图片 | `image_to_text` | 🖼️ | source 前 60 字符 | ✅ |
  | 图片 | `image_generation` | 🎨 | prompt 前 80 字符 | ❌ |
  | Agent | `agent` | 🤖 | subagent_type + description 前 80 字符 | ❌ |
  | 任务 | `task_create` | 📋 | type + description | ❌ |
  | 任务 | `task_get` / `task_output` | 📋 | task_id | ✅ |
  | 任务 | `task_list` | 📋 | "列出所有任务" | ✅ |
  | 任务 | `task_stop` | 📋 | task_id + "停止" | ❌ |
  | 任务 | `task_update` | 📋 | task_id + 更新字段 | ❌ |
  | Cron | `cron_create` | ⏰ | name + schedule（如 "0 9 * * 1-5"）| ❌ |
  | Cron | `cron_delete` | ⏰ | name | ❌ |
  | Cron | `cron_list` | ⏰ | "列出所有 cron job" | ✅ |
  | Cron | `cron_toggle` | ⏰ | name + enabled | ❌ |
  | Team | `team_create` | 🤝 | name | ❌ |
  | Team | `team_delete` | 🤝 | name | ❌ |
  | 消息 | `send_message` | 💬 | to + text 前 60 字符 | ❌ |
  | Todo | `todo_write` | ✅ | todos 数量 + 状态摘要 | ❌ |
  | 模式 | `enter_plan_mode` | 📋 | "进入计划模式" | ❌ |
  | 模式 | `exit_plan_mode` | 📋 | "退出计划模式" | ❌ |
  | Worktree | `enter_worktree` / `exit_worktree` | 🌿 | name / path | ❌ |
  | 配置 | `config` | ⚙️ | key=value | ❌ |
  | 技能 | `skill` | ⚡ | skill 名称 | ❌ |
  | MCP | `mcp__{server}__{tool}` | ⚙️ | server + tool + 第一个参数 | 取决于工具 |
  | MCP | `list_mcp_resources` / `read_mcp_resource` | ⚙️ | server_name | ✅ |
  | MCP | `mcp_auth` | 🔑 | server + "认证" | ❌ |
  | 工具搜索 | `tool_search` | 🔍 | query | ✅ |
  | LSP | `lsp` | 🔧 | operation + file_path | ✅ |
  | 远程触发 | `remote_trigger` | 🔗 | trigger_id | ❌ |
  | 提问 | `ask_user_question` | ❓ | question 前 80 字符 | ✅ |
  | 摘要 | `brief` | 📝 | "生成摘要" | ✅ |
  | 休眠 | `sleep` | 💤 | delay_seconds + "s" | ✅ |

  导出函数：`getToolIcon(name: string)`、`getToolSummary(name: string, input: Record<string, unknown>)`、`isWriteTool(name: string)`、`isReadOnly(name: string)`

- [x] 9.2 重新实现 `components/ToolCallCard.tsx`，使用 `toolDisplay.ts` 配置，分三种状态：

  **① 执行中状态（tool_started 触发）：**
  ```
  ┌─ [图标] tool_name  [摘要文字]  ⟳ spinner ─────────┐
  │  ▶ 参数详情（默认折叠，点击展开 JSON）               │
  └───────────────────────────────────────────────────┘
  ```
  - 左边框颜色对应工具分类（Bash=橙、文件=蓝、Web=绿、Agent=紫、Cron=黄等）
  - `bash` 工具特殊处理：命令以等宽字体 `code block` 展示，背景 `#313244`
  - `write_file`/`edit_file`：文件路径可点击（跳转到 MemoryPage 或外部编辑器）

  **② 完成状态（tool_completed 触发，is_error=false）：**
  ```
  ┌─ [图标] tool_name  [摘要]  ✓ nL ──────────────────┐
  │  输出内容（前 500 字符）         [▼ 展开完整输出]  │
  └───────────────────────────────────────────────────┘
  ```
  - 输出行数 `nL` 显示（对应 TUI 的 `lineCount L` 标签）
  - `bash` 输出以代码块展示（等宽字体）
  - `write_file`/`edit_file` 输出以 diff 风格（+ 绿色/-红色）展示
  - `read_file` 输出折叠（默认收起，点击展开完整内容）

  **③ 错误状态（tool_completed，is_error=true）：**
  ```
  ┌─ [图标] tool_name  [摘要]  ✗ error ────────────────┐
  │  错误信息（最多 5 行，多余行"... (n more lines)"）  │
  └───────────────────────────────────────────────────┘
  ```
  - 左边框变为红色
  - 错误文字红色前景

  **④ PLAN MODE 阻断状态（plan mode + 写操作工具）：**
  ```
  ┌─ [图标] tool_name  [摘要]  🚫 PLAN MODE: blocked ──┐
  │  "Plan Mode 已阻断此写入操作。退出 Plan Mode 后重试" │
  └───────────────────────────────────────────────────┘
  ```
  - 左边框橙色，背景微红

- [x] 9.3 实现权限检查决策在 Web UI 中的完整分支逻辑（对应 `PermissionChecker.evaluate()` 的三种模式）：

  **FULL_AUTO 模式（对应 PermissionMode.FULL_AUTO = "full_auto"）：**
  - 所有工具直接执行，无任何权限提示
  - ToolCallCard 无 ⚠️ 图标，无 PermissionModal
  - 状态栏显示 "auto" 绿色标签

  **PLAN 模式（对应 PermissionMode.PLAN = "plan"）：**
  - 写操作工具（`isWriteTool(name) = true`）被阻断，直接显示 `④ 阻断状态` ToolCallCard
  - 对应 TUI `WRITE_TOOLS` 集合：`bash`、`write_file`、`edit_file`、`notebook_edit`、`computer`（= bash/write tools）
  - 状态栏显示 "[PLAN MODE]" 黄色标签 + 当前阻断工具名红色
  - 不弹出 PermissionModal

  **DEFAULT 模式（对应 PermissionMode.DEFAULT = "default"）：**
  - 非只读工具触发 PermissionModal（通过 `modal_request(kind=permission)` 事件）
  - 写操作执行时 ToolCallCard 短暂显示 ⏳ 等待授权状态
  - 注意：所有 API/事件中 permission_mode 字段值使用小写（"default"/"plan"/"full_auto"），与 Python 枚举值一致

- [x] 9.4 实现 `components/PermissionModal.tsx` 完整 UI（对应 `_ask_permission(tool_name, reason)` 触发的 `modal_request` 事件）：

  **弹窗内容（使用 modal 字段：tool_name + reason + request_id）：**
  ```
  ┌──────────────────────────────────────────────────────┐
  │  ⚠️  权限请求                                        │
  │  ─────────────────────────────────────────────────  │
  │  工具: 🖥️ bash                                      │
  │  操作: npm install --save-dev webpack               │  ← command 截断显示
  │                                                      │
  │  ⚠️ 包管理命令会修改工作区，默认模式不会自动执行    │  ← reason 字段展示
  │                                                      │
  │  [Y 允许]      [N 拒绝]      [本次会话允许同类工具]  │
  │  keyboard: Y 允许 / N 或 Esc 拒绝                   │
  └──────────────────────────────────────────────────────┘
  ```
  - "本次会话允许同类工具"按钮：发送 `submit_line "/permissions full_auto"` 切换到 FULL_AUTO（可选）
  - 敏感路径访问时显示红色警告（`SENSITIVE_PATH_PATTERNS` 命中时 reason 含 "sensitive credential path"）

  **键盘支持：**
  - `Y` 键 → 允许（`permission_response{allowed: true}`）
  - `N` 键或 `Escape` → 拒绝（`permission_response{allowed: false}`）
  - `Enter` → 默认允许（匹配用户习惯）

  **状态展示（弹窗显示期间 ToolCallCard）：**
  ```
  ┌─ 🖥️ bash  npm install --save-dev webpack  ⏳ 等待授权 ─┐
  └──────────────────────────────────────────────────────┘
  ```
  等待期间 ToolCallCard 显示 ⏳ 脉冲动画；用户拒绝后变为 ✗ 状态

- [x] 9.5 实现 `utils/toolDisplay.ts` 中的敏感路径检测辅助函数 `isSensitivePath(path: string): boolean`，在 PermissionModal 中若 reason 包含 "sensitive credential path" 则显示红色警告横幅：
  ```
  🔴 敏感文件访问警告：AI 正在尝试访问凭据文件，建议拒绝。
  ```

- [x] 9.6 实现权限模式切换 UI（StatusBar 中 mode 徽章可点击）：
  - 点击 "default" / "plan" / "auto" 徽章 → 发送 `select_command{command:"permissions"}` → 触发 SelectModal 选择权限模式
  - SelectModal 选项：[Default（默认）] [Plan Mode（计划）] [Full Auto（全自动）]
  - 选择后发送 `apply_select_command{command:"permissions", value:"..."}`

## 10. Swarm 管理 Web UI（/swarm 页面）

- [x] 10.1 更新 `routers/swarm.py` 补充缺失端点：
  - `GET /api/swarm/teams` 返回摘要（name/description/member_count/active_count/lead_agent_id）
  - `GET /api/swarm/teams/{team}` 返回完整 TeamFile（含 members 字典、team_allowed_paths）
  - `POST /api/swarm/teams` 调用 `TeamLifecycleManager.create_team()`
  - `DELETE /api/swarm/teams/{team}` 删除团队目录
  - `GET /api/swarm/teams/{team}/members/{agent_id}` 获取单个成员详情
  - `GET /api/swarm/agents/{agent_id}/transcript` 通过 `TeamMember.session_id` 调用 SessionBackend 获取 transcript
  - `PATCH /api/swarm/agents/{agent_id}/messages/{message_id}/read` 调用 `TeammateMailbox.mark_read()`
  - `POST /api/swarm/agents/{worker_agent_id}/permission-response` 调用 `create_permission_response_message()` 或 `create_sandbox_permission_response_message()` 写入 worker mailbox
  - `GET /api/swarm/teams/{team}/pending-permissions` 扫描 leader mailbox，返回未读的 permission_request 消息
  - GET /api/swarm/agents/{agent_id}/messages 增加 `unread_only` 查询参数支持

- [x] 10.2 实现 `pages/SwarmPage.tsx` 三栏布局：
  - 左栏（200px）：团队列表，每行含 name + description 摘要 + member_count + "+"新建按钮；点击选中高亮
  - 中栏（flex-grow）：选中团队的成员卡片网格（2 列）
  - 右栏（320px）：选中成员的详情（可切换 Transcript / Mailbox / Info 标签页）

- [x] 10.3 实现 `components/TeamMemberCard.tsx`（完整 TeamMember 展示）：
  - 顶部色块（member.color 对应 TailwindCSS 颜色，如 bg-red-500）
  - 状态图标 🟢/🟡/⬛ + name + `@{team}` + agent_type 标签
  - model 徽章 + backend_type 徽章（in_process=灰/subprocess=蓝/tmux=紫）
  - plan_mode_required 时显示 📋 Plan Mode 徽章；worktree_path 不为空时显示 🌿 Worktree
  - 展开折叠区：permissions 列表 + subscriptions 列表
  - 操作按钮：💬 发消息 / 📬 邮箱 / 🔴 关闭

- [x] 10.4 实现 `components/AgentTranscriptPanel.tsx`（右侧 Transcript 标签页）：
  - 调用 `GET /api/swarm/agents/{agent_id}/transcript`
  - 用 MDRenderer 渲染 Markdown transcript（assistant 消息/tool calls/system 消息）
  - 顶部显示 "📋 Transcript" + session_id 前 8 位 + 刷新按钮
  - 若 status=active 且 session_id 不为空：每 5s 自动轮询刷新，显示 "🔴 实时" 标签
  - 若 session_id 为空：显示 "暂无对话记录" 空状态

- [x] 10.5 实现 `components/AgentMailboxPanel.tsx`（右侧 Mailbox 标签页）：
  - 调用 `GET /api/swarm/agents/{agent_id}/messages?unread_only=false`
  - 按时间倒序展示消息列表，每条消息：
    - ✉️ user_message：sender + text 内容（含 Markdown 渲染）
    - ⚠️ permission_request：🔧 tool_name + description + input 参数摘要 + **[批准] [拒绝]** 按钮（批准调用 POST permission-response/approved=true，拒绝调用 approved=false）+ 已处理后显示结果标签
    - ✅ permission_response：result + updated_input（若有）
    - 🌐 sandbox_permission_request：host pattern + [批准]/[拒绝] 按钮
    - 🌐 sandbox_permission_response：allow/deny 结果
    - 🔴 shutdown：红色标签 + 时间
    - 🟡 idle_notification：summary 文字
  - 未读消息加粗，点击任意消息自动调用 PATCH mark_read
  - 顶部显示未读数量徽章

- [x] 10.6 实现待处理权限请求横幅（SwarmPage 顶部）：
  - 调用 `GET /api/swarm/teams/{team}/pending-permissions`
  - 若有待处理项显示黄色横幅 "⚠️ {n} 个待处理权限请求 [查看 →]"
  - 点击自动定位到对应 Agent 的 Mailbox 标签页
  - 数量同步到 StatusBar 的 🔔swarm:n 徽章（`swarmStore.pendingPermissions`）

- [x] 10.7 实现 `components/SpawnAgentForm.tsx`（生成新 Agent 弹窗）：
  - name（必填）、team（下拉选择或新建）、prompt（多行文本，必填）
  - model（下拉，可选）、agent_type（文本，可选，如 "researcher"）
  - color（颜色选择器，16 种预设颜色）、worktree_path（文本，可选）
  - permissions（多选列表）、plan_mode_required（开关，默认 off）
  - subscriptions（标签输入，可选）
  - 提交调用 `POST /api/sessions/{active_session_id}/spawn`

- [x] 10.8 实现 `components/CreateTeamForm.tsx`（新建团队弹窗）：
  - name（必填，kebab-case 验证）、description（可选）
  - 提交调用 `POST /api/swarm/teams`

- [x] 10.9 更新 `swarmStore.ts`：新增字段
  - `teams: TeamSummary[]`（从 GET /api/swarm/teams 获取）
  - `selectedTeam: string | null`（当前选中团队名）
  - `selectedMember: string | null`（当前选中 agent_id）
  - `memberDetails: Record<string, TeamMember>`（成员完整信息缓存）
  - `pendingPermissions: number`（待处理权限请求数，用于徽章）
  - actions: `setTeams`、`selectTeam`、`selectMember`、`setMemberDetails`、`setPendingPermissions`

- [x] 10.10 在左侧导航栏 Sidebar 添加 "Swarm" 入口图标（🤝），跳转到 /swarm；若 pendingPermissions > 0 显示数量徽章

## 11. Cron 管理 Web UI（/cron 页面）

- [x] 11.1 实现 `pages/CronPage.tsx`：调度器状态横幅（GET /api/cron/scheduler/status）+ job 列表表格（name/schedule/enabled toggle/last_run/next_run/状态徽章/操作按钮）
- [x] 11.2 实现 `components/CronJobForm.tsx`（新建/编辑弹窗）：name/schedule（含实时人类可读描述和未来 5 次执行预览）/类型（Shell/Agent）/command or message/timezone/payload（channel+to）/notify/enabled；提交调用 POST /api/cron/jobs
- [x] 11.3 实现 cron 表达式解析器（纯前端）：将 `"0 9 * * 1-5"` 转为 "每周一至周五 09:00"，计算未来 5 次执行时间（基于 cronstrue 库或自实现）
- [x] 11.4 实现 job 历史面板（点击"历史"按钮展开）：GET /api/cron/jobs/{name}/history，显示时间 + ✅/❌ + 运行时长 + 输出摘要（可展开完整输出）
- [x] 11.5 在左侧导航栏 Sidebar 添加 "Cron" 入口图标（⏰），跳转到 /cron
- [x] 11.6 更新路由配置添加 `/cron` 和 `/swarm` 路由
- [x] 11.6 更新路由配置添加 `/cron` 和 `/swarm` 路由

## 12. 文档与配置

- [x] 12.1 在 `HLAgent/` 创建 `README.md`，说明三层架构（SDK/Gateway/Web）、所有 API 端点、启动方式、开发指南
- [x] 12.2 创建 `HLAgent/docker-compose.yml`（可选），一键启动 gateway + web
- [x] 12.3 在 `HLAgent/web/` 配置 `vite.config.ts` 代理：`/api` 和 `/ws` 转发到 `localhost:8000`
- [x] 12.4 创建 `HLAgent/gateway/README.md`，列出所有 API 端点及请求/响应格式

## 13. Gateway 补充路由实现（Memory / Auth / Settings / Tasks / Git / Skills / Autopilot / Onboarding）

- [x] 13.1 实现 `routers/onboarding.py`：
  - `GET /api/onboarding/status` → 组合 `AuthManager.get_auth_status()` + `load_settings()` + 检查 cwd 下 CLAUDE.md/.openharness 是否存在（project_initialized）；auth_configured = 任何 provider configured=True
  - `POST /api/onboarding/init-project` → 直接执行 /init 命令逻辑（创建 CLAUDE.md + .openharness/memory/MEMORY.md + plugins/.gitkeep + skills/.gitkeep）；幂等（已存在的文件跳过）；返回 created 文件列表
- [x] 13.2 实现 `routers/memory.py`：`GET /api/memory/files`（list_memory_files）、`GET /api/memory/{filename}`（读文件）、`POST /api/memory`（add_memory_entry）、`DELETE /api/memory/{filename}`（remove_memory_entry）、`POST /api/memory/dream`（启动后台整合）
- [x] 13.3 实现 `routers/sessions.py` 扩展：`GET /api/sessions`（列出 SessionBackend 历史）、`GET /api/sessions/{id}/context`（system prompt）、`GET /api/sessions/{id}/summary`（summarize_messages）、`GET /api/sessions/{id}/transcript`（导出 transcript）、`DELETE /api/sessions/{id}/messages/last`（rewind）、`POST /api/sessions/{id}/tag`（命名快照）
- [x] 13.4 实现 `routers/auth.py`：
  - `GET /api/auth/status`（auth_status + AuthManager.get_auth_status()）
  - `POST /api/auth/login`（调用 `AuthManager.store_profile_credential()`，**仅存储不验证**，返回 `{"status":"stored","message":"...将在首次对话时验证..."}` HTTP 200；文件系统错误返回 500）
  - `DELETE /api/auth`（clear_provider_credentials）
- [x] 13.5 实现 `routers/settings.py`：`GET /api/settings`、`PATCH /api/settings`（save_settings + 推送 state_snapshot）、`GET /api/settings/profiles`（Onboarding Step 2 使用）、`PATCH /api/settings/profiles/{name}`
- [x] 13.6 实现 `routers/mcp.py`：`GET /api/mcp/servers`
- [x] 13.7 实现 `routers/skills.py`：`GET /api/skills`、`GET /api/skills/{name}`；`GET /api/plugins`
- [x] 13.8 实现 `routers/tasks.py`：`GET /api/tasks`、`GET /api/tasks/{id}`、`DELETE /api/tasks/{id}`
- [x] 13.9 实现 `routers/git.py`：`GET /api/git/diff`、`GET /api/git/branch`；非 git 仓库返回 HTTP 422
- [x] 13.10 实现 `routers/autopilot.py`：`GET /api/autopilot/tasks`、`POST /api/autopilot/ship`
- [x] 13.11 实现 `routers/debug.py`：`GET /api/debug/doctor`（环境诊断，聚合 AuthManager + settings + cwd + Python 版本信息）、`GET /api/debug/hooks`（load_hook_registry 已配置 hooks 列表）

## 14. 补充 Web UI 页面（Onboarding / Memory / Auth / Settings / Tasks / Skills / Autopilot / Git）

- [x] 14.1 实现 `pages/OnboardingPage.tsx`（路由 `/onboarding`）：5 步向导（Step1 欢迎诊断 / Step2 Provider 选择 / Step3 凭据输入 / Step4 项目初始化 / Step5 功能导览）；Step3 根据 provider 类型动态渲染（Anthropic Key / OpenAI base_url+key / OAuth 类 CLI 提示+"刷新检查"）；已配置时展示"已完成"状态页
- [x] 14.2 实现 `components/OnboardingGuard.tsx`（路由守卫）：
  - 每次路由导航时调用 `GET /api/onboarding/status`（以服务端为准，不依赖 localStorage）
  - 目标路由为 `/chat/*` 且 `auth_configured=false` → 强制跳转 `/onboarding`
  - 其他路由 + `auth_configured=false` → 仅在页面顶部显示 `AuthBanner` 软提示，不重定向
  - `hlagent_tour_seen` localStorage 只用于"是否显示功能导览"，与 auth 检查无关
- [x] 14.3 实现 `components/AuthBanner.tsx`：黄色/橙色 TopBar 横幅，显示"⚠️ 未配置 AI Provider，对话功能不可用。[立即配置 →]"；点击跳转 /onboarding；auth_configured=true 时自动隐藏
- [x] 14.4 实现 `pages/MemoryPage.tsx`：文件列表（name/size/modified）+ 内容展示（Markdown 渲染）+ 编辑（纯文本/MD 编辑器）+ 删除确认 + "🔮 Dream" 整合按钮
- [x] 14.5 实现 `components/AuthPanel.tsx`（Sidebar Status 子面板扩展）：provider + auth_status 图标 + "🔑 配置 API Key" 按钮打开 ApiKeyModal（provider 下拉 + key 输入 + 保存/清除）
- [x] 14.6 实现 `components/SettingsDrawer.tsx`（右滑抽屉）：Fast Mode 开关、Effort 下拉（low/medium/high）、Passes 数字输入、Max Turns 数字输入、Vim Mode 开关、Output Style 下拉；Provider Profiles 列表（GET /api/settings/profiles）
- [x] 14.7 实现 `components/BackgroundTasksPanel.tsx`（右侧面板标签页）：type 图标 + description + status 颜色区分 + 进度条（metadata.progress）+ ■停止按钮；点击展开任务详情输出
- [x] 14.8 实现 `pages/SkillsPage.tsx`（路由 `/skills`）：skill 卡片网格（name/description/tags）+ 标签过滤 + 点击查看 Markdown 内容弹窗；user_invocable skill 显示 "/" 命令徽章
- [x] 14.9 实现 `pages/AutopilotPage.tsx`（路由 `/autopilot`）：任务卡片列表（title/status/source/created_at）+ "+" 提交任务按钮（输入框 + 提交调用 POST /api/autopilot/ship）
- [x] 14.10 扩展 `components/Sidebar.tsx`：新增 Git 子面板（`GET /api/git/branch` 分支信息 + 查看 diff 展开）、新增 Plugins 子面板（`GET /api/plugins`）；新增导航图标：Memory(🧠) / Skills(⚡) / Autopilot(🚀) / Cron(⏰) / Swarm(🤝)
- [x] 14.11 更新路由配置添加 `/onboarding`、`/memory`、`/skills`、`/autopilot` 路由；用 OnboardingGuard 包裹所有已有路由

## 15. 权限管理 UI（Permission Management UI）

> **SDK 层无需任何修改**，权限逻辑由 ReactBackendHost 继承处理（见 design.md D12）。

### P1 — 高优先级：会话权限模式显示与切换

- [x] 15.1 升级 `components/StatusBar.tsx`：始终显示权限模式徽章（**补全 task 9.6 的未完成部分**：9.6 只实现了 PLAN 徽章，此任务补充 default/auto 的显示与点击）
  - `[default]` 灰色文字 · `[PLAN]` 黄色加粗（已有）· `[auto]` 绿色文字
  - 无活跃 WS 会话时不显示徽章（避免误导，全局模式在 SettingsDrawer 管理）
  - 仅当 `wsStatus='ready'` 时徽章可点击；点击发送 `select_command{command:"permissions"}` → 触发 SelectModal
  - SelectModal 选项：Default（逐一确认）/ Plan Mode（阻断写操作）/ Full Auto（全部放行）
  - 切换成功后：收到 `state_snapshot` → `sessionStore.planMode` 更新 → 徽章颜色即时刷新

- [x] 15.2 升级 `components/PermissionModal.tsx`：增加"⚡ 本次全部允许"快捷按钮
  - 位置：[N 拒绝] [Y 允许] [⚡ 本次全部允许] 三按钮排列
  - 行为：① 先发 `permission_response{allowed: true}` → ② 再发 `submit_line "/permissions full_auto"` → ③ 关闭弹窗 → ④ 显示**警告色 Toast**（黄/橙，非红色错误）提示文字："已切换到全自动模式。所有工具将自动放行，重启 Gateway 后仍生效。"
  - 敏感路径时**不显示**此按钮（`isSensitive=true` 时隐藏，防止对凭据文件提升权限）
  - 键盘快捷键：在 `useEffect` keydown handler 中**明确添加** `A` 键逻辑：
    ```typescript
    if (e.key === 'a' || e.key === 'A') { /* 执行"本次全部允许"逻辑 */ }
    ```
  - 键盘提示更新：新增 "A 本次全部允许"

### P2 — 中优先级：全局默认权限模式配置

- [x] 15.3 升级 `gateway/routers/settings.py`：`PATCH /api/settings` 支持 `permission_mode` 字段
  - `PatchSettingsRequest` 新增 `permission_mode: str | None = None`
  - **关键实现注意**：`permission_mode` 映射到**嵌套对象** `settings.permission.mode`，不能直接 `model_copy(update={"permission_mode": ...})`，需要：
    ```python
    if req.permission_mode is not None:
        from openharness.permissions.modes import PermissionMode
        updated_perm = s.permission.model_copy(
            update={"mode": PermissionMode(req.permission_mode)}
        )
        updates["permission"] = updated_perm
    ```
  - 保存后**推送给活跃会话**确保 StatusBar 即时同步：
    ```python
    for host in session_mgr.get_all_ready():
        await host.push_request(
            FrontendRequest(type="submit_line", line=f"/permissions {req.permission_mode}")
        )
    ```
  - `GET /api/settings` 返回值新增：`"permission_mode": settings.permission.mode.value`（从嵌套字段读取）

- [x] 15.4 升级 `components/SettingsDrawer.tsx`：新增权限设置分区
  - 单选组：Default（推荐）/ Plan Mode / Full Auto（附简短说明文字）
  - "保存全局默认"按钮：调用 `PATCH /api/settings{permission_mode: "..."}` → 写入全局 settings.json
  - 当前会话模式显示：**仅当 `sessionStore.wsStatus === 'ready'` 时**显示 `sessionStore.planMode` 对比，否则显示"暂无活跃会话"
  - 提示文字："全局模式影响新会话启动时的初始权限；当前会话可用 /permissions 命令覆盖"

### P3 — 低优先级：权限规则编辑 UI（可选，后续迭代）

- [ ] 15.5 新增 `pages/PermissionsPage.tsx`（路由 `/permissions-settings`）
  - 工具白名单（allowed_tools）：列表 + 添加/删除
  - 工具黑名单（denied_tools）：列表 + 添加/删除
  - 路径规则（path_rules）：glob 模式 + allow/deny 标签 + 添加/删除
  - 禁止命令（denied_commands）：glob 模式列表 + 添加/删除
  - 保存调用 `PATCH /api/settings` 对应字段
  - 在 Sidebar 导航新增"🔐 权限规则"入口

- [ ] 15.6 升级集成验证：
  - 验证 StatusBar 徽章可见：default/plan/full_auto 三种状态均正确显示；无活跃会话时不显示
  - 验证 StatusBar 点击 → SelectModal → 切换成功 → 徽章颜色随即更新（来自 state_snapshot）
  - 验证 PermissionModal "本次全部允许"：弹窗关闭 + 黄色警告 Toast（非红色）+ 后续工具不再弹窗
  - 验证 `A` 键触发"本次全部允许"（键盘路径与按钮路径行为一致）
  - 验证 SettingsDrawer 全局保存：重启 Gateway 后新会话仍使用保存的默认模式
  - 验证 SettingsDrawer 无活跃会话时显示"暂无活跃会话"而非空的 planMode
