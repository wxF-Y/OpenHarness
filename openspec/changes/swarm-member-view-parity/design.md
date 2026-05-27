## Context

ChatPage 团队协作视图分为左侧 leader pane（通过 WebSocket 驱动 `TranscriptViewer`）和右侧 member pane（`SwarmMemberPane`，通过 SSE 驱动自定义状态机）。

**当前 leader 事件流（WebSocket）**：
```
assistant_delta          → appendDelta(text)
assistant_thinking_delta → appendThinkingDelta(thinking)
assistant_complete       → completeAssistant(text)
tool_started             → addTranscriptItem({role: "tool", ...})
tool_completed           → addTranscriptItem({role: "tool_result", ...})
```

**当前 member 事件流（SSE）**：
```
delta      → assistantBuffer += text
tool_start → flush buffer; items.push({role: "tool"})
tool_end   → items.push({role: "tool_result"})
done       → flush buffer; load static transcript
```

**差距**：member SSE 完全缺少 `thinking_delta` 事件，`SwarmMemberPane` 始终向 `TranscriptViewer` 传入空字符串 `thinkingBuffer=""`。`parseSessionToItems`（静态 transcript 解析）也跳过 `type: "thinking"` blocks。

**多 member 隔离现状（已正确）**：`AppLayout.tsx` 对所有 member 都 mount `SwarmMemberPane`，非选中者 `display: none`，每个实例有独立 React state 和独立 SSE EventSource，`_member_stream_queues` 按 `session_id` 隔离。无需改动。

## Goals / Non-Goals

**Goals:**
- member SSE 流新增 `thinking_delta` 事件，前端实时渲染 thinking blocks
- `SwarmMemberPane` 新增 `thinkingBuffer` state，并正确传给 `TranscriptViewer`
- `parseSessionToItems` 解析 thinking blocks，静态加载时完整渲染
- 确认多 member 并发渲染不互相污染（验证 + 文档化现有隔离机制）

**Non-Goals:**
- 不修改 leader WebSocket 事件体系
- 不修改 TranscriptViewer 或 ToolCallCard 渲染逻辑（已充分支持）
- 不修改成员状态机（active/idle/stopped）或 SSE 连接生命周期逻辑
- 不引入新的 API 端点或协议版本

## Decisions

### 决策 1：在 `in_process.py` 直接增加 `thinking_delta` 事件

**选项 A（选用）**：在 `_run_query_loop` 中处理 `AssistantThinkingDelta` 事件，push `{"type": "thinking_delta", "text": event.thinking}` 到 `stream_q`，与 text delta 对称。

**选项 B**：不新增事件类型，把 thinking 内容合并进 `delta` 事件。  
→ 不选：leader 视图将 thinking 和 text 分开渲染（ThinkingBlock vs MDRenderer），合并会破坏结构。

**选项 C**：在 `AssistantTurnComplete` 时把完整 thinking 内容一次性推送。  
→ 不选：失去流式体验，用户要等完整 turn 才能看到 thinking。

### 决策 2：`SwarmMemberPane` 新增 `thinkingBuffer` state 对称管理

```typescript
const [thinkingBuffer, setThinkingBuffer] = useState('')
```

SSE 事件处理：
- `thinking_delta` → `setThinkingBuffer(prev => prev + data.text)`
- `tool_start` → flush `assistantBuffer` + `thinkingBuffer` 同时提交为 assistant item（含 thinking 字段）
- `done` → flush 同上，然后加载静态 transcript（静态覆盖流式结果）

Flush 时若同时有 `thinkingBuffer` 和 `assistantBuffer`，合并为一个 `TranscriptItem`：
```typescript
{ role: 'assistant', text: assistantBuffer, thinking: thinkingBuffer }
```

### 决策 3：`parseSessionToItems` 补全 thinking blocks 解析

session JSON 中 assistant 消息的 content blocks 格式：
```json
[{"type": "thinking", "thinking": "..."},
 {"type": "text", "text": "..."},
 {"type": "tool_use", "name": "...", "input": {...}}]
```

修复：累积 `thinking` 字段，与 `text` 字段合并进同一个 `TranscriptItem`：
```typescript
items.push({ role: 'assistant', text, thinking: thinking || undefined })
```

### 决策 4：多 member 隔离验证（无需代码改动）

现有隔离已充分：
- **前端**：每个 `SwarmMemberPane` 实例的 `useState` 互相独立；`display: none` 保留 mount 状态但不共享变量
- **后端**：`_member_stream_queues[session_id]` 按 session_id 键隔离；每个 member 有唯一 session_id

唯一潜在污染源：`get_or_create_stream_queue` 在同 session_id 下共享队列 —— 这是正确的（同一 member 的多次 SSE 连接共享队列），不是 bug。

## Risks / Trade-offs

- **[风险] `thinking_delta` 在 done 后还有未 flush 的 buffer** → `done` 事件处理里同时 flush thinkingBuffer（已在决策 2 中处理）
- **[风险] 静态 transcript 覆盖流式内容时 thinking 丢失** → `parseSessionToItems` 补全 thinking 解析后解决
- **[取舍] SSE 事件数量增加** → thinking-heavy 的 model（如 claude-3-7 extended thinking）会产生大量 thinking_delta，可能增加队列压力。现有队列 `maxsize=512` 足够，超出时 `suppress(QueueFull)` 静默丢弃，与 text delta 行为一致，可接受
