## Why

当前 OpenHarness 的消息输入仅支持纯文本行，**输出**也仅能渲染纯文本：`FrontendRequest.line` 是单个字符串，`ToolResult.output` 是 `str`，`TranscriptItem.text` 是 `str`，`ToolResultBlock.content` 是 `str`。虽然内部数据模型（`ImageBlock`、`TextBlock`）已具备多内容类型的表示能力，但**输入→推理→输出**整条链路都是纯字符串管道，导致：
- 用户无法将图片截图、PDF 报告、CSV 数据文件附加到对话中
- 工具（如图片生成、截图）的结果只能以文件路径文本展示，不能内联渲染
- Transcript 中看不到生成的图片，只看到路径字符串

## What Changes

**输入方向：**
- **协议层**：`FrontendRequest` 新增 `attachments` 字段，承载文件附件（base64 编码 + mime type + filename）
- **数据模型**：新增 `DocumentBlock` 表示文本类文档（PDF/DOCX/XLSX/CSV 提取后的文本）
- **网关 API**：新增 `POST /api/sessions/{id}/attachments` 文件上传端点
- **服务端文档提取**：PDF → 文本、DOCX/XLSX → Markdown 表格、CSV/JSON → 格式化文本的提取管道
- **Web UI 输入区**：文件选择按钮、拖拽上传区域、粘贴图片（Clipboard API）、发送前附件预览卡片

**输出方向：**
- **工具富输出**：`ToolResult` 支持携带图片/二进制数据，`ToolResultBlock.content` 支持内容块列表（对齐 Anthropic computer_use 协议）
- **流式事件扩展**：`ToolExecutionCompleted` 新增 `media_blocks` 字段传递图片数据
- **Transcript 媒体支持**：`TranscriptItem` 新增 `media` 字段，Web UI transcript 内联渲染图片
- **图片生成结果内联**：`image_generation` 工具输出的图片在 Web UI 中直接内联显示

## Capabilities

### New Capabilities

- `message-attachments`: 消息附件的核心协议和数据模型——FrontendRequest 附件字段、DocumentBlock 类型、网关上传端点、附件路由（图片→ImageBlock，文档→DocumentBlock）
- `document-extraction`: 服务端文档文本提取管道——PDF/DOCX/XLSX/CSV/JSON 转换为模型可消费的文本表示
- `web-ui-attachment-input`: Web UI 文件输入 UX——文件选择、拖拽投放、剪贴板粘贴图片、附件预览和移除
- `rich-tool-output`: 工具执行结果的富媒体支持——ToolResult 图片数据字段、ToolResultBlock 内容块列表、ToolExecutionCompleted 媒体传播
- `inline-media-transcript`: Transcript 内联媒体渲染——TranscriptItem 媒体字段、BackendEvent 媒体数据传递、Web UI 图片内联渲染

### Modified Capabilities

- `hlagent-gateway`: 新增附件上传 REST 端点，WebSocket 消息帧支持附件字段
- `hlagent-sdk`: `WebBackendHost.push_request()` 处理附件；事件渲染处理工具媒体输出
- `hlagent-web-ui`: Transcript 组件支持内联图片渲染

## Impact

- `src/openharness/engine/messages.py`：新增 `DocumentBlock`，扩展 `ContentBlock` union；`ToolResultBlock.content` 类型扩展
- `src/openharness/engine/stream_events.py`：`ToolExecutionCompleted` 新增 `media_blocks` 字段
- `src/openharness/tools/base.py`：`ToolResult` 新增 `media_blocks` 可选字段
- `src/openharness/ui/protocol.py`：`FrontendRequest` 新增 `attachments`；`TranscriptItem` 新增 `media` 字段；`BackendEvent` 扩展
- `src/openharness/ui/backend_host.py`：`push_request()` 处理附件；事件渲染处理媒体数据
- `HLAgent/gateway/`：新增附件上传路由
- `HLAgent/web/`：聊天输入附件 UX；Transcript 内联图片渲染
- 新增可选依赖：`pdfminer.six`（PDF 提取）、`python-docx`（DOCX）、`openpyxl`（XLSX）
