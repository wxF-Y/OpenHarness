## Context

OpenHarness 是一个完整的 AI Agent 运行时，当前架构将核心 SDK（engine、tools、memory 等）、TUI 桥接协议（`ui/protocol.py`、`ui/bridge/`）与 React/Ink 终端前端三者混合在同一个 Python 包中。现有 TUI 通过本地 WebSocket 连接 Python 后端（`ui/backend_host.py`），使用 `FrontendRequest` / `BackendEvent` Pydantic 模型通信。

目标是以最小侵入方式将 OpenHarness 抽离为三层，构建可独立部署的 HLAgent 产品，同时不破坏现有 TUI 功能。

## Goals / Non-Goals

**Goals:**
- 将 OpenHarness 核心模块提取为 `HLAgent/sdk/`，以 Python 包形式可独立安装
- 构建 `HLAgent/gateway/` FastAPI 服务，复用现有 `ui/protocol.py` 协议扩展，对外暴露 WebSocket + REST API
- 构建 `HLAgent/web/` React + Vite + TailwindCSS 现代 Web UI，覆盖 TUI 18 个组件的等价页面
- 每个任务完成后独立 commit

**Non-Goals:**
- 不修改 `src/openharness/` 现有代码（只读复用，不重构）
- 不替换现有 TUI（两者并行共存）
- 不实现认证/多租户（首版单用户本地部署）
- 不处理移动端适配

## Decisions

### D1: SDK 层 — 最终设计决策

**选择**：在 `HLAgent/sdk/` 中创建 `WebBackendHost` 类，继承自 `openharness.ui.backend_host.ReactBackendHost`，仅覆盖两个方法：
1. `_read_requests()` — 从 asyncio 内部队列读取 `FrontendRequest`（而非 `sys.stdin`）
2. `_emit()` — 将 `BackendEvent` 放入 asyncio 输出队列（而非写 `sys.stdout`）

Gateway 通过 `WebBackendHost.push_request(req)` 注入 WebSocket 消息，通过 `WebBackendHost.next_event()` 消费输出事件并推送至 WebSocket。

**理由**：`ReactBackendHost` 已完整实现所有 18 种 `BackendEvent`、8 种 `FrontendRequest` 处理、权限/问题 Future 管理、中断、StreamEvent→BackendEvent 映射。继承并覆盖 I/O 方法，零代码重复，100% 逻辑复用。

**SDK 暴露的 API（供 Gateway 使用）：**
```python
# HLAgent/sdk/__init__.py 暴露的核心接口
class AgentSessionConfig:
    model: str | None
    cwd: str | None
    permission_mode: str | None
    system_prompt: str | None
    max_turns: int | None
    api_key: str | None
    api_format: str | None
    active_profile: str | None

class WebBackendHost(ReactBackendHost):
    # I/O 接口（Gateway WS handler 调用）
    async def start() -> None              # 后台启动 run() 协程
    async def push_request(req: FrontendRequest) -> None  # 注入请求
    async def next_event() -> BackendEvent | None         # 读取输出事件（None=结束）
    async def stop() -> None               # 发送 shutdown 请求

    # 状态读取接口（Gateway REST handler 调用）
    @property
    def app_state(self) -> AppState | None       # 当前 AppState（bundle 初始化后可用）
    @property
    def commands(self) -> list[str]              # 可用命令列表
    @property
    def is_ready(self) -> bool                   # bundle 是否已初始化
    def get_system_prompt(self) -> str | None    # 当前 system prompt
    def get_messages(self) -> list[ConversationMessage]    # 当前对话历史
    def pop_last_turn(self) -> bool              # 回退最后一轮（/rewind）
    def get_session_id(self) -> str              # 内部 session_id
    def get_session_backend(self) -> SessionBackend

def create_host(config: AgentSessionConfig) -> WebBackendHost
```

**重要约束**：
- `app_state`、`commands` 等属性只有在 `is_ready=True`（即 `_bundle` 初始化完成后）才可安全读取
- REST handler 访问这些属性前必须检查 `is_ready`，否则返回 HTTP 503
- `WebBackendHost.run()` 运行在独立的 asyncio Task 中，与 WS handler 并发

**安装方式**：`HLAgent/sdk/pyproject.toml` 依赖 `openharness`，本地开发时 `pip install -e e:/AI/OpenHarness`；`HLAgent/gateway/pyproject.toml` 依赖 `hlagent-sdk`（本地路径引用）。

### D2: Gateway 协议 — 全新设计 vs 复用现有协议

**选择**：复用并扩展 `openharness.ui.protocol` 中的 `FrontendRequest` / `BackendEvent` 模型，在 gateway 层 `from openharness.ui.protocol import *`，新增认证 envelope 字段。

**理由**：协议已经过 TUI 验证，包含完整的 state_snapshot / transcript_item / tool_started 等事件类型，直接复用可大幅减少工作量。

### D3: Gateway 框架

**选择**：FastAPI + `websockets`（uvicorn），提供：

**REST API：**
- `GET /health` — 健康检查，返回版本和状态
- `POST /api/sessions` — 创建 Agent 会话，支持传递 `model`、`cwd`、`permission_mode`、`system_prompt` 等参数（对应 `BackendHostConfig`）
- `GET /api/sessions/{id}` — 获取会话当前 AppState 快照
- `DELETE /api/sessions/{id}` — 关闭会话（发送 `shutdown`）
- `GET /api/sessions/{id}/commands` — 获取可用命令列表（对应 `ready` 事件中的 `commands`）

**WebSocket：**
- `WS /ws/{session_id}` — 双向 WebSocket，完整实现所有 `FrontendRequest` 和 `BackendEvent` 类型

**FrontendRequest 全量支持（8 种）：**
| 消息类型 | Web UI 触发场景 |
|---------|--------------|
| `submit_line` | 用户发送消息 |
| `interrupt` | 点击中断按钮 |
| `permission_response` | 权限弹窗响应 |
| `question_response` | 问题弹窗响应 |
| `select_command` | CommandPalette 选择命令 |
| `apply_select_command` | SelectModal 选项确认（如模型切换） |
| `list_sessions` | 会话历史列表刷新 |
| `shutdown` | 用户关闭会话 |

