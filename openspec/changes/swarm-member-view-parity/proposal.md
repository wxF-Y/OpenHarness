## Why

当前 ChatPage 的 member 右侧面板渲染能力远弱于左侧 leader 视图：missing thinking 流式输出、无法完整渲染 thinking blocks，且 member agent 后端仅向 SSE 队列发送 `delta`/`tool_start`/`tool_end`，缺少 `thinking_delta`，导致用户无法在 member 视图中获得与 leader 视图一致的完整执行可见性。

## What Changes

- **新增** `in_process.py` 向 SSE 队列发出 `thinking_delta` 事件（对应 `AssistantThinkingDelta`），与 leader WebSocket 事件 `assistant_thinking_delta` 等价
- **新增** `SwarmMemberPane.tsx` 新增 `thinkingBuffer` state，处理 `thinking_delta` SSE 事件，并传递给 `TranscriptViewer`，实现 thinking blocks 实时流式渲染
- **修改** `SwarmMemberPane.tsx` 中 `parseSessionToItems` 解析 thinking blocks（`type: "thinking"`），静态加载时可正确渲染 thinking 内容
- **修改** `SwarmMemberPane.tsx` 的 SSE 事件处理：`tool_start` 和 `done` 时同时 flush `thinkingBuffer`
- **确认** 多 member 状态隔离：每个 `SwarmMemberPane` 实例拥有独立的 React state 和 SSE 连接，多 member 并发时渲染不互相污染

## Capabilities

### New Capabilities

- `swarm-member-sse-thinking`: Member SSE 流支持 `thinking_delta` 事件，前端实时渲染 thinking blocks，渲染能力与 leader WebSocket 流对齐

### Modified Capabilities

- `hlagent-web-ui`: SwarmMemberPane 新增 thinkingBuffer 流式渲染，parseSessionToItems 补全 thinking blocks 解析

## Impact

- **后端 SDK**：`src/openharness/swarm/in_process.py`（`_run_query_loop`，新增 `AssistantThinkingDelta` → `thinking_delta` 事件推送）
- **前端**：`HLAgent/web/src/components/SwarmMemberPane.tsx`（`thinkingBuffer` state + thinking_delta 处理 + parseSessionToItems 修复）
- **无 API 变更**：SSE 协议新增一个事件类型，向后兼容（旧前端忽略未知事件类型）
