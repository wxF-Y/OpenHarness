## Context

OpenHarness 的消息引擎（`QueryEngine.submit_message`）已原生支持 `ConversationMessage` 入参，内部 `ContentBlock` union 已包含 `TextBlock` 和 `ImageBlock`。但**输入和输出链路**的每一层都只传递 `str`：

- **输入**：`FrontendRequest.line: str | None`（协议层）→ `handle_line(bundle, line: str)`（runtime 层）→ `WebBackendHost` 只传 `request.line`
- **输出**：`ToolResult.output: str` → `ToolResultBlock.content: str` → `ToolExecutionCompleted.output: str` → `TranscriptItem.text: str` → Web UI 只渲染文本

变更的工作是**双向打通这条链路**：
- 输入方向：让附件从用户界面流向 `QueryEngine.submit_message` 的 `ConversationMessage`，服务端处理非图片文件格式转换
- 输出方向：让工具产生的图片（如 `image_generation`）从 `ToolResult` 流向 `TranscriptItem.media`，Web UI 内联渲染

## Goals / Non-Goals

**Goals:**

*输入方向：*
- 图片（PNG/JPG/GIF/WebP）直接作为 `ImageBlock` 附加到消息，利用模型视觉能力
- PDF/DOCX/XLSX/CSV/JSON 在服务端提取为文本，作为 `DocumentBlock`（新）附加
- 代码/纯文本文件（`.py`、`.ts` 等）作为 `DocumentBlock` 附加（filename 携带语言后缀，AI 从后缀推断语言类型）
- Web UI 支持文件选择、拖拽、剪贴板粘贴图片
- 网关新增文件上传 REST 端点（multipart），供 Web UI 使用

*输出方向：*
- 工具执行产生的图片（`image_generation` 等）在 Web UI transcript 中内联显示，无需离开聊天窗口
- `ToolResultBlock.content` 支持图片内容块（对齐 Anthropic tool_result 协议）
- 用户发送的附件在历史记录中可见（transcript 用户消息气泡中显示缩略图）

**Non-Goals:**
- 视频/音频文件处理
- 超过 10MB 的大文件（在初始版本中拒绝）
- OCR（图片转文字）
- 云存储 URL 直接引用（S3、GDrive 等）
- CLI `@path` 语法（作为独立 CLI 功能留待后续变更，本次只覆盖 Web UI 路径）
- 模型 API 原生图片生成输出（Claude 模型直接在 assistant 消息中生成图片，当前 API 不支持）

## Decisions

### 决策 1：新增 `DocumentBlock` 而非复用 `TextBlock`

**选择**：新增 `DocumentBlock(type="document", filename, mime_type, text_content)`  
**理由**：`TextBlock` 语义是"纯文本用户输入"，`DocumentBlock` 需要携带文件名和原始 MIME 类型元数据，以便 prompt 构建时注入 `[文件: report.pdf]` 上下文提示，也便于未来扩展（如 Anthropic 原生 PDF 支持）。  
**备选**：复用 `TextBlock` + 在 text 前缀文件名 → 会污染文本内容，丢失结构信息。

### 决策 2：协议层使用内联 base64，不做分离上传

**选择**：`FrontendRequest` 新增 `attachments: list[AttachmentPayload]`，其中 `AttachmentPayload` 含 `filename`、`mime_type`、`data: str`（base64）  
**理由**：避免两步操作（先上传→拿 ID→再引用），Web UI 可以在发送消息时一并携带文件，Gateway 同步处理。  
**备选**：预上传（`POST /api/attachments`）返回 token，再在消息中引用 → 适合大文件，但初始版本文件限制在 5MB 以内，内联更简单。  
**例外**：Web UI 为用户体验在前端先做本地 base64 转换，Gateway 侧拿到 base64 直接处理。

### 决策 3：文档提取在 SDK 层完成，不在 Engine 层

