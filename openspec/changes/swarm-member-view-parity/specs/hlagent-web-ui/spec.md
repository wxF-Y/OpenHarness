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
