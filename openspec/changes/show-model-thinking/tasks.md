## 0. SDK 层：ThinkingBlock 持久化（根源修复）

- [x] 0.1 在 `src/openharness/engine/messages.py` 新增 `ThinkingBlock(BaseModel)` 类型，字段 `thinking: str` 和 `signature: str = ""`
- [x] 0.2 将 `ThinkingBlock` 加入 `ContentBlock` 联合类型
- [x] 0.3 更新 `assistant_message_from_api`：保留 `block_type == "thinking"` 的块，构建 `ThinkingBlock` 并加入 content
- [x] 0.4 更新 `serialize_content_block`（或 `to_api_param`）：将 `ThinkingBlock` 序列化为 `{"type": "thinking", "thinking": ..., "signature": ...}`
- [x] 0.5 更新 `HLAgent/gateway/routers/ws.py` 的 `_replay_transcript`：从 `ConversationMessage` 的 `ThinkingBlock` 提取 thinking 内容，写入 `TranscriptItem.thinking` 字段

## 1. SDK 层：API Client 扩展

- [x] 1.1 在 `src/openharness/api/client.py` 中新增 `ApiThinkingDeltaEvent(frozen=True)` dataclass，字段 `thinking: str`
- [x] 1.2 更新 `ApiStreamEvent` 联合类型，加入 `ApiThinkingDeltaEvent`
- [x] 1.3 在 `ApiMessageRequest` 添加 `thinking: dict[str, Any] | None = None` 字段
- [x] 1.4 修改 `_stream_once`：注入 thinking 参数及非 OAuth 路径的 beta header（`interleaved-thinking-2025-05-14`）
- [x] 1.5 修改 `_stream_once` 的流式事件处理：将单路径改为 text_delta / thinking_delta 双分支

## 2. SDK 层：StreamEvent 扩展

- [x] 2.1 在 `src/openharness/engine/stream_events.py` 新增 `AssistantThinkingDelta(frozen=True)` dataclass，字段 `thinking: str`
- [x] 2.2 将 `AssistantThinkingDelta` 加入 `StreamEvent` 联合类型

## 3. SDK 层：查询引擎

- [x] 3.1 在 `src/openharness/engine/query.py` 的 `QueryContext` dataclass 添加 `thinking_budget: int | None = None` 字段
- [x] 3.2 更新 `query.py` 的 imports，加入 `ApiThinkingDeltaEvent` 和 `AssistantThinkingDelta`
- [x] 3.3 在 `run_query` 的 `ApiMessageRequest` 构建处，根据 `context.thinking_budget` 注入 `thinking` 参数，并自动调整 `effective_max_tokens`
- [x] 3.4 在 `run_query` 的事件循环中，将 `ApiThinkingDeltaEvent` 映射为 `AssistantThinkingDelta`
- [x] 3.5 在 `src/openharness/engine/query_engine.py` 添加模块级函数 `_thinking_budget_from_effort(effort: str | None) -> int | None`
- [x] 3.6 在 `QueryEngine.submit_message` 的 `QueryContext` 构建处，传入 `thinking_budget`（从 `self._settings.effort` 推导）

## 4. Gateway 层：协议与事件分发

- [x] 4.1 在 `src/openharness/ui/protocol.py` 的 `TranscriptItem` 添加 `thinking: str | None = None` 字段
- [x] 4.2 在 `BackendEvent.type` Literal 中添加 `"assistant_thinking_delta"`
- [x] 4.3 在 `src/openharness/ui/backend_host.py` 更新 imports，加入 `AssistantThinkingDelta`
- [x] 4.4 在 `backend_host._render_stream_event` 添加 `AssistantThinkingDelta` 处理分支，emit `BackendEvent(type="assistant_thinking_delta", message=...)`

## 5. UI 层：前端类型与状态

- [x] 5.1 在 `HLAgent/web/src/types/protocol.ts` 的 `BackendEventType` 加入 `'assistant_thinking_delta'`
- [x] 5.2 在 `HLAgent/web/src/types/protocol.ts` 的 `TranscriptItem` 加入 `thinking?: string`
- [x] 5.3 在 `HLAgent/web/src/stores/sessionStore.ts` 添加 `thinkingBuffer: string` 状态字段
- [x] 5.4 在 `sessionStore` 添加 `appendThinkingDelta` action
- [x] 5.5 修改 `sessionStore.completeAssistant`：携带 thinkingBuffer 写入 TranscriptItem.thinking，同时清空两个 buffer
- [x] 5.6 修改 `sessionStore.addTranscriptItem`、`clearTranscript`、`reset`、`resetAndSetSession`：均同步清空 `thinkingBuffer`

## 6. UI 层：WebSocket 事件处理

- [x] 6.1 在 `HLAgent/web/src/hooks/useWebSocket.ts` 的事件 dispatch 中添加 `assistant_thinking_delta` case，调用 `appendThinkingDelta`

## 7. UI 层：ThinkingBlock 组件

- [x] 7.1 新建 `HLAgent/web/src/components/ThinkingBlock.tsx`，实现可折叠组件（紫色左边框，默认折叠，流式时显示字符计数，展开后 pre 渲染，maxHeight 400px）
- [x] 7.2 验证 thinking 为空时组件返回 null

## 8. UI 层：TranscriptViewer 集成

- [x] 8.1 在 `TranscriptViewer` props 中添加 `thinkingBuffer: string`
- [x] 8.2 在流式渲染区域：在 `assistantBuffer` div 之前插入 `<ThinkingBlock thinking={thinkingBuffer} streaming />`
- [x] 8.3 在 `MessageRow` 中：assistant 角色时在 `MDRenderer` 之前插入 `<ThinkingBlock thinking={item.thinking} />`
- [x] 8.4 在调用 `TranscriptViewer` 的父组件中，从 store 取出 `thinkingBuffer` 并传入

## 9. OpenAI 兼容 API thinking 支持

- [x] 9.1 修改 `openai_client.py` 的 `_strip_think_blocks` 签名，返回 `(visible_text, leftover, extracted_thinking)`，提取 `<think>...</think>` 内容
- [x] 9.2 在 `_stream_once` 中：处理 `<think>` 提取的 thinking → yield `ApiThinkingDeltaEvent`
- [x] 9.3 在 `_stream_once` 中：`reasoning_content` delta → yield `ApiThinkingDeltaEvent`（不再只是 collect）

## 10. 验证

- [x] 10.1 设置 effort=medium，发送消息，验证紫色 ThinkingBlock 出现（流式字符计数 → 完成后可折叠展开）
- [x] 10.2 设置 effort=low，发送消息，验证无 ThinkingBlock 出现
- [x] 10.3 验证不支持 thinking 的模型下出现正常错误提示（不崩溃）
- [x] 10.4 验证已完成的消息刷新后 thinking 内容仍可查看（transcript 持久化正确）