**选择**：在 `WebBackendHost._build_submit_coroutine()` 覆盖中处理附件（调用 `AttachmentProcessor`），提取后通过 `handle_message` 送入 engine。`ReactBackendHost` 基类提供此方法的空壳实现，SDK 通过覆盖注入附件逻辑。  
**理由**：`QueryEngine` 应只关心 `ConversationMessage`，不应感知文件格式。Gateway/SDK 层已有 I/O 处理职责。  
**备选**：在 `QueryEngine.submit_message` 中处理 → 违反单一职责，且 CLI 直接用 engine 时不应引入 pdfminer 依赖。  
**注意**：原设计引用的 `_build_message_from_request()` 方法不存在；接口审查确定正确注入点是 `_build_submit_coroutine`（见接口审查节问题 2）。

### 决策 4：`handle_line` 扩展为 `handle_message`，向后兼容

**选择**：新增 `handle_message(bundle, message: ConversationMessage, ...)` 函数，`handle_line` 内部调用 `handle_message(bundle, ConversationMessage.from_user_text(line), ...)`  
**理由**：保持现有 CLI 入口不变，附件路径走新函数。最小化改动范围。

### 决策 5：CLI `@path` 语法移出本次变更范围

**决定**：本次变更不实现 CLI `@path` 文件引用语法，将其列为后续独立变更。  
**理由**：本变更已覆盖 Web UI + Gateway + SDK + 核心引擎，范围已足够大；CLI 路径涉及 `InputSession` 解析、路径安全校验、TUI 预览渲染等额外工作，与 Web UI 路径没有代码复用点，作为独立变更更清晰。  
**原设计**（已废弃）：`InputSession` 解析 `@/path/to/file` token → 构建 `AttachmentPayload` 列表，返回 `(text, attachments)` 元组。此方向正确但移至后续实现。

---

## 输出方向补充设计

### 输出现状分析

当前输出链路所有节点均为字符串：

```
tool.execute() → ToolResult.output: str
               → ToolResultBlock.content: str
               → ToolExecutionCompleted.output: str
               → TranscriptItem.text: str
               → Web UI 只渲染文本
```

`image_generation_tool` 已将生成的图片写入本地文件，但只返回 `"Wrote /path/to/image.png"` 字符串，Web UI 中看不到图片。

### 输出决策 1：`ToolResult` 新增可选 `media_blocks` 字段，不改变 `output: str`

**选择**：`ToolResult` 新增 `media_blocks: list[ImageBlock] | None = None`；`output` 保持 `str` 作为文本描述  
**理由**：向后兼容——所有现有工具无需修改，只有选择携带图片的工具才填充 `media_blocks`。`output` 始终作为文本摘要（如 "生成了 image.png"）供非视觉场景使用。  
**备选**：将 `output` 改为 `str | list[ContentBlock]` → 破坏所有现有工具的 `isinstance(result.output, str)` 检查，改动范围过大。

### 输出决策 2：`ToolResultBlock.content` 扩展为 `str | list[dict]`

**选择**：`content` 类型改为 `str | list[dict]`（dict 为序列化后的 content block，含 `type/text/source` 等字段）；`serialize_content_block` 处理列表形式  
**理由**：与 Anthropic API 的 `computer_use` 工具结果格式对齐（API 原生支持 tool_result 包含图片）。使用 `list[dict]` 而非 `list[TextBlock | ImageBlock]` 是因为：① `ToolResultBlock` 在 `messages.py` 模块，与 `TextBlock`/`ImageBlock` 同文件不会循环依赖，但 ② `list[dict]` 更简单且与 Pydantic 的 `model_dump()` 序列化结果天然一致，不需要额外的块类型判断逻辑。当 `media_blocks` 非空时，后端自动将 `str` content + `media_blocks` 合并为列表形式。  
**备选**：额外字段 `image_content: list[ImageBlock]` → 不对齐 API 格式，序列化时需要额外处理；`list[TextBlock | ImageBlock]` → 类型更严格但序列化更复杂（两种不同的 pydantic 模型）。

