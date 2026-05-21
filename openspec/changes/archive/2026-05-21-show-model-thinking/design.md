## Context

HLAgent 使用 Anthropic Claude API，通过 Python 后端（SDK 层 + Gateway 层）与 React 前端（UI 层）的 WebSocket 协议通信。当前的流式数据链路只处理 `text_delta` 事件，忽略 `thinking_delta`。

**现有链路**：`ApiTextDeltaEvent` → `AssistantTextDelta` → `BackendEvent(assistant_delta)` → `sessionStore.assistantBuffer` → `TranscriptViewer`

**关键已有基础**：
- `auth/external.py` 中 `CLAUDE_COMMON_BETAS` 已包含 `"interleaved-thinking-2025-05-14"`（OAuth 路径自动使用）
- `AppState.effort` 字段（low/medium/high/max）已存在，可用于推导 thinking budget
- `QueryEngine` 已接收 `settings: Settings` 参数

## Goals / Non-Goals

**Goals:**
- 通过 `effort` 设置自动启用/禁用 extended thinking（low=禁用，其余=启用）
- 流式传输 thinking delta 到前端，提供实时可视性
- 以可折叠的 `ThinkingBlock` 组件展示，默认折叠节省空间
- 已完成消息中持久化保存 thinking 内容

**Non-Goals:**
- 不支持 OpenAI 兼容路径的 thinking（openai_client.py 不改动）
- 不修改 thinking budget 为运行时可配置（由 effort 静态推导即可）
- 不实现 thinking 内容的搜索/过滤功能

## Decisions

### D1：thinking_budget 推导方式

**决定**：从 `QueryEngine._settings.effort` 静态映射到 budget tokens，在 `query_engine.py` 中计算，通过 `QueryContext.thinking_budget` 传递。

**映射**：`low` → None（禁用），`medium` → 8,000，`high` → 16,000，`max` → 32,000

**备选**：在 `ApiMessageRequest` 构建时直接读 AppState（需要引入新依赖）；或通过单独的 `/set-thinking` 命令配置（复杂度高）。

**理由**：`effort` 语义上已表达"模型资源投入程度"，与 thinking budget 天然对应；静态映射避免引入新配置字段。

### D2：Thinking 内容在 TranscriptItem 中的存储方式

**决定**：在 `TranscriptItem` 添加可选 `thinking: str | None` 字段，完成时由前端 store 将 `thinkingBuffer` 写入该字段。

**备选**：thinking 作为单独的 transcript 条目（role="thinking"）。

**理由**：thinking 与对应的 assistant 回复语义强耦合，作为 TranscriptItem 的可选字段更自然，渲染时直接在 assistant 消息前展示，无需额外配对逻辑。

### D3：非 OAuth 路径的 beta header 追加方式

**决定**：在 `_stream_once` 构建 `params` 时，当 `request.thinking` 不为 None 且非 OAuth 时，通过 `params["extra_headers"]` 追加 `anthropic-beta` header，不修改 client 实例状态。

**理由**：`extra_headers` 是每次请求级别的覆盖，不污染 client 实例的全局状态，重试时也安全复现。

### D4：max_tokens 与 budget_tokens 冲突处理

**决定**：在 `query.py` 的 `ApiMessageRequest` 构建前，若 thinking 启用则自动将 `effective_max_tokens = max(effective_max_tokens, thinking_budget + 4096)`。

**理由**：Anthropic API 要求 `max_tokens > budget_tokens`，当前默认 4096 在 medium effort 下会冲突，自动扩展对用户透明。

### D5：ThinkingBlock UI 设计

**决定**：天蓝色（`#89dceb`）左边框（避免与 `agent` 工具的 `#cba6f7` 冲突）；默认折叠；流式时标题显示脉冲动画点 `•••` + 字符计数；内容以比例字体 + `white-space: pre-wrap` 渲染（非 `<pre>` 等宽，适合自然语言）；`maxHeight: 400px`。

streaming 阶段结构调整：将 `<RoleLabel>` 提前到 `thinkingBuffer || assistantBuffer` 条件外层，使思考阶段（无回复文字时）也能显示 "Agent" 来源标识。

`thinkingBuffer` 加入 `useEffect` 的 scroll 依赖，确保 thinking 流式增长时自动滚动。

**理由**：`#89dceb` 未被任何工具占用，视觉上清冷感与"推理/清晰思考"语义契合；比例字体可读性显著优于等宽字体处理自然语言；脉冲动画提供活跃反馈防止用户误判为卡顿。

## Risks / Trade-offs

- **模型不支持 thinking** → Anthropic API 会返回错误，走已有 `ErrorEvent` 路径展示给用户；不导致崩溃
- **thinking 内容极长（数万字符）** → `ThinkingBlock` 使用 `maxHeight: 400px + overflowY: auto` 限制；不影响页面布局
- **effort=low 时用户期望 thinking** → 文档说明：low effort 禁用 thinking 以优先速度
- **interleaved thinking 顺序假设** → Anthropic streaming 保证 thinking block 在 text block 之前完成，前端无需额外排序逻辑
- **`max_tokens` 自动扩展** → 在 medium 下从 4096 扩展到 12096，增加 API 成本上限（实际 output tokens 不变），属于可接受的 trade-off

## Migration Plan

纯新增，所有字段为可选。不需要数据库迁移或配置变更。

**部署**：重新启动 HLAgent 后端即生效；前端静态资产重新构建。

**回滚**：恢复代码变更，无状态持久化，回滚零风险。

## Open Questions

（无未解决问题，设计已完整）
