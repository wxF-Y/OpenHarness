## ADDED Requirements

### Requirement: Member SSE 流包含 thinking_delta 事件
当 member agent 在 in-process 模式下运行时，后端 SSE 流 SHALL 对 `AssistantThinkingDelta` 引擎事件产生对应的 `thinking_delta` SSE 事件，格式为 `{"type": "thinking_delta", "text": "<thinking content>"}`.

#### Scenario: thinking delta 实时推送
- **WHEN** `_run_query_loop` 收到 `AssistantThinkingDelta` 事件
- **THEN** 后端向 `stream_q` put `{"type": "thinking_delta", "text": event.thinking}`，SSE 订阅方收到该事件

#### Scenario: thinking delta 在队列满时静默丢弃
- **WHEN** `stream_q` 已达 `maxsize=512` 上限
- **THEN** `thinking_delta` 事件被 `suppress(QueueFull)` 静默丢弃，不抛异常，与 `delta` 事件行为一致

### Requirement: thinking_delta 事件向后兼容
SSE 协议新增 `thinking_delta` 类型 SHALL 向后兼容——未处理此事件的旧客户端将忽略该消息，不影响其他事件的接收。

#### Scenario: 旧客户端接收到 thinking_delta 事件
- **WHEN** 不识别 `thinking_delta` 类型的客户端收到该 SSE 事件
- **THEN** 客户端忽略该事件，后续 `delta` / `tool_start` / `tool_end` / `done` 事件正常处理
