## 1. 后端：Member SSE 流新增 thinking_delta 事件

- [x] 1.1 在 `src/openharness/swarm/in_process.py` 的 `_run_query_loop` 中，在 `AssistantThinkingDelta` 分支下向 `stream_q` push `{"type": "thinking_delta", "text": event.thinking}`，与 `AssistantTextDelta` 的 `delta` 事件对称

## 2. 前端：SwarmMemberPane 新增 thinkingBuffer 流式渲染

- [x] 2.1 在 `SwarmMemberPane.tsx` 中新增 `const [thinkingBuffer, setThinkingBuffer] = useState('')` state
- [x] 2.2 在 SSE `onmessage` 处理中新增 `thinking_delta` 分支：`setThinkingBuffer(prev => prev + data.text)`
- [x] 2.3 修改 `tool_start` 事件处理：在 flush `assistantBuffer` 之前同时 flush `thinkingBuffer`，合并为 `{role: 'assistant', text: prev_text, thinking: prev_thinking}` 推入 items，然后将两个 buffer 均清空
- [x] 2.4 修改 `done` 事件处理：在加载静态 transcript 前，同时 flush `assistantBuffer` 和 `thinkingBuffer`（若两者均非空，合并为一个带 thinking 字段的 assistant item）
- [x] 2.5 修改 `TranscriptViewer` 调用，将 `thinkingBuffer` 从 `""` 改为实际的 `thinkingBuffer` state

## 3. 前端：parseSessionToItems 补全 thinking blocks 解析

- [x] 3.1 在 `parseSessionToItems` 的 content block 遍历中，处理 `b.type === 'thinking'`：累积到局部 `thinking` 变量（已存在，无需修改）
- [x] 3.2 在 push assistant TranscriptItem 时，将 `thinking` 字段一并附加：`{role: 'assistant', text, ...(thinking ? {thinking} : {})}`（已存在，无需修改）

## 4. 验证多 member 状态隔离

- [x] 4.1 通过代码审查确认：`AppLayout.tsx` 中所有 member 均 mount（`display: none` 不卸载），每个 `SwarmMemberPane` 实例 state 独立
- [x] 4.2 通过代码审查确认：`_member_stream_queues` 以 `session_id` 为键隔离，各 member 队列不共享
