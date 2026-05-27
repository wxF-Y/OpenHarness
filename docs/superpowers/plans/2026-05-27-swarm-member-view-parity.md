---
archived-with: 2026-05-27-swarm-member-view-parity
status: final
---
# Swarm Member View Parity Implementation Plan

---
change: swarm-member-view-parity
design-doc: docs/superpowers/specs/2026-05-27-swarm-member-view-parity-design.md
base-ref: c03a0c3cab81bb36945dd292b6b46977bda262ba
---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ChatPage 右侧 member 面板与左侧 leader 面板渲染能力完全对齐——包括 thinking blocks 的流式渲染和静态解析。

**Architecture:** 后端 `in_process.py` 补发 `thinking_delta` SSE 事件；前端 `SwarmMemberPane.tsx` 新增 `thinkingBuffer` state，处理该事件并传递给已支持 `ThinkingBlock` 渲染的 `TranscriptViewer`；同时修复 `parseSessionToItems` 以在静态加载时解析 thinking blocks。多 member 隔离无需改动——每个 pane 实例的 `useState` 和 SSE 连接已完全独立。

**Tech Stack:** Python 3.11 (asyncio), React 18, TypeScript, EventSource (SSE)

---

## 文件变更总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/openharness/swarm/in_process.py` | 修改 | `_run_query_loop` 新增 `AssistantThinkingDelta` → `thinking_delta` 推送 |
| `HLAgent/web/src/components/SwarmMemberPane.tsx` | 修改 | thinkingBuffer state、SSE 事件处理、parseSessionToItems 修复 |

---

## Task 1：后端补发 thinking_delta SSE 事件

**Files:**
- Modify: `src/openharness/swarm/in_process.py:264-269`

**背景：** `_run_query_loop` 目前处理了 `AssistantTextDelta` → `{"type": "delta"}` 推送，但对 `AssistantThinkingDelta` 没有推送到 `stream_q`。`AssistantThinkingDelta` 已被导入（见文件顶部 import）。

- [ ] **Step 1.1：定位插入点**

  打开 `src/openharness/swarm/in_process.py`，找到第 265 行附近：

  ```python
  # Capture latest assistant text delta
  if isinstance(event, AssistantTextDelta) and event.text:
      ctx.last_assistant_message = (ctx.last_assistant_message or "") + event.text
      if stream_q is not None:
          with contextlib.suppress(asyncio.QueueFull):
              stream_q.put_nowait({"type": "delta", "text": event.text})

  # When turn completes, extract full text from the message
  # (covers models that don't emit AssistantTextDelta, only tool calls)
  elif isinstance(event, AssistantTurnComplete):
  ```

- [ ] **Step 1.2：在 AssistantTextDelta 块与 AssistantTurnComplete 块之间插入 thinking_delta 处理**

  将上述代码改为：

  ```python
  # Capture latest assistant text delta
  if isinstance(event, AssistantTextDelta) and event.text:
      ctx.last_assistant_message = (ctx.last_assistant_message or "") + event.text
      if stream_q is not None:
          with contextlib.suppress(asyncio.QueueFull):
              stream_q.put_nowait({"type": "delta", "text": event.text})

  # Forward thinking deltas to SSE stream (mirrors AssistantTextDelta handling)
  elif isinstance(event, AssistantThinkingDelta) and event.thinking:
      if stream_q is not None:
          with contextlib.suppress(asyncio.QueueFull):
              stream_q.put_nowait({"type": "thinking_delta", "text": event.thinking})

  # When turn completes, extract full text from the message
  # (covers models that don't emit AssistantTextDelta, only tool calls)
  elif isinstance(event, AssistantTurnComplete):
  ```

  > **注意：** `AssistantThinkingDelta` 的字段是 `.thinking`（不是 `.text`），但 SSE 事件 key 统一用 `"text"` 与前端约定一致。
  > 
  > 因为已改为 `elif`，`AssistantThinkingDelta` 不会再触发 `AssistantTextDelta` 的分支，原逻辑安全。