### 输出决策 3：`ToolExecutionCompleted` 新增 `media_blocks` 字段传播图片到前端

**选择**：`ToolExecutionCompleted` 新增 `media_blocks: list[dict] | None = None`（序列化后的 base64 数据，避免循环依赖）  
**理由**：流式事件是工具结果到 UI 的唯一通道；不在事件中携带数据则前端无法渲染。使用序列化 dict 而非 `ImageBlock` 对象，避免 `stream_events` 模块依赖 `messages` 模块的复杂性。  
**备选**：通过 `BackendEvent.state` 侧信道传递 → 时序耦合，前端需要关联 tool_id 匹配。

### 输出决策 4：`TranscriptItem` 新增 `media: list[MediaItem] | None` 字段

**选择**：新增 `MediaItem(type: Literal["image", "document"], data: str, media_type: str, source_path: str | None, filename: str | None)` 模型；`TranscriptItem` 新增 `media: list[MediaItem] | None = None`

**`type` 字段语义：**
- `type="image"` — 图片内容（用户输入附件 or 工具输出图片）
- `type="document"` — 文档附件（PDF/DOCX/CSV 等），只携带元数据（filename、mime_type），不含二进制数据

**`data` 字段语义约定**：
- `data = "<base64>"` — 输入附件图片（数据在 WS 消息中传输）
- `data = ""` — 输出图片（REST 懒加载）或文档附件（无需传输数据，只显示 chip）

前端检测：
- `type="image" && data` → `<img src="data:...">` 直接显示
- `type="image" && !data && source_path` → 触发 REST 懒加载
- `type="document"` → 渲染文件名 chip（`filename` + `media_type` 决定图标颜色）

**混合场景验证（text + image + PDF）：**
```python
# 引擎侧 ✓
ConversationMessage.content = [
    TextBlock(text="分析这张图和报告"),
    ImageBlock(data="<png base64>"),
    DocumentBlock(filename="report.pdf", text_content="..."),
]

# Transcript 侧 ✓ (扩展后)
TranscriptItem(
    role="user",
    text="分析这张图和报告",
    media=[
        MediaItem(type="image",    data="<base64>", media_type="image/png",        filename="screenshot.png"),
        MediaItem(type="document", data="",         media_type="application/pdf",  filename="report.pdf"),
    ]
)
```

**理由**：Web UI transcript 组件需要统一字段承载所有附件类型的显示元数据；图片和文档共享同一 `media` 列表，前端只需检查 `type` 字段分路渲染，不需要两个独立字段。`MediaItem` 可扩展（未来可支持 `type="audio"` 等）。  
**备选**：在 `TranscriptItem.text` 中嵌入 Markdown 图片语法 `![...](data:image/...)` → 不安全（XSS 风险）；单独 `document_chips` 字段 → 分散的字段设计不利于统一处理。

### 输出决策 5：`image_generation` 工具通过 `ToolResult.media_blocks` 携带图片数据

**选择**：`image_generation` 工具成功写入图片文件后，读取文件 base64 直接填入 `ToolResult.media_blocks`（`list[dict]`，每个 dict 含 `type/media_type/data/source_path`）；`query.py` 从 `result.media_blocks` 填充 `ToolExecutionCompleted.media_blocks`；`backend_host.py` 的 `_render_event` 闭包读取 `event.media_blocks` 转换为 `TranscriptItem.media`。  
**理由**：`ToolResult.media_blocks` 是干净的一等字段，比 `metadata` 更有类型约束，不会与其他 metadata 字段冲突。整条链路 `ToolResult → ToolResultBlock → ToolExecutionCompleted → TranscriptItem` 每层都有对应字段，不需要靠 `metadata` key 字符串做约定。  
**备选**：`result.metadata["image_b64_list"]`（原设计）→ metadata 是弱类型 dict，key 拼写错误难发现，且 metadata 不保证被传播到 stream 事件层。  
**注意**：原 design.md 写的 metadata 路径已被任务规格采用的 `media_blocks` 字段路径取代；以 tasks.md 中的任务描述为权威实现依据。

