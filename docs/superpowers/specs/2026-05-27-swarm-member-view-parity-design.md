---
comet_change: swarm-member-view-parity
role: technical-design
canonical_spec: openspec
archived-with: 2026-05-27-swarm-member-view-parity
status: final
---

# Member View Parity Design

Member SSE 流新增 `thinking_delta` 事件 + `SwarmMemberPane` thinkingBuffer，使 member 右侧面板渲染能力与 leader 左侧完全对齐。

archived-with: 2026-05-27-swarm-member-view-parity
status: final
---

## 1. 问题描述

ChatPage 分栏视图：
- **左侧 Leader pane**：WebSocket → `useWebSocket` dispatch → sessionStore → `TranscriptViewer`
  - 处理 `assistant_thinking_delta` → `appendThinkingDelta` → `thinkingBuffer` → `ThinkingBlock` 流式渲染
- **右侧 Member pane**：SSE EventSource → `SwarmMemberPane` 本地 state → `TranscriptViewer`
  - **缺失**：`thinking_delta` SSE 事件 + `thinkingBuffer` state → thinking block 从不渲染

后端 `in_process.py` 的 `_run_query_loop` 处理了 `AssistantThinkingDelta` 引擎事件但**未将其推入 `stream_q`**，导致前端 SSE 流无法获取 thinking 内容。

archived-with: 2026-05-27-swarm-member-view-parity
status: final
---

## 2. 事件流对比

```
Leader WebSocket                 Member SSE（修复前）     Member SSE（修复后）
─────────────────────────────────────────────────────────────────────────────
assistant_thinking_delta         ❌ 无                    thinking_delta ✓
assistant_delta                  delta ✓                  delta ✓
tool_started                     tool_start ✓             tool_start ✓
tool_completed                   tool_end ✓               tool_end ✓
assistant_complete               done ✓                   done ✓
```

archived-with: 2026-05-27-swarm-member-view-parity
status: final
---

## 3. 后端变更（in_process.py）

**修改位置**：`_run_query_loop` 中 `AssistantThinkingDelta` 分支（与 `AssistantTextDelta` 对称处理）

```python
# 现有 AssistantTextDelta 处理（参考）
if isinstance(event, AssistantTextDelta) and event.text:
    ...
    if stream_q is not None:
        stream_q.put_nowait({"type": "delta", "text": event.text})

# 新增 AssistantThinkingDelta 处理（紧跟其后）
elif isinstance(event, AssistantThinkingDelta) and event.thinking:
    if stream_q is not None:
        with contextlib.suppress(asyncio.QueueFull):
            stream_q.put_nowait({"type": "thinking_delta", "text": event.thinking})
```

**注意**：`AssistantThinkingDelta` 的字段名是 `.thinking`（非 `.text`），但 SSE 事件统一用 `"text"` key 以保持接口一致性。

archived-with: 2026-05-27-swarm-member-view-parity
status: final
---

## 4. 前端变更（SwarmMemberPane.tsx）

### 4.1 新增 thinkingBuffer state

```typescript
const [thinkingBuffer, setThinkingBuffer] = useState('')
```

### 4.2 SSE onmessage 新增 thinking_delta 分支

```typescript
} else if (data.type === 'thinking_delta' && data.text) {
  setThinkingBuffer((prev) => prev + data.text)
}
```

### 4.3 tool_start 时同步 flush 两个 buffer

**当前代码**（只 flush assistantBuffer）：
```typescript
} else if (data.type === 'tool_start') {
  setAssistantBuffer((prev) => {
    if (prev) setItems((it) => [...it, { role: 'assistant', text: prev }])
    return ''
  })
  ...
}
```

**修改后**（同步 flush thinking + text）：
```typescript
} else if (data.type === 'tool_start') {
  setAssistantBuffer((prevText) => {
    setThinkingBuffer((prevThinking) => {
      if (prevText || prevThinking) {
        setItems((it) => [...it, {
          role: 'assistant',
          text: prevText,
          ...(prevThinking ? { thinking: prevThinking } : {}),
        }])
      }
      return ''
    })
    return ''
  })
  setItems((it) => [...it, { role: 'tool', text: '', tool_name: data.name ?? 'tool', tool_input: data.input ?? {} }])
}
```