- [ ] **Step 1.3：验证 import 已存在**

  确认文件顶部有：
  ```python
  from openharness.engine.stream_events import (
      AssistantTextDelta,
      AssistantThinkingDelta,
      ...
  )
  ```
  如已存在，无需修改。

- [ ] **Step 1.4：提交后端变更**

  ```bash
  git add src/openharness/swarm/in_process.py
  git commit -m "feat: forward AssistantThinkingDelta to member SSE stream as thinking_delta"
  ```

---

## Task 2：前端 SwarmMemberPane 新增 thinkingBuffer state

**Files:**
- Modify: `HLAgent/web/src/components/SwarmMemberPane.tsx:58-67` (state 声明区)

- [ ] **Step 2.1：新增 thinkingBuffer state**

  在文件约第 58-67 行找到 state 声明区：

  ```typescript
  const [items, setItems] = useState<TranscriptItem[]>([])
  const [assistantBuffer, setAssistantBuffer] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamDone, setStreamDone] = useState(false)
  ```

  在 `assistantBuffer` 之后插入 `thinkingBuffer`：

  ```typescript
  const [items, setItems] = useState<TranscriptItem[]>([])
  const [assistantBuffer, setAssistantBuffer] = useState('')
  const [thinkingBuffer, setThinkingBuffer] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamDone, setStreamDone] = useState(false)
  ```

- [ ] **Step 2.2：SSE 连接初始化时重置 thinkingBuffer**

  找到 SSE 建立时的初始化代码（约第 108-110 行）：

  ```typescript
  setIsStreaming(true)
  setAssistantBuffer('')
  setStreamDone(false)
  ```

  改为：

  ```typescript
  setIsStreaming(true)
  setAssistantBuffer('')
  setThinkingBuffer('')
  setStreamDone(false)
  ```

---

## Task 3：前端 SSE 事件处理器更新

**Files:**
- Modify: `HLAgent/web/src/components/SwarmMemberPane.tsx:112-144` (onmessage handler)

- [ ] **Step 3.1：新增 thinking_delta 分支**

  在 `onmessage` handler 中，`delta` 分支之后插入 `thinking_delta` 处理：

  ```typescript
  if (data.type === 'delta' && data.text) {
    setAssistantBuffer((prev) => prev + data.text)
  } else if (data.type === 'thinking_delta' && data.text) {
    setThinkingBuffer((prev) => prev + data.text)
  } else if (data.type === 'tool_start') {
  ```