### 输出决策 6：输出图片永远不内联 base64，一律通过 REST 懒加载

**背景**：uvicorn 默认 WebSocket 帧上限为 **16MB**。`n=3 high` 图片约 16MB base64，`n=10 medium` 约 20MB，会直接导致连接断开。  

**核心区分**：
- **输入附件**（用户发送）：文件只在客户端存在，必须通过 WS inline base64 传输给 engine
- **输出图片**（工具生成）：文件**已写入服务器磁盘**（`generated_images/` 目录），通过 WS 传输 base64 是完全多余的

**选择**：
1. `image_generation_tool.py` 的 `media_blocks` 中，`data` 字段**留空**（`""`），只填 `source_path`（绝对路径）
2. Gateway 新增 `GET /api/sessions/{id}/files?path={abs_path}` 端点，直接 serve 磁盘文件（限制只能访问 session cwd 范围内的路径）
3. `MediaItem` 模型的 `data` 字段改为 `data: str = ""`（空字符串表示懒加载）
4. Web UI `ImageGrid`：收到 `source_path` 非空且 `data` 为空的 `MediaItem` 时，自动发起 `GET /api/sessions/{id}/files?path=...` 拉取图片（作为 data URL 显示）

**对比方案 A（内联限制）的劣势**：
- UX 不一致：部分图片可见部分不可见，且规则对用户不透明
- 重连 replay 时截断的图片永久丢失（文件在磁盘但 WS 历史里没有路径）
- 仍然存在边界问题（1 张高质量图片可能就超限）

**懒加载的附加优势**：
- `_replay_transcript` 无需存储 base64，只需重放 `source_path`，重连后图片仍可加载
- WS 消息体积 `n=10` 情况下从 ~20MB 降至 ~1KB（只有路径字符串）
- Gateway 文件服务端点 (`StaticFiles` 或简单路由) 复用于其他工具产生的输出文件

**安全约束**：
- 文件路径必须在 session 的 `cwd` 范围内（`Path.resolve()` 后检查 `startswith(session_cwd)`）
- 不允许绝对路径穿越到 cwd 之外

---

## Risks / Trade-offs

- **大文件内存压力** → 初始版本限制单文件 5MB，整个请求 10MB；超限返回错误提示
- **pdfminer/python-docx 依赖体积** → 设为可选依赖（`extras_require["document"]`），不安装时降级为"仅图片模式"，提示用户
- **base64 WS 帧大小** → 5MB 文件 base64 后约 6.7MB，在 WebSocket 消息中可接受；`image_generation` 多图情况见 Open Questions
- **格式提取质量** → PDF 含扫描图像时提取结果为空；降级时提示"该 PDF 是扫描版，建议截图后作为图片发送"
- **安全：附件大小校验采用双层防御** → 前端校验（`size_bytes`，快速反馈）+ Gateway 服务端校验（实际 base64 字节数，防伪造）；两层均独立有效，不互相依赖
- **`ToolResultBlock.content` 类型变更** → `str → str | list[dict]` 经 pydantic 2.13.4 测试验证：历史 str 值和新 list[dict] 值均自动正确处理，**不需要** `@field_validator`；序列化往返（model_dump → model_validate）完全兼容
- **`model_dump(exclude_none=True)` 的 scope** → 只修改 `HLAgent/gateway/routers/ws.py` 中的 `send_json` 调用；`backend_host.py` 中的 TUI 路径不变（TUI 输出走 stdout JSON Lines，格式由前端解析，`None` 字段不影响）
- **Web UI 图片懒加载** → 输出图片通过 `GET /api/sessions/{id}/files` REST 懒加载（决策 6），前端 `ImageGrid` 组件在挂载时自动触发；骨架屏保证 UX 流畅；懒加载失败显示 `onError` 降级占位

## Migration Plan