**BackendEvent 全量支持（18 种）：**
| 事件类型 | Web UI 处理方式 |
|---------|--------------|
| `ready` | 初始化全局状态，加载 commands/tasks/mcp_servers/bridge_sessions |
| `state_snapshot` | 更新 sessionStore（含完整 AppState：model、cwd、provider、auth_status、vim_enabled、fast_mode、effort、passes、mcp_connected、mcp_failed 等） |
| `tasks_snapshot` | 更新 taskStore，TaskBoard 重渲染 |
| `transcript_item` | 追加到对话列表，TranscriptViewer 更新 |
| `assistant_delta` | 流式追加当前 assistant 消息 |
| `assistant_complete` | 标记当前 assistant 消息完成 |
| `line_complete` | 一轮输入处理完成，恢复输入框 |
| `tool_started` | 插入 ToolCallCard（执行中状态） |
| `tool_completed` | 更新 ToolCallCard（完成/错误状态） |
| `compact_progress` | 显示 CompactProgressBar（含 phase、attempt、checkpoint 字段） |
| `clear_transcript` | 清空 TranscriptViewer |
| `modal_request(kind=permission)` | 弹出 PermissionModal（含 tool_name、reason、request_id） |
| `modal_request(kind=question)` | 弹出 QuestionModal（含 question、request_id） |
| `select_request` | 弹出 SelectModal（含 select_options、modal.title/command） |
| `todo_update` | 更新 TaskBoard（todo_markdown 字段，Markdown 渲染） |
| `plan_mode_change` | 更新 StatusBar 的计划模式指示（plan_mode 字段） |
| `swarm_status` | 更新 swarmStore（swarm_teammates、swarm_notifications） |
| `error` | 显示 ErrorToast 通知 |
| `shutdown` | 清理 WebSocket 连接，显示会话结束提示 |

**理由**：FastAPI 与 Pydantic 原生兼容（OpenHarness 已使用 Pydantic），uvicorn 与现有 TUI 同栈。全量支持确保 Web UI 功能完整性不低于 TUI。

### D3.5: Gateway Session Manager 和 WS 处理流程（关键串联设计）

#### Session Manager（`services/session_manager.py`）

```python
class SessionManager:
    """管理所有活跃 WebBackendHost 实例。"""
    _sessions: dict[str, WebBackendHost]   # session_id → host

    def create(session_id: str, config: AgentSessionConfig) -> WebBackendHost
    def get(session_id: str) -> WebBackendHost | None
    def remove(session_id: str) -> None
    def list_ids() -> list[str]
```

**注意**：session_id 在 `POST /api/sessions` 时生成（UUID），**不等于** openharness 内部的 `bundle.session_id`（12字符十六进制）。外部 session_id 用于 REST/WS 路由，内部 session_id 用于 SessionBackend 持久化。

#### WS 处理流程（`routers/ws.py`）

```
WS 连接建立
    │
    ├─ 查找 session_manager.get(session_id)
    │   └─ 不存在 → 关闭 WS（code=4004）
    │
    ├─ host.start()  ← 非阻塞，启动 host.run() 后台 task
    │   └─ host.run() 内部调用:
    │       build_runtime() → start_runtime() → emit(ready) → 消息循环
    │
    ├─ 启动两个并发 task:
    │   ├─ [事件转发] async for event in ws_event_loop(host):
    │   │       event = await host.next_event()  ← None 表示 shutdown
    │   │       await ws.send_json(event.model_dump())
    │   │
    │   └─ [请求转发] async for msg in ws.iter_text():
    │           req = FrontendRequest.model_validate_json(msg)
    │           await host.push_request(req)
    │           ← host._read_requests() 内部处理路由：
    │               permission/question response → resolve Future
    │               interrupt → cancel active task
    │               其余 → _request_queue（主循环处理）
    │
    └─ WS 断开 → host.stop()（若 host 仍运行）
```

**关键规则**：
- Gateway **不手动发送** `ready` 事件 — 由 `WebBackendHost.run()` 内部在 `build_runtime()` 后自动发送
- `permission_response` / `question_response` / `interrupt` 在 `_read_requests()` 内部处理，Gateway 无需额外路由
- `apply_select_command` / `list_sessions` / `select_command` / `submit_line` / `shutdown` 进入 `_request_queue` 由主循环处理
- `WebBackendHost._apply_select_command()` 继承自 `ReactBackendHost`，直接处理模型切换等，**不需要 Gateway 额外实现**

#### REST 端点访问会话状态的规则

REST handler 需要读取活跃会话的内部状态时：
```python
host = session_manager.get(session_id)
if host is None:
    raise HTTPException(404, "Session not found")
if not host.is_ready:
    raise HTTPException(503, "Session not ready yet")

# 安全读取：
state = host.app_state        # AppState 对象
prompt = host.get_system_prompt()
messages = host.get_messages()
```

#### Settings PATCH 推送规则

`PATCH /api/settings` 更新全局配置后，**仅对当前活跃 WS 会话有效**：
- 调用 `save_settings()` 持久化
- 对所有 `session_manager.list_ids()` 中 `is_ready=True` 的 host：
  调用 `host.push_request(FrontendRequest(type="submit_line", line="/fast on"))`（或等效 apply_select_command）
- Web UI 将收到对应 `state_snapshot` 事件

#### Swarm Spawn 串联流程

`POST /api/sessions/{id}/spawn` 需要通过 Agent 会话运行时执行：
1. 验证 session_id + is_ready
2. 调用 `host.push_request(FrontendRequest(type="submit_line", line=f"/spawn {name} {team} {prompt}"))` 触发 spawn  
   **或**：直接调用 `host._bundle.engine` 的 agent tool（更精确但耦合更高）
3. spawn 结果通过 `swarm_status` BackendEvent 推送给 WS 客户端（swarmStore 更新）

#### list_sessions（WebSocket FrontendRequest）vs REST 历史列表的区别

| 方式 | 触发 | 数据来源 | 返回格式 |
|------|------|---------|---------|
| WS `list_sessions` FrontendRequest | 会话内 /resume 命令 | host SessionBackend | BackendEvent select_request（触发 SelectModal）|
| REST `GET /api/sessions` | Sidebar 历史列表 | SessionBackend 直接读 | JSON 数组（WelcomePage 历史显示）|

两者数据相同但返回格式不同。WS 方式触发 SelectModal，REST 方式返回列表供 Web UI 渲染。

### D4: Web UI 框架

**选择**：React 18 + Vite + TypeScript + TailwindCSS + shadcn/ui

**理由**：现有 TUI 已是 React/TypeScript，可复用组件逻辑；shadcn/ui 提供现成的 accessible 组件库；Vite 构建速度快。

### D4.5: Web UI 页面布局（详细）

#### 主应用布局（AppLayout）

