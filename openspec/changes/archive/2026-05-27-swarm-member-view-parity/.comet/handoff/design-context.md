# Comet Design Handoff

- Change: swarm-member-view-parity
- Phase: design
- Mode: compact
- Context hash: f47d71a5158347e8620ae7a89c06d6d9b2820df270ab6f4314274169467547dc

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/swarm-member-view-parity/proposal.md

- Source: openspec/changes/swarm-member-view-parity/proposal.md
- Lines: 1-27
- SHA256: b72a4e9459d2c4f44337bae90a015ac88b906b471752fc6950c25fd35cfa6d12

```md
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
```

## openspec/changes/swarm-member-view-parity/design.md

- Source: openspec/changes/swarm-member-view-parity/design.md
- Lines: 1-94
- SHA256: 7769512bc0222361d19e35175278ca6532a20721f41228c815eb15b7ee6cf3e8

[TRUNCATED]

```md
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
```

Full source: openspec/changes/swarm-member-view-parity/design.md

## openspec/changes/swarm-member-view-parity/tasks.md

- Source: openspec/changes/swarm-member-view-parity/tasks.md
- Lines: 1-21
- SHA256: 407c20cf93a48622fa98d2c9224b914427a5379998bb55e30f033a31770683c7

```md
## 1. 后端：Member SSE 流新增 thinking_delta 事件

- [ ] 1.1 在 `src/openharness/swarm/in_process.py` 的 `_run_query_loop` 中，在 `AssistantThinkingDelta` 分支下向 `stream_q` push `{"type": "thinking_delta", "text": event.thinking}`，与 `AssistantTextDelta` 的 `delta` 事件对称

## 2. 前端：SwarmMemberPane 新增 thinkingBuffer 流式渲染

- [ ] 2.1 在 `SwarmMemberPane.tsx` 中新增 `const [thinkingBuffer, setThinkingBuffer] = useState('')` state
- [ ] 2.2 在 SSE `onmessage` 处理中新增 `thinking_delta` 分支：`setThinkingBuffer(prev => prev + data.text)`
- [ ] 2.3 修改 `tool_start` 事件处理：在 flush `assistantBuffer` 之前同时 flush `thinkingBuffer`，合并为 `{role: 'assistant', text: prev_text, thinking: prev_thinking}` 推入 items，然后将两个 buffer 均清空
- [ ] 2.4 修改 `done` 事件处理：在加载静态 transcript 前，同时 flush `assistantBuffer` 和 `thinkingBuffer`（若两者均非空，合并为一个带 thinking 字段的 assistant item）
- [ ] 2.5 修改 `TranscriptViewer` 调用，将 `thinkingBuffer` 从 `""` 改为实际的 `thinkingBuffer` state

## 3. 前端：parseSessionToItems 补全 thinking blocks 解析

- [ ] 3.1 在 `parseSessionToItems` 的 content block 遍历中，处理 `b.type === 'thinking'`：累积到局部 `thinking` 变量
- [ ] 3.2 在 push assistant TranscriptItem 时，将 `thinking` 字段一并附加：`{role: 'assistant', text, ...(thinking ? {thinking} : {})}`

## 4. 验证多 member 状态隔离

- [ ] 4.1 通过代码审查确认：`AppLayout.tsx` 中所有 member 均 mount（`display: none` 不卸载），每个 `SwarmMemberPane` 实例 state 独立
- [ ] 4.2 通过代码审查确认：`_member_stream_queues` 以 `session_id` 为键隔离，各 member 队列不共享
```

## openspec/changes/swarm-member-view-parity/specs/hlagent-web-ui/spec.md

- Source: openspec/changes/swarm-member-view-parity/specs/hlagent-web-ui/spec.md
- Lines: 1-38
- SHA256: 191bc0f95db7adcf1d5afb739af5c6d7486fbb9b69604a7af749cd86558f76e2

```md
## ADDED Requirements

### Requirement: SwarmMemberPane 实时渲染 thinking blocks
`SwarmMemberPane` SHALL 维护独立的 `thinkingBuffer` state，在收到 SSE `thinking_delta` 事件时累积内容，并将其传递给 `TranscriptViewer` 的 `thinkingBuffer` prop，实现与 leader 视图一致的流式 thinking 渲染。

#### Scenario: thinking 流式渲染
- **WHEN** SSE 连接接收到 `{"type": "thinking_delta", "text": "..."}` 事件
- **THEN** `thinkingBuffer` 追加该文本，`TranscriptViewer` 实时渲染 `ThinkingBlock` 组件

#### Scenario: tool_start 时 flush thinking buffer
- **WHEN** SSE 接收到 `tool_start` 事件，且 `thinkingBuffer` 非空
- **THEN** 将 `{role: 'assistant', text: assistantBuffer, thinking: thinkingBuffer}` 作为一个 TranscriptItem push 进 items，同时清空 `assistantBuffer` 和 `thinkingBuffer`

#### Scenario: done 时 flush thinking buffer
- **WHEN** SSE 接收到 `done` 事件，且 `thinkingBuffer` 非空
- **THEN** 与 `assistantBuffer` 一同提交为 assistant TranscriptItem 后清空，随后加载静态 transcript

### Requirement: 多 member 渲染状态完全隔离
多个 `SwarmMemberPane` 实例同时 mount 时，每个实例的 `items`、`assistantBuffer`、`thinkingBuffer`、`isStreaming` 等 state SHALL 相互独立，任意一个 member 的流式输出 SHALL NOT 影响其他 member 的渲染内容。

#### Scenario: 两个 member 并发流式输出
- **WHEN** member-A 和 member-B 同时有 SSE 数据流入
- **THEN** member-A 的 `assistantBuffer` 和 `thinkingBuffer` 仅包含来自 member-A 的内容；member-B 同理，两者不交叉

#### Scenario: 切换查看不同 member
- **WHEN** 用户在 SwarmMemberBar 切换选中的 member（隐藏/显示不同 SwarmMemberPane）
- **THEN** 被隐藏的 member pane 保持 SSE 连接活跃，其 state 不被清空；重新展示时显示完整已积累内容

### Requirement: SwarmMemberPane 静态 transcript 完整解析 thinking blocks
`parseSessionToItems` SHALL 将 session JSON 中 assistant content 的 `type: "thinking"` blocks 解析为 `TranscriptItem.thinking` 字段，使静态加载后的渲染与流式渲染结果一致。

#### Scenario: 静态 transcript 包含 thinking blocks
- **WHEN** `loadFullTranscript` 返回的 session JSON 中存在 `{"type": "thinking", "thinking": "..."}`
- **THEN** 对应的 `TranscriptItem` 包含非空的 `thinking` 字段，`TranscriptViewer` 渲染 `ThinkingBlock` 组件

#### Scenario: 无 thinking blocks 的静态 transcript
- **WHEN** session JSON 中不含 `type: "thinking"` blocks
- **THEN** `TranscriptItem.thinking` 字段为 `undefined`，渲染行为与之前一致
```

## openspec/changes/swarm-member-view-parity/specs/swarm-member-sse-thinking/spec.md

- Source: openspec/changes/swarm-member-view-parity/specs/swarm-member-sse-thinking/spec.md
- Lines: 1-19
- SHA256: 112095b5fc88c7d7f53f29eaf732cb399d460c62c0f618a0869fc77e31b65f14

```md
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
```