> **注意**：`setThinkingBuffer` 嵌套在 `setAssistantBuffer` 的 updater 内，确保两个 buffer 值在同一个 React 批次中读取，避免 stale closure。

### 4.4 done 时同步 flush 两个 buffer

```typescript
} else if (data.type === 'done') {
  setIsStreaming(false)
  setStreamDone(true)
  es.close()
  setAssistantBuffer((prevText) => {
    setThinkingBuffer((prevThinking) => {
      if (prevText || prevThinking) {
        setItems((it) => [...it, {
          role: 'assistant',
          text: prevText,
          ...(prevThinking ? { thinking: prevThinking } : {}),
        }])
      }
      return ''
    })
    return ''
  })
  loadFullTranscript(sessionId)
}
```

### 4.5 TranscriptViewer 传入 thinkingBuffer

```typescript
<TranscriptViewer
  items={items}
  assistantBuffer={assistantBuffer}
  thinkingBuffer={thinkingBuffer}  // 从 "" 改为实际 state
/>
```

archived-with: 2026-05-27-swarm-member-view-parity
status: final
---

## 5. parseSessionToItems 补全（SwarmMemberPane.tsx）

**当前**：循环中 `b.type === 'thinking'` 未处理，thinking 内容被丢弃。

**修改**：在 content block 遍历中新增 `thinking` 累积，push item 时附带：

```typescript
function parseSessionToItems(snapshot): TranscriptItem[] {
  // ...
  for (const msg of msgs) {
    const role = msg.role as string
    const content = msg.content
    if (role === 'user' || role === 'assistant') {
      let text = ''
      let thinking = ''  // ← 新增
      if (Array.isArray(content)) {
        for (const b of content as Record<string, unknown>[]) {
          if (b.type === 'text') text += (b.text as string) ?? ''
          if (b.type === 'thinking') thinking += (b.thinking as string) ?? ''  // ← 新增
          if (b.type === 'tool_use') {
            items.push({ role: 'tool', text: '', tool_name: b.name as string, tool_input: b.input as Record<string, unknown> })
          }
        }
      }
      if (text.trim() || thinking.trim()) {
        items.push({
          role: role as TranscriptItem['role'],
          text,
          ...(thinking ? { thinking } : {}),  // ← 新增
        })
      }
    }
    // ...
  }
}
```

archived-with: 2026-05-27-swarm-member-view-parity
status: final
---

## 6. 多 member 状态隔离（确认）

当前实现已正确隔离，无需代码改动：

| 隔离层 | 机制 | 状态 |
|--------|------|------|
| 前端 React state | 每个 `SwarmMemberPane` 实例的 `useState` 独立 | ✅ 已正确 |
| 前端 SSE 连接 | 每个实例创建独立 `EventSource`，`useEffect` 清理时关闭 | ✅ 已正确 |
| 后端 stream queue | `_member_stream_queues[session_id]`，每个 member 不同 `session_id` | ✅ 已正确 |
| DOM 挂载 | 非选中 member 用 `display: none` 而非 unmount，保留 state | ✅ 已正确 |

新增 `thinkingBuffer` 是 per-instance `useState`，自动继承上述隔离保证。

archived-with: 2026-05-27-swarm-member-view-parity
status: final
---

## 7. 边界条件与风险

| 场景 | 处理 |
|------|------|
| thinking 内容极长（extended thinking 模式） | `maxsize=512` 队列满时 `suppress(QueueFull)` 静默丢弃，与 text delta 行为一致；静态 transcript 会补全 |
| 只有 thinking 无 text（turn 内纯 thinking） | flush 时 `text: ''`，`TranscriptViewer.MessageRow` 渲染 `ThinkingBlock`，空文本不触发 MDRenderer 渲染问题 |
| 只有 text 无 thinking（非 extended thinking 模型） | `thinkingBuffer` 始终为空，flush 时 `thinking: undefined`，行为与修改前完全一致 |
| SSE 重连（网络抖动） | `onerror` 关闭后 `loadFullTranscript` 加载静态 transcript；流式 buffer 丢失但静态覆盖是完整的 |
| 成员完成后用户刷新页面 | SSE done 已触发 `loadFullTranscript`，刷新后重新加载静态 transcript（包含完整 thinking） |