```
┌─────────────────────────────────────────────────────────────┐
│ TopNav (48px): [≡] HLAgent | Session Title | [Ctrl+K] [⚙]  │
├──────────┬──────────────────────────────┬───────────────────┤
│  Left    │   Main Content               │   Right Panel     │
│ Sidebar  │   (flex-grow)                │   (collapsible,   │
│ (220px)  │                              │    280px)         │
│ ─────    │  ┌──────────────────────┐   │                   │
│ Sessions │  │ CompactProgressBar   │   │  TaskBoard        │
│ ─────    │  │ (if compacting)      │   │  (tasks_snapshot  │
│ Status   │  ├──────────────────────┤   │   + todo_update)  │
│ ─────    │  │                      │   │  ─────            │
│ MCP      │  │  TranscriptViewer    │   │  SwarmPanel       │
│ ─────    │  │  (overflow-y: auto)  │   │  (swarm_status)   │
│ Bridge   │  │                      │   │  ─────            │
│          │  └──────────────────────┘   │  SideInfo         │
│          │  MessageInput (auto-height)  │  (model/cwd)      │
│          │  ┌──────────────────────┐   │                   │
│          │  │ [✦][textarea]        │   │                   │
│          │  │ [📎]     [Stop/Send→]│   │                   │
│          │  └──────────────────────┘   │                   │
│          │  Hints (12px): enter send ↑↓│                   │
├──────────┴──────────────────────────────────────────────────┤
│ StatusBar (32px): ●WS | model | [PLAN] | fast | MCP:n | 12k↓│
└─────────────────────────────────────────────────────────────┘
```

#### 全局 Modal 叠加层（ModalOverlay）— 置于 AppLayout 之上

```
[命令补全弹层 - 输入框正上方，不遮挡全屏]
[PermissionModal - 居中遮罩对话框]
[QuestionModal   - 居中遮罩对话框]
[SelectModal     - 居中遮罩列表框，含键盘导航]
[ErrorToast      - 右上角，5秒自动消失，可手动关闭]
```

#### MessageInput 详细 UI 元素

```
┌─────────────────────────────────────────────────────────────┐
│  [✦ 图标]  [多行 textarea, Shift+Enter 换行, 最大 8 行]    │
│  [📎 附件]  [Ctrl+K 命令]              [发送→ / 停止■]     │
└─────────────────────────────────────────────────────────────┘
状态变化：
- 空闲：发送按钮有效，输入 / 后下方弹出命令补全列表
- 忙碌：输入框禁用（dimmed），发送按钮变为"■ 停止"红色按钮
- 断开：输入框禁用，显示"重连中..."提示
```

#### CommandPicker（行内命令补全，非全局 Palette）

```
用户输入 "/" 后，输入框正上方弹出补全层：
┌─────────────────────────────────────────────┐
│  /compact   ← 高亮选中项                    │
│  /help                                       │
│  /memory                                     │
│  /model                                      │
│  ...                                         │
└─────────────────────────────────────────────┘
键盘操作：↑↓ 导航，Enter 选中，Tab 补全，Esc 关闭
特殊命令处理（对应 SELECTABLE_COMMANDS）：
  /model /theme /provider /output-style /permissions
  /resume /effort /passes /turns /fast /vim /voice
  → 选中后发送 select_command 请求，触发 SelectModal
  /plan → 发送 submit_line 切换 plan mode（特殊处理）
```

#### Ctrl+K 全局命令面板（CommandPalette）

```
与 CommandPicker 不同，Ctrl+K 打开的是全局搜索面板：
┌─────────────────────────────────────────────────────────────┐
│  🔍 [搜索命令...                                           ] │
│  ─────────────────────────────────────────────────────────  │
│  > /compact    压缩上下文                                    │
│  > /memory     查看记忆                                      │
│  > /model      切换模型          ⤳ opens SelectModal        │
│  > /plan       切换计划模式                                  │
│  ─────────────────────────────────────────────────────────  │
│  快捷键: ↑↓ 导航  Enter 执行  Esc 关闭                     │
└─────────────────────────────────────────────────────────────┘
```