- [ ] **Step 3.2：修改 tool_start handler —— 同时 flush 两个 buffer**

  将现有 `tool_start` 分支：

  ```typescript
  } else if (data.type === 'tool_start') {
    // Flush current buffer as assistant message, then add tool item
    setAssistantBuffer((prev) => {
      if (prev) {
        setItems((it) => [...it, { role: 'assistant', text: prev }])
      }
      return ''
    })
    setItems((it) => [...it, { role: 'tool', text: '', tool_name: data.name ?? 'tool', tool_input: data.input ?? {} }])
  }
  ```

  替换为：

  ```typescript
  } else if (data.type === 'tool_start') {
    // Flush both text and thinking buffers before adding tool item
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

  > **React 说明：** 嵌套的函数式更新（functional updater）在 React 18 中是安全的——外层 updater 的 `prevText` 和内层 updater 的 `prevThinking` 分别获取各自 state 的最新值，两次 setState 在同一 batch 中处理。这与现有代码在 `setAssistantBuffer` updater 内调用 `setItems` 的模式完全一致。

- [ ] **Step 3.3：修改 done handler —— 同时 flush 两个 buffer**

  将现有 `done` 分支：

  ```typescript
  } else if (data.type === 'done') {
    setIsStreaming(false)
    setStreamDone(true)
    es.close()
    // Flush remaining buffer
    setAssistantBuffer((prev) => {
      if (prev) setItems((it) => [...it, { role: 'assistant', text: prev }])
      return ''
    })
    // Load authoritative session transcript
    loadFullTranscript(sessionId)
  }
  ```

  替换为：

  ```typescript
  } else if (data.type === 'done') {
    setIsStreaming(false)
    setStreamDone(true)
    es.close()
    // Flush remaining text and thinking buffers
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
    // Load authoritative session transcript
    loadFullTranscript(sessionId)
  }
  ```

- [ ] **Step 3.4：将 thinkingBuffer 传给 TranscriptViewer**

  找到约第 221-225 行的 `TranscriptViewer` 调用：

  ```typescript
  <TranscriptViewer
    items={items}
    assistantBuffer={assistantBuffer}
    thinkingBuffer=""
  />
  ```

  改为：

  ```typescript
  <TranscriptViewer
    items={items}
    assistantBuffer={assistantBuffer}
    thinkingBuffer={thinkingBuffer}
  />
  ```

- [ ] **Step 3.5：提交前端流式渲染变更**

  ```bash
  git add HLAgent/web/src/components/SwarmMemberPane.tsx
  git commit -m "feat: add thinkingBuffer to SwarmMemberPane for streaming thinking blocks"
  ```

---

## Task 4：修复 parseSessionToItems 静态 transcript 解析

**Files:**
- Modify: `HLAgent/web/src/components/SwarmMemberPane.tsx:15-55` (parseSessionToItems)

**背景：** SSE 流式阶段结束后，`loadFullTranscript` 加载磁盘上的 session JSON 并调用 `parseSessionToItems` 重建 items。当前函数跳过 `type: "thinking"` blocks，导致静态加载后 thinking 消失。

- [ ] **Step 4.1：修改 parseSessionToItems 累积 thinking 字段**

  找到函数内的 content block 遍历（约第 26-39 行）：

  ```typescript
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    for (const b of content as Record<string, unknown>[]) {
      if (b.type === 'text') text += (b.text as string) ?? ''
      if (b.type === 'thinking') thinking += (b.thinking as string) ?? ''
      if (b.type === 'tool_use') {
        items.push({
          role: 'tool',
          text: '',
          tool_name: b.name as string,
          tool_input: b.input as Record<string, unknown>,
        })
      }
    }
  }
  ```

  当前代码中没有 `thinking` 变量声明也没有对 `b.type === 'thinking'` 的处理。完整替换为：

  ```typescript
  let text = ''
  let thinking = ''
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    for (const b of content as Record<string, unknown>[]) {
      if (b.type === 'text') text += (b.text as string) ?? ''
      if (b.type === 'thinking') thinking += (b.thinking as string) ?? ''
      if (b.type === 'tool_use') {
        items.push({
          role: 'tool',
          text: '',
          tool_name: b.name as string,
          tool_input: b.input as Record<string, unknown>,
        })
      }
    }
  }
  ```

  > **注意：** 原代码在外层已声明了 `let text = ''`，检查是否在同一 scope 声明了 `let thinking = ''`。若尚未声明，在 `let text = ''` 旁边补充。

- [ ] **Step 4.2：push assistant item 时附带 thinking 字段**

  找到约第 40-46 行：

  ```typescript
  if (text.trim() || thinking.trim()) {
    items.push({
      role: role as TranscriptItem['role'],
      text,
      ...(thinking ? { thinking } : {}),
    })
  }
  ```

  若原代码不包含 `thinking` 字段，将：

  ```typescript
  if (text.trim()) {
    items.push({
      role: role as TranscriptItem['role'],
      text,
    })
  }
  ```

  替换为：

  ```typescript
  if (text.trim() || thinking.trim()) {
    items.push({
      role: role as TranscriptItem['role'],
      text,
      ...(thinking ? { thinking } : {}),
    })
  }
  ```

- [ ] **Step 4.3：提交静态解析修复**

  ```bash
  git add HLAgent/web/src/components/SwarmMemberPane.tsx
  git commit -m "fix: parseSessionToItems now preserves thinking blocks from session JSON"
  ```

---

## Task 5：TypeScript 构建验证

**Files:** (no changes)

- [ ] **Step 5.1：运行 TypeScript 类型检查**

  ```bash
  cd HLAgent/web && npx tsc --noEmit 2>&1
  ```

  预期：无错误。若有错误，最常见原因是 `TranscriptItem` 类型中缺少 `thinking` 字段——检查 `src/types/protocol.ts`：

  ```typescript
  export interface TranscriptItem {
    role: TranscriptRole
    text: string
    tool_name?: string
    tool_input?: Record<string, unknown>
    is_error?: boolean
    media?: MediaItem[]
    thinking?: string   // ← 确认此字段存在
  }
  ```

  若缺少 `thinking?: string`，添加后重新检查。

- [ ] **Step 5.2：运行前端构建**

  ```bash
  cd HLAgent/web && npm run build 2>&1
  ```

  预期：Build succeeded, no errors.

- [ ] **Step 5.3：若构建成功，提交任何类型修复（如有）**

  ```bash
  git add HLAgent/web/src/types/protocol.ts  # 仅当有改动时
  git commit -m "chore: verify build passes after member parity changes"
  ```

---

## Task 6：多 member 状态隔离验证（代码审查）

**Files:** (read-only verification)

- [ ] **Step 6.1：确认 AppLayout.tsx 使用 display:none 而非条件卸载**

  检查 `HLAgent/web/src/components/AppLayout.tsx` 约第 314-326 行：

  ```tsx
  {Object.values(members).map((m) => (
    <div
      key={m.agent_id}
      style={{ height: '100%', display: m.agent_id === selectedMemberId ? 'block' : 'none' }}
    >
      <SwarmMemberPane ... />
    </div>
  ))}
  ```

  确认是 `display: 'none'`（保留 mount，state 不丢失）而不是 `selectedMemberId === m.agent_id && <SwarmMemberPane />`（条件渲染会 unmount）。

- [ ] **Step 6.2：确认后端 stream queue 按 session_id 隔离**

  检查 `src/openharness/swarm/in_process.py` 约第 69-78 行：

  ```python
  _member_stream_queues: dict[str, asyncio.Queue] = {}

  async def get_or_create_stream_queue(session_id: str) -> asyncio.Queue:
      async with _member_stream_lock:
          if session_id not in _member_stream_queues:
              _member_stream_queues[session_id] = asyncio.Queue(maxsize=512)
          return _member_stream_queues[session_id]
  ```

  确认 key 是 `session_id`（每个 member 有唯一 `session_id`），队列不共享。

- [ ] **Step 6.3：更新 tasks.md（勾选所有完成项）**

  更新 `openspec/changes/swarm-member-view-parity/tasks.md`，将所有 `- [ ]` 改为 `- [x]`。

  ```bash
  git add openspec/changes/swarm-member-view-parity/tasks.md
  git commit -m "chore: mark all swarm-member-view-parity tasks complete"
  ```

---

## 快速检查清单（实施后）

- [ ] `in_process.py` 的 `AssistantThinkingDelta` 分支用 `elif` 而非 `if`（避免同时触发 `AssistantTextDelta`）
- [ ] `SwarmMemberPane.tsx` 的 `thinkingBuffer` 在 SSE 建立时重置为 `''`
- [ ] `tool_start` 和 `done` 都同时 flush `assistantBuffer` 和 `thinkingBuffer`
- [ ] `TranscriptViewer` 的 `thinkingBuffer` prop 不再是硬编码 `""`
- [ ] `parseSessionToItems` 累积 `thinking` 变量并在 push item 时携带
- [ ] TypeScript 构建通过