**输入侧（无破坏性变更）：**
1. `FrontendRequest.attachments` 为可选字段，旧客户端不发此字段时行为完全不变
2. `DocumentBlock`/`MediaItem`/`AttachmentPayload` 均为新增模型，不影响现有序列化
3. `_process_line` 签名增加可选参数 `user_media=None`，现有调用点无需修改
4. `_build_submit_coroutine` 新增方法，现有 CLI 路径仍通过 `handle_line` 进入，不受影响

**输出侧（需要兼容处理）：**
5. `ToolResultBlock.content: str → str | list[dict]` — **潜在破坏性**：历史会话存储中 `content` 均为 `str`；反序列化时 `str` 仍有效，`list[dict]` 为新增路径。需确认 pydantic `field_validator` 或 union 处理不报错。建议：加 `@field_validator("content", mode="before")` 处理两种类型。
6. `event.model_dump(exclude_none=True)` — 现有 WS 客户端可能依赖某些 `null` 字段存在；前端 TypeScript 代码中所有字段应声明为可选（`?:`），这是已有惯例，不应有破坏。
7. `ToolResult.media_blocks` — 新增字段，所有现有工具返回 `None`，query.py 中读取时做 `if result.media_blocks:` 判断，向后兼容。

**部署顺序：**
1. 后端（core + SDK + Gateway）先部署，新字段均可选，旧前端仍可用
2. 前端最后部署，完成后用户可看到附件输入和图片内联输出
3. 回滚：移除 `attachments`/`media` 字段不影响现有消息流；`ToolResultBlock.content` 类型回退需同步 query.py

## Open Questions

**已关闭（审查期间确定）：**
- ~~CLI `@path` 语法~~ → 移出本次变更范围（见决策 5）
- ~~`ToolResultBlock.content` 用 `list[TextBlock | ImageBlock]` 还是 `list[dict]`~~ → 确定用 `list[dict]`（见输出决策 2）
- ~~`media_blocks` 走 metadata 还是直接字段~~ → 确定走 `ToolResult.media_blocks` 直接字段（见输出决策 5）
- ~~是否使用 Anthropic API 原生 PDF `document` 内容类型~~ → **v1 不使用，原因如下（已调研）**：

  **各厂商原生 PDF 支持现状（2025.05）**：

  | Provider | 原生 PDF 支持 | 状态 | 内容类型 |
  |----------|-------------|------|---------|
  | Anthropic Claude | ✅ | **Beta**（需要 `anthropic-beta: files-api-2025-04-14` header） | `document` 块，支持文字+图像页面识别，500MB/600页 |
  | OpenAI / OpenAI-compatible | ❌ | 不支持 | 必须预处理为文字或图片 |
  | Google Gemini | ✅ | GA | Files API，`inline_data` base64，20MB |
  | Mistral | 部分 | 仅图片 | 需转为图片 |
  | Cohere | ✅ | 支持 | Files API（文档上下文，非视觉） |

  **决定**：v1 对所有 provider 统一使用文字提取（`pdfminer.six`）路径，原因：
  1. Anthropic 原生支持仍为 **beta**，不适合作为 v1 依赖的功能
  2. OpenAI-compatible provider 占比大，必须有通用 fallback
  3. 文字提取路径已经能满足核心需求
  
  **未来路径**：当 Anthropic PDF 支持 GA 后，在 `serialize_content_block` 中加 provider-aware 分支：Anthropic provider → 输出原生 `document` 格式（保留 base64，走文件 API），其他 provider → 保持文字提取路径。此改动只影响序列化层，不需要修改 `DocumentBlock` 模型本身。