#### PermissionModal 详细 UI

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️  权限请求                                               │
│  ──────────────────────────────────────────────────         │
│  工具: bash                                                  │
│  操作: rm -rf ./tmp                                         │
│                                                              │
│  [Y 允许]      [N 拒绝]                                     │
│  (keyboard: Y/N 或 Enter/Esc)                               │
└─────────────────────────────────────────────────────────────┘
```

#### SelectModal 详细 UI（模型选择等）

```
┌─────────────────────────────────────────────────────────────┐
│  Model                                                       │
│  ──────────────────────────────────────────────────         │
│  ● claude-sonnet-4-6   ← 当前激活项（高亮）                 │
│  ○ claude-opus-4-7     Deepest reasoning                    │
│  ○ claude-haiku-4-5    Fastest                              │
│                                                              │
│  键盘: ↑↓ 导航  Enter 确认  1-9 数字快选  Esc 取消         │
└─────────────────────────────────────────────────────────────┘
```

#### StatusBar 详细 UI 元素

```
│ ●green WS | 模型: claude-sonnet-4-6 | [PLAN MODE] | ⚡fast |
│ MCP: 3● 0✗ | tasks: 2 | ↓12.3k ↑2.1k tokens | 🔔 swarm:2 │
```

- `●` 绿/黄/红 = WebSocket 连接状态
- `[PLAN MODE]` = 黄色背景标签，仅 plan mode 时显示
- `⚡fast` = fast mode 指示
- `MCP: n●` = 绿色数字（n 个已连接），`n✗` = 红色（n 个失败）
- `tasks: n` = 当前任务数量
- `↓ ↑ tokens` = 本轮 input/output token 用量
- `🔔 swarm:n` = swarm 活跃 agent 数徽章

#### 键盘快捷键汇总（Web UI 对应 TUI）

| TUI 快捷键 | Web UI 等价 | 行为 |
|-----------|------------|------|
| `Enter` | `Enter` | 发送消息 |
| `Shift+Enter` | `Shift+Enter` | 输入框换行 |
| `Ctrl+C`（busy） | `Esc` / 点击 Stop | 中断 Agent |
| `Ctrl+C`（idle） | 关闭标签页 | 退出 |
| `Tab`（空输入） | — | 打开权限模式选择器 |
| `↑↓`（非命令补全时） | `↑↓` | 历史消息导航 |
| `↑↓`（命令补全时） | `↑↓` | 在补全列表中导航 |
| `Escape`（输入有内容） | `Escape` | 清空输入框 |
| `Ctrl+W` | 点击折叠按钮 | 折叠/展开 SwarmPanel |
| — | `Ctrl+K` | 打开全局命令面板 |
| `Y/N`（权限弹窗） | `Y/N` 或按钮 | 权限授权/拒绝 |
| `1-9`（SelectModal） | `1-9` 或点击 | 快速选择选项 |

### D5: TUI 组件 → Web 组件映射（完整）

| TUI 组件 | Web 对应 | 路由/位置 | 对应 BackendEvent |
|----------|---------|---------|----------------|
| WelcomeBanner | `WelcomePage` | `/` 首页 | — |
| ConversationView | `ChatPage` | `/chat/:sessionId` | 多事件驱动 |
| TranscriptPane | `TranscriptViewer` | ChatPage 内嵌 | `transcript_item`、`clear_transcript` |
| ToolCallDisplay | `ToolCallCard` | TranscriptViewer 内嵌 | `tool_started`、`tool_completed` |
| TodoPanel | `TaskBoard` | 右侧边栏 | `tasks_snapshot`、`todo_update` |
| SwarmPanel | `SwarmDashboard` | `/swarm` 独立页 | `swarm_status`（teammates + notifications） |
| SidePanel | `Sidebar` | 全局布局 | `state_snapshot`（bridge_sessions） |
| CommandPicker | `CommandPalette` | Ctrl+K 全局触发 | `ready`（commands 列表） |
| Composer + PromptInput | `MessageInput` | ChatPage 底部 | `line_complete`（控制可用状态） |
| StatusBar + Footer | `StatusBar` | 全局底部 | `state_snapshot`（model、plan_mode、fast_mode、mcp_connected/mcp_failed、token 用量） |
| MarkdownText | `MDRenderer` | 复用 react-markdown | `transcript_item`（assistant role） |
| ModalHost + SelectModal | `SelectModal` | 全局 provider | `select_request`（模型切换等） |
| Spinner | `LoadingIndicators` | 各处复用 | `assistant_delta` 等流式状态 |
| permission_dialog | `PermissionModal` | 全局 modal | `modal_request(kind=permission)` |
| —（新增） | `QuestionModal` | 全局 modal | `modal_request(kind=question)` |
| —（新增） | `CompactProgressBar` | ChatPage 顶部 | `compact_progress`（phase、attempt、checkpoint） |
| —（新增） | `ErrorToast` | 全局通知 | `error` |
| —（新增） | `PlanModeIndicator` | StatusBar 内嵌 | `plan_mode_change` |
| —（新增） | `McpStatusBadge` | StatusBar 内嵌 | `state_snapshot`（mcp_connected、mcp_failed） |

### D6: 实时通信

Web 端通过 `WebSocket` 连接 Gateway `/ws/{session_id}`，使用与 TUI 完全相同的 `BackendEvent` JSON 格式。前端维护本地 `useSessionStore`（Zustand）存储会话状态，Gateway 推送的 `state_snapshot` 事件整体替换 store。

### D7: 目录结构

```
HLAgent/
├── sdk/                   # openharness editable install 包装
│   └── pyproject.toml
├── gateway/               # FastAPI Gateway 服务
│   ├── main.py
│   ├── routers/
│   │   ├── onboarding.py  # Onboarding 向导状态 + 项目初始化
│   │   ├── sessions.py    # 会话管理 REST（含 export/tag/rewind/context）
│   │   ├── ws.py          # WebSocket 双向通信
│   │   ├── cron.py        # 定时任务 CRUD REST
│   │   ├── swarm.py       # Swarm 团队管理 REST（14 个端点）
│   │   ├── memory.py      # Memory 文件管理 REST
│   │   ├── tasks.py       # Background tasks REST
│   │   ├── auth.py        # 认证状态管理 REST
│   │   ├── settings.py    # 配置读取/更新 REST
│   │   ├── mcp.py         # MCP 服务器状态 REST
│   │   ├── skills.py      # Skills 列表 REST
│   │   ├── autopilot.py   # Repo Autopilot REST
│   │   ├── git.py         # Git 集成 REST（diff/branch/commit）
│   │   └── debug.py       # 环境诊断 + hooks 列表
│   ├── services/
│   │   └── session_manager.py
│   └── pyproject.toml
└── web/                   # React + Vite Web UI
    ├── src/
    │   ├── pages/         # WelcomePage, ChatPage, OnboardingPage,
    │   │                  # CronPage, SwarmPage, MemoryPage, SkillsPage, AutopilotPage
    │   ├── components/    # 所有 UI 组件
    │   ├── stores/        # Zustand stores（session/task/swarm/ui）
    │   ├── hooks/         # WebSocket hook
    │   ├── utils/         # toolDisplay.ts, toolCategories.ts
    │   └── types/         # protocol + cron + swarm + memory + tasks 类型定义
    ├── package.json
    └── vite.config.ts
