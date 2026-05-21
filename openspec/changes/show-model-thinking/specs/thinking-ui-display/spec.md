## ADDED Requirements

### Requirement: sessionStore 管理 thinkingBuffer 状态

前端 `sessionStore` SHALL 包含 `thinkingBuffer: string` 状态和对应操作：`appendThinkingDelta(text)` 追加文本；`completeAssistant(text)` 将 `thinkingBuffer` 写入最终 `TranscriptItem.thinking` 并清空两个 buffer；所有清空/重置操作均同时清空 `thinkingBuffer`。

#### Scenario: appendThinkingDelta 累积文本
- **WHEN** 连续调用 `appendThinkingDelta("A")` 和 `appendThinkingDelta("B")`
- **THEN** `thinkingBuffer === "AB"`

#### Scenario: completeAssistant 携带 thinking 写入 transcript
- **WHEN** `thinkingBuffer === "思考内容"` 时调用 `completeAssistant("回复内容")`
- **THEN** transcript 新增条目 `{role: "assistant", text: "回复内容", thinking: "思考内容"}`，且 `thinkingBuffer` 清空为 `""`

#### Scenario: completeAssistant 无 thinking 时不写入 thinking 字段
- **WHEN** `thinkingBuffer === ""` 时调用 `completeAssistant("回复内容")`
- **THEN** transcript 新增条目 `{role: "assistant", text: "回复内容"}`，`thinking` 字段为 `undefined`

#### Scenario: clearTranscript 清空 thinkingBuffer
- **WHEN** 调用 `clearTranscript()`
- **THEN** `transcript`、`assistantBuffer`、`thinkingBuffer` 均为空

---

### Requirement: useWebSocket 处理 assistant_thinking_delta 事件

WebSocket 事件处理器 SHALL 在收到 `type="assistant_thinking_delta"` 事件时，调用 `store.appendThinkingDelta(event.message)` 追加 thinking 内容。

#### Scenario: thinking delta 事件正确路由
- **WHEN** WebSocket 收到 `{type: "assistant_thinking_delta", message: "某段思考"}`
- **THEN** `store.thinkingBuffer` 追加 `"某段思考"`

---

### Requirement: ThinkingBlock 组件可折叠展示思考内容

系统 SHALL 提供 `ThinkingBlock` 组件，Props 为 `{thinking: string, streaming?: boolean}`，默认折叠；点击标题可展开/折叠；流式进行中（`streaming=true`）时标题显示字符计数；展开后内容以等宽字体渲染，最大高度 400px 带垂直滚动。

#### Scenario: 默认折叠且显示预览
- **WHEN** 渲染 `<ThinkingBlock thinking="这是思考内容" />`
- **THEN** 内容区域不可见，标题行可见，包含"思考过程"文字

#### Scenario: 流式进行中显示字符计数
- **WHEN** 渲染 `<ThinkingBlock thinking="思考中的文字" streaming={true} />`
- **THEN** 标题行显示字符数量指示

#### Scenario: 点击后展开内容
- **WHEN** 用户点击 ThinkingBlock 标题行
- **THEN** 内容区域变为可见，显示完整思考文本

#### Scenario: thinking 为空时不渲染
- **WHEN** 渲染 `<ThinkingBlock thinking="" streaming={false} />`
- **THEN** 组件不渲染任何内容（返回 null）

---

### Requirement: TranscriptViewer 展示流式和已完成的 thinking 内容

`TranscriptViewer` SHALL 在以下两处渲染 `ThinkingBlock`：
1. 流式进行时：在 `assistantBuffer` 区域之前渲染 `<ThinkingBlock thinking={thinkingBuffer} streaming />`（仅当 thinkingBuffer 非空）
2. 已完成消息中：assistant 角色 `MessageRow` 在 `MDRenderer` 之前渲染 `<ThinkingBlock thinking={item.thinking} />`（仅当 `item.thinking` 非 undefined）

#### Scenario: 流式思考时在回复前展示 thinking block
- **WHEN** `thinkingBuffer` 非空且 `assistantBuffer` 为空（模型仍在思考）
- **THEN** 页面显示紫色边框的 ThinkingBlock，无回复文字

#### Scenario: 流式文本时 thinking block 与回复同时可见
- **WHEN** `thinkingBuffer` 非空且 `assistantBuffer` 也有内容
- **THEN** ThinkingBlock 在回复文字上方可见

#### Scenario: 已完成消息展示 thinking
- **WHEN** transcript 中存在 `{role: "assistant", thinking: "思考内容", text: "回复"}` 条目
- **THEN** 该消息行先展示 ThinkingBlock 再展示回复文本

#### Scenario: 无 thinking 的 assistant 消息不显示 ThinkingBlock
- **WHEN** transcript 中存在 `{role: "assistant", text: "回复"}` 条目（无 thinking 字段）
- **THEN** 该消息行仅显示回复文本，无 ThinkingBlock