**仍然开放：**
- ~~`image_generation` 多张图片内联 vs REST 按需拉取~~ → **已决定：输出图片永远不内联，一律 REST 懒加载**（见输出决策 6）
- ~~`ToolResultBlock.content` 反序列化 pydantic union validator~~ → **已测试（pydantic 2.13.4）：不需要显式 `@field_validator`**。`str | list[dict]` union 在以下所有场景均自动正确处理：①字符串输入 → `str`；②list[dict] 输入 → `list[dict]`；③`model_validate_json` 从旧 JSON str 恢复 → 正确；④`model_validate_json` 从新 JSON list 恢复 → 正确；⑤`model_dump()` + `model_validate()` 往返 → 正确。唯一需注意：`None` 和非 dict 的 list 元素会正确抛出 `ValidationError`，不会静默通过。

---

## 接口审查（Coder 视角）

### 问题 1：附件无文本消息被静默丢弃 【BUG - BLOCKER】

**位置**：`src/openharness/ui/backend_host.py` `ReactBackendHost.run()` 循环

**现状**：
```python
line = (request.line or "").strip()
if not line:
    continue  # ← 附件无文本时 line 为空，消息被静默丢弃
self._busy = True
await self._run_active_request(self._process_line(line))
```

**影响**：spec 中"仅附件无文本的消息"场景完全无法工作。

**修复方案**：空行检查必须移到附件判断之后：
```python
if not line and not request.attachments:
    continue
```

---

### 问题 2：ReactBackendHost.run() 循环不传递 attachments 【BUG - BLOCKER】

**位置**：`backend_host.py` 同一循环体

**现状**：`self._process_line(line)` 只传 `str`，`request.attachments` 字段被完全丢弃。

**修复方案**：将 `submit_line` 处理提取为可覆盖方法：

```python
# 在 ReactBackendHost 中新增（基类降级实现，仅传 line）
async def _build_submit_coroutine(self, request: FrontendRequest):
    line = (request.line or "").strip()
    if not line and not getattr(request, "attachments", None):
        return None  # 空消息跳过
    return self._process_line(line)

# 原循环改为调用该方法
coro = await self._build_submit_coroutine(request)
if coro is None:
    continue
```

`WebBackendHost`（SDK 层）覆盖此方法，加入附件处理：

```python
async def _build_submit_coroutine(self, request: FrontendRequest):
    if request.attachments:
        return self._process_message_with_attachments(request)
    return await super()._build_submit_coroutine(request)
```

这样 **改动仅 3 行核心代码**，向后兼容，SDK 有干净的覆盖点。

---

### 问题 3：`_render_event` 是局部闭包，WebBackendHost 无法覆盖 【设计缺陷】

**位置**：`backend_host.py` `_process_line` 方法内部

**现状**：`_render_event` 是 `_process_line` 的内部 `async def`，不是实例方法，无法被子类覆盖。

**影响**：`ToolExecutionCompleted.media_blocks → TranscriptItem.media` 的映射原定在 SDK 层实现，但 SDK 无法覆盖这个闭包。

**修复方案**：将媒体映射直接加入 `ReactBackendHost` 的 `_render_event` 闭包（作为核心功能），不依赖 SDK 覆盖：

```python
if isinstance(event, ToolExecutionCompleted):
    media = None
    if event.media_blocks:
        media = [MediaItem(**b) for b in event.media_blocks]
    await self._emit(BackendEvent(
        type="tool_completed",
        ...
        item=TranscriptItem(role="tool_result", text=event.output, media=media, ...),
    ))
```

这样 `media_blocks → TranscriptItem.media` 的映射在核心 `backend_host.py` 中完成，SDK 无需覆盖任何 `_render_event`。

---

### 问题 4：user TranscriptItem 不含 media【BUG】

**位置**：`backend_host.py` `_process_line` 方法

**现状**：
```python
await self._emit(
    BackendEvent(type="transcript_item", item=TranscriptItem(role="user", text=transcript_line or line))
)
```

**影响**：用户消息携带图片附件时，transcript 中的用户消息行不包含图片数据，Web UI 无法在用户气泡中渲染附件缩略图。

**修复方案**：`_process_line` 需要接受额外的 `media: list[MediaItem] | None = None` 参数（或改为接受整个 `ConversationMessage`），在 emit 用户 transcript 时带入：