```

### D8: Gateway — 工具执行 / 权限 / Swarm / Cron REST API

除 D3 定义的 Session WebSocket API 外，Gateway 还需提供以下 REST 端点：

**权限模式管理：**
| 端点 | 说明 |
|------|------|
| `GET /api/sessions/{id}/permission-mode` | 返回当前模式（default/plan/full_auto）和 path_rules |
| `POST /api/sessions/{id}/permission-mode` | body: `{"mode": "plan"}` 切换模式（等效于 /permissions 命令） |

**Swarm 团队管理（完整，与 spec/hlagent-gateway 对齐）：**
| 端点 | 说明 |
|------|------|
| `GET /api/swarm/teams` | 列出所有团队摘要（name/description/member_count/active_count） |
| `GET /api/swarm/teams/{team}` | 获取完整 TeamFile（含所有 members 字典和 team_allowed_paths）|
| `POST /api/swarm/teams` | 创建新团队（TeamLifecycleManager.create_team()）|
| `DELETE /api/swarm/teams/{team}` | 删除团队目录 |
| `GET /api/swarm/teams/{team}/members/{agent_id}` | 获取单个成员完整详情 |
| `GET /api/swarm/teams/{team}/pending-permissions` | 扫描 leader mailbox，返回待处理 permission_request |
| `POST /api/sessions/{id}/spawn` | 生成 teammate，body 含 name/team/prompt/model/color/worktree_path 等 |
| `GET /api/swarm/agents/{agent_id}/transcript` | 通过 TeamMember.session_id 获取 agent 对话 transcript |
| `POST /api/swarm/agents/{agent_id}/message` | 向 teammate 发消息（create_user_message 写入 mailbox） |
| `POST /api/swarm/agents/{agent_id}/permission-response` | Leader 批准/拒绝 Worker 权限请求 |
| `DELETE /api/swarm/agents/{agent_id}` | 关闭 teammate（create_shutdown_request 写入 mailbox） |
| `GET /api/swarm/agents/{agent_id}/messages` | 读取 agent mailbox（支持 unread_only 查询参数） |
| `PATCH /api/swarm/agents/{agent_id}/messages/{msg_id}/read` | 标记消息已读 |

**定时任务管理（直接操作 openharness cron registry，不需 Agent 会话）：**
| 端点 | 说明 |
|------|------|
| `GET /api/cron/jobs` | 列出所有 cron job（含 schedule/enabled/last_run/next_run） |
| `POST /api/cron/jobs` | 创建/更新 cron job，body 对应 `CronCreateToolInput` 字段 |
| `DELETE /api/cron/jobs/{name}` | 删除 cron job |
| `PATCH /api/cron/jobs/{name}/toggle` | 启用/禁用 job，body: `{"enabled": bool}` |
| `GET /api/cron/jobs/{name}/history` | 返回执行历史（最近 50 条，从 cron_history.jsonl 读取） |
| `GET /api/cron/scheduler/status` | 返回调度器状态：`{"running": bool, "tick_interval": 30}` |

### D9: SDK 层 — 工具执行 / 权限 / Swarm / Cron 功能覆盖

SDK（`WebBackendHost`）通过继承 `ReactBackendHost` 已自动处理工具执行事件流（`tool_started` / `tool_completed`）。

Gateway 的 Swarm 和 Cron REST API 直接调用 openharness 服务层，不需要 Agent 会话，因此 SDK 层不需额外封装这些功能——Gateway routers 直接 `from openharness.services.cron import load_cron_jobs, upsert_cron_job` 和 `from openharness.swarm.team_lifecycle import TeamLifecycleManager`。

**工具执行 Web UI 分类规则（ToolCallCard 展示策略）：**

| 工具类型 | 识别方式 | Web 展示重点 |
|---------|---------|------------|
| BashTool | tool_name="Bash" | 展示命令（代码块）+ 输出（代码块，截断 500 字符）|
| 文件读取 | Read/Glob/Grep | 展示文件路径，输出可折叠 |
| 文件写入 | Write/Edit/MultiEdit | 展示文件路径，diff 风格输出 |
| Agent工具 | Agent/agent | 展示 subagent_type + prompt 摘要，链接到子任务 |
| Cron工具 | cron_create/cron_list 等 | 展示 cron job 名称/schedule |
| MCP工具 | mcp_* | 展示 MCP server 名称 + 参数 |
| 其他工具 | 默认 | 展示工具名 + JSON 参数（可折叠）|

**权限模式行为（影响 PermissionModal 触发条件）：**

| 模式 | 行为 |
|------|------|
| `default` | 非只读工具（写文件/执行命令）触发 PermissionModal |
| `plan` | 所有写操作工具被阻断（不触发 modal，直接返回错误），Web UI 显示红色 PLAN MODE 阻断提示 |
| `full_auto` | 所有工具自动允许，不触发 PermissionModal |

**Swarm 协作消息流：**

Leader（当前会话）→ Gateway POST /api/swarm/agents/{id}/message → 写入 mailbox 文件
Teammate → openharness 运行时读取 mailbox → 执行任务 → 通过 swarm_status BackendEvent 更新 UI

**Cron Job 数据结构（Gateway ↔ Web UI 交换格式）：**
```typescript
interface CronJob {
  name: string
  schedule: string        // 标准 5-field cron
  timezone?: string       // IANA timezone
  command?: string        // shell 命令
  message?: string        // agent_turn 消息（替代 command）
  enabled: boolean
  payload?: {             // nanobot 式 payload
    kind: "agent_turn"
    channel?: string      // "feishu" | "slack" 等
    to?: string           // 目标用户/群 ID
  }
  notify?: {              // 执行结果通知
    type: "feishu_dm"
    user_open_id: string
  }
  cwd?: string
  last_run?: string       // ISO8601
  next_run?: string       // ISO8601
  last_status?: string    // "success" | "error" | ""
}
```

**全量 OpenHarness 命令 vs Gateway 覆盖矩阵（完整）：**

> 注：WebSocket `submit_line` 可以执行任何 slash 命令，REST API 只补充需要独立数据访问的功能。

| 功能域 | Slash 命令 | 覆盖方式 |
|--------|-----------|---------|
| 会话状态 | /status, /cost, /usage, /stats | `GET /api/sessions/{id}` + AppState |
| 上下文 | /context | `GET /api/sessions/{id}/context` |
| 摘要 | /summary | `GET /api/sessions/{id}/summary` |
| 压缩 | /compact | WebSocket submit_line |
| 回退 | /rewind | `DELETE /api/sessions/{id}/messages/last` |
| 标签快照 | /tag | `POST /api/sessions/{id}/tag` |
| 导出 | /export | `GET /api/sessions/{id}/transcript` |
| 恢复历史 | /resume | `GET /api/sessions` |
| Memory 列表 | /memory | `GET /api/memory/files` + `GET/POST/DELETE /api/memory/{name}` |
| Memory 整合 | /dream | `POST /api/memory/dream` |
| 认证状态 | /login, /logout | `GET /api/auth/status`, `POST /api/auth/login`, `DELETE /api/auth` |
| 配置 | /config, /fast, /effort, /passes, /turns, /vim, /voice | `GET /api/settings`, `PATCH /api/settings` |
| 模型/Provider | /model, /provider | `GET /api/settings/profiles` + apply_select_command via WS |
| 权限模式 | /permissions, /plan | 已覆盖 |
| MCP | /mcp | `GET /api/mcp/servers` |
| 技能 | /skills | `GET /api/skills` |
| 插件 | /plugin | `GET /api/plugins` |
| 背景任务 | /tasks, /agents, /subagents | `GET/DELETE /api/tasks`, `GET /api/tasks/{id}` |
| Autopilot | /autopilot, /ship | `GET /api/autopilot/tasks`, `POST /api/autopilot/ship` |
| Git | /diff, /branch, /commit | `GET /api/git/diff`, `GET /api/git/branch`, `POST /api/git/commit` |
| Cron | cron 工具 | 已覆盖 |
| Swarm | 团队协作 | 已覆盖 |
| 主题/样式 | /theme, /output-style | apply_select_command via WS |
| 调试 | /doctor, /hooks, /keybindings | `GET /api/debug/doctor`, `GET /api/debug/hooks` |
| 分享 | /share | `POST /api/sessions/{id}/share` |

**完整 Gateway REST API 补充（D8 修订）：**

```
Memory 管理:
  GET    /api/memory/files              → list_memory_files(cwd)
  GET    /api/memory/{filename}         → 读取 memory 文件内容
  POST   /api/memory                    → add_memory_entry(cwd, title, content)
  DELETE /api/memory/{filename}         → remove_memory_entry(cwd, name)
  POST   /api/memory/dream              → 触发 autodream 整合

