## Why

HLAgent 当前不展示 Claude 模型的 extended thinking（扩展思考）内容，用户无法观察到模型的推理过程，降低了透明度和调试能力。`interleaved-thinking-2025-05-14` beta 已在 auth 层声明，但 SDK、gateway 和 UI 均未打通这条数据通路。

## What Changes

- **SDK 层**：`ApiMessageRequest` 新增 `thinking` 字段；`_stream_once` 捕获 `thinking_delta` 事件并 yield `ApiThinkingDeltaEvent`；`stream_events.py` 新增 `AssistantThinkingDelta`；`QueryContext` 新增 `thinking_budget` 字段；`QueryEngine` 根据 `effort` 设置推导 thinking budget
- **Gateway 层**：`protocol.py` 中 `TranscriptItem` 新增 `thinking` 字段、`BackendEvent` 新增 `assistant_thinking_delta` 事件类型；`backend_host._render_stream_event` 处理 `AssistantThinkingDelta`
- **UI 层**：新建 `ThinkingBlock` 可折叠组件；`sessionStore` 新增 `thinkingBuffer` 状态；`useWebSocket` 处理新事件；`TranscriptViewer` 集成展示

## Capabilities

### New Capabilities

- `model-thinking-stream`: 从 Anthropic API 流式接收 thinking 内容，通过 SDK→Gateway→WebSocket 传递到前端
- `thinking-ui-display`: 前端以可折叠 ThinkingBlock 组件展示模型思考内容，支持流式实时更新和完成后查看

### Modified Capabilities

（无已有 spec 需要修改，本次为纯新增能力）

## Impact

- **`src/openharness/api/client.py`**：新增事件类型、修改请求结构和流处理逻辑
- **`src/openharness/engine/stream_events.py`**：新增 StreamEvent 类型
- **`src/openharness/engine/query.py`**：新增事件映射、ApiMessageRequest 构建注入 thinking 参数
- **`src/openharness/engine/query_engine.py`**：新增 thinking_budget 推导逻辑
- **`src/openharness/ui/protocol.py`**：协议类型扩展（前后端共享契约）
- **`src/openharness/ui/backend_host.py`**：新增事件分发
- **`HLAgent/web/src/types/protocol.ts`**：前端类型镜像更新
- **`HLAgent/web/src/stores/sessionStore.ts`**：状态管理扩展
- **`HLAgent/web/src/hooks/useWebSocket.ts`**：新事件处理
- **`HLAgent/web/src/components/ThinkingBlock.tsx`**：新建组件
- **`HLAgent/web/src/components/TranscriptViewer.tsx`**：集成渲染
- **无破坏性变更**：所有新字段均为可选，现有行为不受影响