```python
async def _process_line(self, line: str, *, transcript_line=None, user_media=None) -> bool:
    await self._emit(BackendEvent(type="transcript_item", item=TranscriptItem(
        role="user", text=transcript_line or line, media=user_media
    )))
```

---

### 问题 5：Gateway WS `_replay_transcript` 无法处理 `list` 类型 content 【BUG】

**位置**：`HLAgent/gateway/routers/ws.py` `_replay_transcript` 函数

**现状**：
```python
content_str = tr.content if isinstance(tr.content, str) else str(tr.content)
# 当 content 为 list[dict] 时，str() 输出类似 "[{'type': 'text', ...}]"
```

**影响**：
1. 历史 tool_result 消息重放时显示乱码
2. 重放不包含图片媒体（replay 丢失图片 `media`）

**修复方案**：
```python
if isinstance(tr.content, list):
    # 从 list 中提取文本部分
    text_parts = [b.get("text","") for b in tr.content if isinstance(b,dict) and b.get("type")=="text"]
    text = "\n".join(text_parts)[:1000]
    # 提取图片部分恢复 media
    media = [MediaItem(type="image", data=b["source"]["data"], media_type=b["source"]["media_type"])
             for b in tr.content if isinstance(b,dict) and b.get("type")=="image"]
else:
    text = (tr.content or "")[:1000]
    media = None
```

---

### 问题 6：Gateway WS 未对附件做服务端字节校验 【安全漏洞】

**位置**：`HLAgent/gateway/routers/ws.py` `forward_requests` 函数

**现状**：收到消息直接 `push_request(req)`，无任何附件大小校验。

**安全问题**：客户端上报的 `size_bytes` 可以任意伪造（如报 100B 实际传 50MB base64），绕过校验。

**修复方案**：在 Gateway 层用**实际 base64 数据长度**做服务端校验：

```python
# forward_requests 中，push_request 之前：
if req.attachments:
    total = sum(len(a.data) * 3 // 4 for a in req.attachments)  # 近似解码字节数
    single_max = max((len(a.data) * 3 // 4 for a in req.attachments), default=0)
    if single_max > 5 * 1024 * 1024 or total > 10 * 1024 * 1024:
        err = BackendEvent(type="error", message="附件过大：单文件限制 5MB，总计限制 10MB")
        await websocket.send_json(err.model_dump(exclude_none=True))
        continue  # 不调用 push_request
```

---

### 问题 7：model_dump() 未排除 None 字段，media base64 大幅膨胀 WS 消息 【性能问题】

**位置**：`ws.py` 中所有 `await websocket.send_json(event.model_dump())`

**现状**：`event.model_dump()` 序列化所有字段（含 `None`），当 `TranscriptItem.media` 包含 5MB 图片 base64 时，整个 JSON WS 帧约 6.7MB+。同时，大量 `None` 字段浪费带宽。

**修复方案**：全局改为 `event.model_dump(exclude_none=True)`，可减少 30~50% 的无附件消息体积，也确保 base64 仅在有 media 时才传输。

---

### 接口修复优先级总结

| 优先级 | 问题 | 文件 | 影响 |
|--------|------|------|------|
| P0 | 附件无文本消息被丢弃 | `backend_host.py` | 功能完全不可用 |
| P0 | attachments 不传递到处理函数 | `backend_host.py` | 所有附件功能不可用 |
| P0 | Gateway 无服务端大小校验 | `ws.py` | 安全漏洞 |
| P1 | `_render_event` 闭包无法覆盖 | `backend_host.py` | SDK 设计错误，需改为核心处理 |
| P1 | user TranscriptItem 不含 media | `backend_host.py` | 用户消息气泡不显示附件 |
| P1 | replay 无法处理 list content | `ws.py` | 重连后历史消息乱码 |
| P2 | model_dump 不排除 None | `ws.py` (all) | 性能，large media 场景 |