Session 扩展:
  GET    /api/sessions                  → 列出已保存会话（SessionBackend）
  GET    /api/sessions/{id}/context     → 返回当前 system prompt
  GET    /api/sessions/{id}/summary     → 对话摘要（summarize_messages）
  GET    /api/sessions/{id}/transcript  → 导出完整 transcript（text/markdown）
  POST   /api/sessions/{id}/tag         → 创建命名快照
  DELETE /api/sessions/{id}/messages/last → 回退最后一轮 (/rewind)
  POST   /api/sessions/{id}/share       → 创建可分享快照

Auth 管理:
  GET    /api/auth/status               → auth_status(settings) + 各 provider 状态
  POST   /api/auth/login                → 存储 API Key (provider + key)
  DELETE /api/auth                      → 清除 credential

Settings:
  GET    /api/settings                  → 当前有效 settings（model/provider/fast_mode/effort/etc.）
  PATCH  /api/settings                  → 更新 settings 字段（fast_mode/effort/passes/turns/vim/voice）
  GET    /api/settings/profiles         → 列出所有 provider profiles
  PATCH  /api/settings/profiles/{name}  → 更新 profile 的 model/allowed_models

MCP:
  GET    /api/mcp/servers               → 列出配置的 MCP server 状态

Skills & Plugins:
  GET    /api/skills                    → 列出可用 skills（SkillRegistry）
  GET    /api/skills/{name}             → 读取 skill 内容
  GET    /api/plugins                   → 列出已安装插件

Background Tasks:
  GET    /api/tasks                     → list all tasks（get_task_manager().list_tasks()）
  GET    /api/tasks/{id}                → 获取 task 状态和输出
  DELETE /api/tasks/{id}               → 停止 task

Autopilot:
  GET    /api/autopilot/tasks           → 列出 repo autopilot 任务
  POST   /api/autopilot/ship            → 提交 repo 任务

Git:
  GET    /api/git/diff                  → git diff 输出（cwd 参数）
  GET    /api/git/branch                → 当前分支信息
  POST   /api/git/commit                → 创建 git commit（message + files）

Debug:
  GET    /api/debug/doctor              → 环境诊断（doctor 命令输出）
  GET    /api/debug/hooks               → 已配置 hooks 列表
```

### D10: 端到端串联流程（关键场景）

#### 流程 A：用户发送消息 → Agent 执行工具 → 回复

```
Web UI (MessageInput)
  Enter ↓ sendRequest({type:"submit_line", line:"..."}])
    │
Gateway (ws.py WS handler)
  await host.push_request(req) → ws_input_queue
    │
WebBackendHost (_read_requests)
  → _request_queue → 主循环 → _process_line()
    │
ReactBackendHost (_process_line)
  emit(transcript_item user) → event_queue → WS → sessionStore.addTranscriptItem ✓
  handle_line(bundle, line, render_event=_render_event)
    │
    └─ engine.submit_message()
         ToolExecutionStarted  → emit(tool_started)  → WS → sessionStore 插入 ToolCallCard ✓
         AssistantTextDelta    → emit(assistant_delta) → WS → sessionStore.appendDelta ✓
         ToolExecutionCompleted→ emit(tool_completed)  → WS → sessionStore 更新 ToolCallCard ✓
         AssistantTurnComplete → emit(assistant_complete) → WS → sessionStore.completeAssistant ✓
    emit(tasks_snapshot)   → WS → taskStore.setTasks ✓
    emit(state_snapshot)   → WS → sessionStore.setAppState ✓
    emit(line_complete)    → WS → sessionStore.setBusy(false) ✓
```

#### 流程 B：Agent 请求权限 → 用户响应

```
WebBackendHost (_ask_permission)
  emit(modal_request{kind:"permission", request_id, tool_name, reason})
    → WS → uiStore.setActiveModal(permission) ✓
    → Web UI: PermissionModal 弹出

Web UI (PermissionModal Y/N)
  sendRequest({type:"permission_response", request_id, allowed:true})
    │
WebBackendHost (_read_requests) — 直接处理：
  _permission_requests[request_id].set_result(True)  ← Future resolved
  → _ask_permission() unblocks → 工具继续执行 ✓

Web UI: PermissionModal 关闭（收到下一个 tool_started/tool_completed）
```

#### 流程 C：/model 命令 → 模型切换

```
Web UI (CommandPicker 选择 /model)
  sendRequest({type:"select_command", command:"model"})
    │
WebBackendHost 主循环 → _handle_select_command("model")
  emit(select_request{modal:{kind:"select",title:"Model",...}, select_options:[...]})
    → WS → uiStore.setActiveModal(select) ✓
    → Web UI: SelectModal 弹出（当前 active 模型高亮）

Web UI (SelectModal 用户选择)
  sendRequest({type:"apply_select_command", command:"model", value:"claude-opus-4-7"})
    │
WebBackendHost → _apply_select_command("model", "claude-opus-4-7")
  → refresh_runtime_client(bundle)  ← 实际更新 engine.model
  emit(state_snapshot)  → WS → sessionStore.setAppState ← StatusBar 模型名更新 ✓
  emit(line_complete)
```

#### 流程 D：REST 读取会话状态（GET /api/sessions/{id}）

```
Web UI fetch("GET /api/sessions/{id}")
  │
Gateway (sessions.py router)
  host = session_mgr.get(session_id)
  if not host.is_ready: return 503
  state = host.app_state   ← host._bundle.app_state.get()
  return state.model_dump() ✓

注意：host.is_ready 检查 host._bundle is not None
```

#### 流程 E：Cron Job 创建（REST，无需 Agent 会话）

```
Web UI (CronPage 表单提交)
  fetch("POST /api/cron/jobs", body:{name, schedule, message, ...})
    │
Gateway (cron.py router)
  validate_cron_expression(schedule) → 422 if invalid
  upsert_cron_job(job_dict)  ← 直接写 ~/.openharness/cron_jobs.json
  return 201 ✓

注意：此流程完全独立于 Agent 会话
若 Agent 会话活跃，同一 cron_list BackendEvent 会由 cron_list tool 触发
```

#### 流程 F：Settings PATCH（影响所有活跃会话）

```
Web UI (SettingsDrawer 修改 fast_mode=true)
  fetch("PATCH /api/settings", body:{fast_mode: true})
    │
