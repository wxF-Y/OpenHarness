## ADDED Requirements

### Requirement: SDK 层通过 WebBackendHost 封装 ReactBackendHost
HLAgent SDK SHALL 提供 `WebBackendHost` 类，继承自 `openharness.ui.backend_host.ReactBackendHost`，将 stdin/stdout I/O 替换为 asyncio 内部队列，使 Gateway 能通过队列接口与 Agent 运行时通信，而无需 subprocess 或管道。

#### Scenario: Gateway 通过 push_request 注入用户输入
- **WHEN** Gateway WS handler 接收到 `FrontendRequest` JSON 并调用 `host.push_request(req)`
- **THEN** 请求进入 `_ws_input_queue`，`WebBackendHost._read_requests()` 读取并路由：permission/question response 直接 resolve 对应 Future，interrupt 取消当前 task，其余进入 `_request_queue` 主循环

#### Scenario: Gateway 通过 next_event 读取 Agent 输出
- **WHEN** `ReactBackendHost` 内部调用 `_emit(event)` 发出 `BackendEvent`
- **THEN** 事件进入 `_event_queue`，Gateway WS handler 通过 `await host.next_event()` 读取，返回 `None` 表示会话结束（shutdown 后的 sentinel）

#### Scenario: host.is_ready 状态检查
- **WHEN** Gateway REST handler 调用 `host.is_ready`（在 WebSocket 连接建立并调用 `host.start()` 后约 1-3 秒）
- **THEN** 返回 True 表示 `_bundle` 已初始化（`build_runtime()` 完成），REST 端点可安全读取 `host.app_state`

#### Scenario: Gateway REST 读取 AppState
- **WHEN** 客户端调用 `GET /api/sessions/{id}`，Gateway 执行 `host.app_state`
- **THEN** 返回 `AppState` 对象（含 model/cwd/provider/auth_status/permission_mode/fast_mode/effort/mcp_connected 等字段），来自 `host._bundle.app_state.get()`

#### Scenario: host.start() 非阻塞启动
- **WHEN** Gateway WebSocket handler 调用 `await host.start()`
- **THEN** `host.run()` 在独立 asyncio Task 中后台运行，`start()` 立即返回；WS handler 无需等待 build_runtime 完成即可开始转发消息

### Requirement: SDK 暴露 AgentSessionConfig 工厂接口
SDK SHALL 提供 `AgentSessionConfig` dataclass 和 `create_host(config)` 工厂函数，将上层配置映射到 `BackendHostConfig`。

#### Scenario: 通过 AgentSessionConfig 创建 WebBackendHost
- **WHEN** Gateway 调用 `create_host(AgentSessionConfig(model="claude-sonnet-4-6", cwd="/path"))`
- **THEN** 返回一个已配置的 `WebBackendHost` 实例（尚未 start），内部 `BackendHostConfig` 包含所有 openharness 运行时参数

### Requirement: SDK 不引入 TUI 渲染依赖
SDK 模块（`hlagent_sdk`）导入时 SHALL 不触发 Ink（Node.js/React）或 Textual（Python TUI）库的加载，只依赖 `openharness` 包本身。

#### Scenario: 纯 Python 环境中导入 SDK
- **WHEN** 在未安装 Node.js 或 textual 的 Python 环境中执行 `from hlagent_sdk import WebBackendHost, create_host`
- **THEN** 无 ImportError；`openharness.ui.backend_host` 可正常导入（它只依赖 Python asyncio/pydantic，不依赖 Ink/Textual）

### Requirement: SDK 暴露会话状态读取接口
WebBackendHost SHALL 提供只读属性和方法，供 Gateway REST handler 安全读取运行时状态。

#### Scenario: 读取可用命令列表
- **WHEN** `host.is_ready = True` 后调用 `host.commands`
- **THEN** 返回 `list[str]`，来自 `_bundle.commands.list_commands()`（如 `["/help", "/memory", "/compact", ...]`）

#### Scenario: 获取当前 system prompt
- **WHEN** 调用 `host.get_system_prompt()`（is_ready 后）
- **THEN** 返回 `host._bundle.engine.system_prompt` 字符串

#### Scenario: 回退最后一轮（/rewind）
- **WHEN** Gateway 调用 `host.pop_last_turn()`
- **THEN** 从 `host._bundle.engine.messages` 移除最后一次 user+assistant 消息对，返回 `True`；若无可回退消息返回 `False`
