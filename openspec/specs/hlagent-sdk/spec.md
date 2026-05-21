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

---

## ADDED Requirements (show-model-thinking)

### Requirement: ApiMessageRequest 支持 thinking 参数

`ApiMessageRequest` 数据类 SHALL 包含可选的 `thinking: dict[str, Any] | None` 字段，当值为非 None 时表示启用 extended thinking。

#### Scenario: thinking 字段为 None 时不修改 API 请求
- **WHEN** `ApiMessageRequest.thinking` 为 `None`
- **THEN** 发送给 Anthropic API 的 `params` 中不包含 `thinking` 键

#### Scenario: thinking 字段有值时注入 API 参数
- **WHEN** `ApiMessageRequest.thinking` 为 `{"type": "enabled", "budget_tokens": 8000}`
- **THEN** 发送给 Anthropic API 的 `params["thinking"]` 等于该值

---

### Requirement: 非 OAuth 路径自动追加 interleaved-thinking beta header

当 thinking 启用且使用 API key（非 OAuth）时，系统 SHALL 在每次 stream 请求中通过 `extra_headers` 追加 `"interleaved-thinking-2025-05-14"` beta header，不修改 client 实例全局状态。

#### Scenario: 非 OAuth 路径启用 thinking 时追加 beta header
- **WHEN** `request.thinking` 非 None 且 `self._claude_oauth` 为 False
- **THEN** `params["extra_headers"]["anthropic-beta"]` 包含 `"interleaved-thinking-2025-05-14"`

#### Scenario: OAuth 路径不重复追加 beta header
- **WHEN** `request.thinking` 非 None 且 `self._claude_oauth` 为 True
- **THEN** beta header 由 `claude_oauth_betas()` 已包含，`params["extra_headers"]` 不额外追加

---

### Requirement: 流式接收并 yield thinking delta 事件

`_stream_once` SHALL 识别 `content_block_delta` 事件中 `delta.type == "thinking_delta"` 的情况，并 yield `ApiThinkingDeltaEvent(thinking=delta.thinking)`。

#### Scenario: thinking_delta 事件正确 yield
- **WHEN** Claude API 流中出现 `type=content_block_delta, delta.type=thinking_delta, delta.thinking="某段思考"`
- **THEN** `_stream_once` yield `ApiThinkingDeltaEvent(thinking="某段思考")`

#### Scenario: text_delta 事件处理不受影响
- **WHEN** 流中同时含 thinking_delta 和 text_delta
- **THEN** thinking_delta yield `ApiThinkingDeltaEvent`，text_delta yield `ApiTextDeltaEvent`，顺序与流顺序一致

---

### Requirement: AssistantThinkingDelta StreamEvent

`stream_events.py` SHALL 定义 `AssistantThinkingDelta(frozen=True)` dataclass，字段 `thinking: str`，并加入 `StreamEvent` 联合类型。

#### Scenario: AssistantThinkingDelta 可从 StreamEvent 类型检查
- **WHEN** `isinstance(event, AssistantThinkingDelta)` 检查
- **THEN** 对 `AssistantThinkingDelta` 实例返回 True

---

### Requirement: QueryContext 传递 thinking_budget

`QueryContext` 数据类 SHALL 包含可选 `thinking_budget: int | None = None` 字段，`run_query` 在构建 `ApiMessageRequest` 时读取该字段。

#### Scenario: thinking_budget 为 None 时不启用 thinking
- **WHEN** `context.thinking_budget` 为 `None`
- **THEN** `ApiMessageRequest.thinking` 为 `None`

#### Scenario: thinking_budget 大于 0 时启用 thinking
- **WHEN** `context.thinking_budget` 为 `8000`
- **THEN** `ApiMessageRequest.thinking` 为 `{"type": "enabled", "budget_tokens": 8000}`

---

### Requirement: max_tokens 自动适配 thinking budget

当 thinking 启用时，系统 SHALL 确保 `effective_max_tokens >= thinking_budget + 4096`，避免 API 报错。

#### Scenario: max_tokens 不足时自动扩展
- **WHEN** `context.thinking_budget = 8000` 且当前 `effective_max_tokens = 4096`
- **THEN** 实际发送的 `max_tokens` 为 `12096`（8000 + 4096）

#### Scenario: max_tokens 已足够时不修改
- **WHEN** `context.thinking_budget = 8000` 且当前 `effective_max_tokens = 16000`
- **THEN** 实际发送的 `max_tokens` 为 `16000`（不变）

---

### Requirement: QueryEngine 根据 effort 推导 thinking_budget

`QueryEngine` SHALL 在构建 `QueryContext` 时，根据 `self._settings.effort` 字段推导 `thinking_budget`：low → None，medium → 8000，high → 16000，max → 32000。

#### Scenario: effort=medium 时推导 8000 token budget
- **WHEN** `settings.effort = "medium"`
- **THEN** `QueryContext.thinking_budget = 8000`

#### Scenario: effort=low 时禁用 thinking
- **WHEN** `settings.effort = "low"`
- **THEN** `QueryContext.thinking_budget = None`

#### Scenario: settings 为 None 时不启用 thinking
- **WHEN** `QueryEngine._settings` 为 `None`
- **THEN** `QueryContext.thinking_budget = None`

---

### Requirement: backend_host 分发 AssistantThinkingDelta 事件

`_render_stream_event` SHALL 将 `AssistantThinkingDelta` 事件转换为 `BackendEvent(type="assistant_thinking_delta", message=event.thinking)` 并 emit。

#### Scenario: thinking delta 正确 emit
- **WHEN** stream 产生 `AssistantThinkingDelta(thinking="步骤一...")`
- **THEN** WebSocket 发送 `BackendEvent(type="assistant_thinking_delta", message="步骤一...")`

---

### Requirement: TranscriptItem 持有 thinking 内容

协议 `TranscriptItem` SHALL 包含可选 `thinking: str | None = None` 字段，用于在 assistant 消息完成后持久化保存思考内容。

#### Scenario: 无 thinking 时字段为 None
- **WHEN** 模型未产生 thinking 内容（thinking_budget=None）
- **THEN** `TranscriptItem.thinking` 为 `None`

#### Scenario: 有 thinking 时字段包含内容
- **WHEN** 模型产生 thinking 内容且 assistant 回复完成
- **THEN** `TranscriptItem.thinking` 包含完整思考文本