Gateway (settings.py router)
  load_settings() → merge → save_settings(updated)  ← 持久化
  for host in session_mgr.get_all_ready():
      # 通知运行中的 host 刷新设置
      await host.push_request(FrontendRequest(type="submit_line", line="/fast on"))
      # WebBackendHost 处理后 emit(state_snapshot) → 各 WS 客户端更新 ✓
  return 200
```

#### 流程 G：Web UI 初始化（冷启动）

```
Web UI 首次加载
  WelcomePage: fetch("GET /api/sessions") → 显示历史会话列表
               fetch("GET /api/auth/status") → Sidebar 认证状态
               fetch("GET /api/mcp/servers") → Sidebar MCP 状态
    │
用户点击"开始新对话"
  fetch("POST /api/sessions", {model, cwd}) → {session_id} ✓
  navigate("/chat/{session_id}")
    │
ChatPage 挂载
  useWebSocket.connect("WS /ws/{session_id}")
    │
Gateway (ws.py)
  host = session_mgr.get(session_id)
  await host.start()  ← 启动 host.run() 后台 task
    │
host.run() (ReactBackendHost)
  await build_runtime(...)  ← 初始化所有模块（耗时 1-3s）
  await start_runtime(...)
  await emit(ready{state, tasks, commands, mcp_servers, bridge_sessions})
    → WS → sessionStore 初始化 ✓ → StatusBar 显示 model ✓ → host.is_ready = True
  await emit(state_snapshot)
  while running: 等待请求...
    │
Web UI: 收到 ready 事件 → wsStatus='ready' → MessageInput 解锁 → 用户可输入 ✓
```

#### 流程 H：Onboarding（首次使用检测与向导）

**设计原则：**
- 检测以服务端状态为准，不依赖 localStorage（localStorage 仅缓存"导览是否已看"）
- 未配置 auth 时展示**软提示横幅**，不强制全局重定向（避免阻断 Memory/Skills 等无需 Agent 的页面）
- 创建 Chat 会话时若未配置 auth，**才强制跳转** Onboarding
- API Key 仅存储不验证（auth_status 无实际 API 测试能力），首次使用时自然发现无效 key

```
Web UI 访问任意页面
  ↓
OnboardingGuard（路由守卫）：
  fetch("GET /api/onboarding/status") → {auth_configured, auth_status, cwd, project_initialized, version}
    ↓
  auth_configured = false AND 目标路由是 /chat/*：→ 强制跳转 /onboarding
  auth_configured = false AND 其他路由：→ 展示 AuthBanner（软提示横幅，不重定向）
  auth_configured = true：→ 正常渲染

AuthBanner（软提示，常驻顶部直到配置完成）：
  "⚠️ 未配置 AI Provider，对话功能不可用。 [立即配置 →]"

OnboardingPage（5步向导，Step4 CWD 已移除，降级为 Settings）：

Step 1: 欢迎 + 环境诊断
  fetch("GET /api/onboarding/status") 数据已有，无需额外请求
  显示：HLAgent 标识 + Gateway 版本 + Python 版本 + 当前 cwd
  展示当前已配置的 provider 状态（若有）

Step 2: 选择 AI Provider
  fetch("GET /api/settings/profiles") → 展示内置 profiles
  卡片选项：
    ● Anthropic API Key（🌟 推荐）— 需要 API Key
    ● Claude Subscription（OAuth）— 需要 CLI 辅助或 OAuth 重定向
    ● OpenAI Compatible — 需要 API Key + base_url
    ● GitHub Copilot（OAuth）— 需要 CLI 辅助
    ● 其他（自定义 base_url）
  用户选择后进入 Step 3

Step 3: 输入凭据（根据 Step 2 选择动态渲染）
  ■ anthropic：
    - API Key 输入框（密码型，占位符 "sk-ant-..."）
    - "获取 API Key"说明文字（非链接，避免外链安全问题）
    - 点击"保存"→ POST /api/auth/login{provider, api_key}
    - 成功后显示"✓ 已保存（将在首次对话时验证有效性）"
    - 注意：不实际验证 key 有效性，仅存储

  ■ openai / openai-compatible：
    - base_url 输入框（必填，默认 https://api.openai.com/v1）
    - API Key 输入框
    - 保存逻辑同上

  ■ claude_subscription / copilot（OAuth 类）：
    - 说明："此 Provider 需通过 OAuth 绑定，暂不支持 Web 直接配置"
    - 展示命令：`oh auth claude-login` / `oh auth copilot-login`
    - 提供"刷新检查"按钮（重新 fetch /api/onboarding/status 检查是否已通过 CLI 完成）
    - 若检测到已配置，显示"✓ 检测到认证"，自动进入 Step 4

Step 4: 项目初始化（可选）
  展示：是否在当前目录（来自 onboarding/status.cwd）创建 CLAUDE.md 和 .openharness/ 目录？
  [跳过] [初始化项目]
  若选择初始化：
    POST /api/onboarding/init-project  ← 新增 REST 端点，Gateway 直接调用 _init_handler 逻辑
    无需创建完整 Agent 会话和 WebSocket
    成功后显示"✓ 已创建 CLAUDE.md 和 .openharness/ 目录"

Step 5: 功能导览
  展示 6 个功能卡片（2×3）
  [开始使用 →] → POST /api/sessions 创建会话 → 跳转 /chat/{id}
  设置 localStorage.hlagent_tour_seen=true（标记"导览已看"，但不作为 auth 检查依据）

```

### D11: Onboarding Gateway API（修订版）

**修订内容：**
- 统一使用 `/api/onboarding/status` 作为唯一检测入口（已在 spec 中）
- 新增 `POST /api/onboarding/init-project` 替代 WS /init（避免创建完整 Agent 会话）
- `POST /api/auth/login` 仅存储凭据，不验证有效性（文档化此行为）

| 端点 | 说明 |
|------|------|
| `GET /api/onboarding/status` | 聚合检查（已设计）|
| `POST /api/auth/login` | 存储 API Key，不验证有效性，200 表示存储成功 |
| `POST /api/onboarding/init-project` | **新增**：直接调用 /init 逻辑（创建 CLAUDE.md + .openharness/），返回创建的文件列表 |

**关键设计决定：**
- API Key 验证：`POST /api/auth/login` 返回 200 仅表示"存储成功"，不测试 API 连通性；key 有效性在首次 Chat 会话的 `build_runtime()` 时自然验证
- 无效 key 时，Chat 会话的 `ready` 事件不会发出，WebSocket 连接会报错，Web UI 展示 ErrorToast
- 工作目录：onboarding 不修改 cwd，用户可在 Settings 中修改；onboarding/status 返回当前 cwd 供参考

## Risks / Trade-offs

- **[风险] OpenHarness SDK 依赖 TUI 模块** → `openharness.ui.*` 可能被 SDK 层内部使用：Mitigation：gateway 直接 import openharness 完整包，只在 web 端不引入 TUI 渲染相关代码（Ink/Textual）
- **[风险] WebSocket 协议扩展破坏 TUI** → gateway 扩展协议时 TUI 不感知：Mitigation：只做加法（新增字段用 Optional），不删改现有字段
- **[风险] Windows 路径和软链接兼容** → Windows junction 可能需要管理员权限：Mitigation：首版直接 `pip install -e e:/AI/OpenHarness`，不用符号链接
- **[Trade-off] 复用 openharness 包 vs 独立 SDK** → 耦合度高但开发速度快：首版选速度，后续再解耦

## Migration Plan

1. 创建 `HLAgent/` 目录结构（不影响现有代码）
2. 配置 `HLAgent/sdk/pyproject.toml` 依赖 openharness
3. 实现 Gateway，复用现有协议
4. 实现 Web UI，逐组件开发
5. 验证 Gateway ↔ Web 端到端通信
6. 验证现有 TUI 不受影响

**回滚**：整个 `HLAgent/` 目录独立，删除即完全回滚，零风险。

## D12: 权限管理 UI 设计（Permission Management UI）

### 背景与现状分析

OpenHarness 权限系统有三个层次：

```
全局默认（~/.openharness/settings.json）
    └── permission.mode: "default" | "plan" | "full_auto"
    └── allowed_tools / denied_tools / path_rules / denied_commands

会话运行时（AppState.permission_mode）
    └── /permissions {mode} 命令可覆盖（但写回全局，无独立会话范围）
    └── state_snapshot 事件实时同步到前端 sessionStore.planMode

单次工具请求（per-request）
    └── modal_request{kind:permission} → PermissionModal 弹窗
    └── Y/N → permission_response → 工具继续/中止
```

**关键约束**：OpenHarness 当前不区分"会话范围"和"全局范围"——`/permissions full_auto` 会写回全局 settings.json，下次启动仍生效。

### 三种模式行为

| 模式 | 枚举值 | 行为 |
|------|--------|------|
| 默认 | `"default"` | 写操作逐一弹窗确认 |
| 计划 | `"plan"` | 所有写操作直接阻断（不弹窗）|
| 全自动 | `"full_auto"` | 所有工具自动放行（不弹窗）|

敏感路径（`.ssh/*`、`.aws/credentials` 等）无论什么模式都**始终拒绝**。

### 设计决策

**D12.1：StatusBar 显示当前模式，可点击切换（会话范围）**

```
● mimo-v2-omni  [default]  ⚡fast  MCP:3  ●green
                   ↑
              灰色可点击 → 弹出权限模式 SelectModal
              切换后通过 submit_line "/permissions {mode}" 生效
```

- `[default]` 灰色 · `[PLAN]` 黄色加粗 · `[auto]` 绿色
- 点击发送 `select_command{command:"permissions"}` → 走现有 SelectModal 流程
- 仅在有活跃 WS 会话时可点击（否则无意义）

**D12.2：PermissionModal 增加"本次全部允许"按钮**

```
┌─────────────────────────────────────────────────────┐
│  ⚠️ 权限请求   工具: bash                           │
│  Mutating tools require user confirmation            │
│                                                      │
│  [N 拒绝]   [Y 允许]   [⚡ 本次全部允许]            │
│  键盘: Y/Enter 允许 · N/Esc 拒绝                    │
└─────────────────────────────────────────────────────┘
```

- "本次全部允许"行为：① 先 allow 当前请求 → ② 再发 `submit_line "/permissions full_auto"`
- 敏感路径时**不显示**此按钮（不允许对凭据文件提升权限）
- 工具提示：点击后显示 Toast "已切换到全自动模式（写入全局配置）"

**D12.3：SettingsDrawer 增加全局默认权限模式**

```
────────── 权限设置 ──────────
默认权限模式（新会话启动时的初始模式）
○ Default（逐一确认）← 推荐
○ Plan Mode（阻断写操作）
○ Full Auto（全部放行）
[保存为全局默认]

当前会话模式: default（可在对话中用 /permissions 命令覆盖）
──────────────────────────────
```

- "保存"调用 `PATCH /api/settings{permission_mode: "..."}` → 写入全局 settings.json
- 实时显示当前会话模式与全局默认的差异

### SDK 层说明

**SDK 层（WebBackendHost）无需任何修改**，权限逻辑完全由继承的 `ReactBackendHost` 处理：
- per-request 弹窗：`_ask_permission()` → `emit(modal_request)` → PermissionModal → `permission_response` → resolve Future
- 模式切换：`submit_line "/permissions full_auto"` → `_request_queue` → `_permissions_handler` → `save_settings()` → `state_snapshot`
- 会话创建时传入初始模式：`AgentSessionConfig.permission_mode`（已有字段，透传至 `BackendHostConfig`）

### Gateway 侧补充

`PATCH /api/settings` 需支持 `permission_mode` 字段。**注意**：该字段映射到嵌套对象 `settings.permission.mode`，不能直接通过顶层 `model_copy` 设置，需要替换整个 `permission` 子对象：

```python
if req.permission_mode is not None:
    from openharness.permissions.modes import PermissionMode
    # 必须 model_copy 嵌套的 PermissionSettings 对象
    updated_perm = s.permission.model_copy(
        update={"mode": PermissionMode(req.permission_mode)}
    )
    updates["permission"] = updated_perm   # 替换整个 permission 子对象

# 保存后，还需要推送给活跃会话保持实时同步：
for host in session_mgr.get_all_ready():
    await host.push_request(
        FrontendRequest(type="submit_line", line=f"/permissions {req.permission_mode}")
    )
    # WebBackendHost 处理后 emit(state_snapshot) → StatusBar 徽章即时更新
```

`GET /api/settings` 返回值需增加：`"permission_mode": settings.permission.mode.value`（从嵌套字段读取）。

### 实现优先级

| 阶段 | 功能 | 优先级 |
|------|------|--------|
| P1 | StatusBar 模式徽章可见 + 点击切换 | 高 |
| P1 | PermissionModal "本次全部允许"按钮 | 高 |
| P2 | SettingsDrawer 全局默认模式配置 | 中 |
| P3 | 路径规则/工具黑白名单编辑 UI | 低 |

## Open Questions

- Gateway 是否需要支持多并发会话？（首版：单会话即可）
- Web UI 是否需要暗色模式？（首版：默认深色主题，类 VSCode 风格）
