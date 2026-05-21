## ADDED Requirements

### Requirement: 消息支持附件字段
`FrontendRequest` SHALL 新增 `attachments: list[AttachmentPayload] | None` 字段，每个 `AttachmentPayload` 包含 `filename: str`、`mime_type: str`、`data: str`（base64 编码的文件内容）、`size_bytes: int`。

#### Scenario: 单图片附件随消息发送
- **WHEN** 客户端发送 `FrontendRequest(type="submit_line", line="这张图里有什么？", attachments=[{filename: "screenshot.png", mime_type: "image/png", data: "<base64>", size_bytes: 12345}])`
- **THEN** 后端将附件转换为 `ImageBlock`，与文本 `TextBlock` 组合为 `ConversationMessage`，送入 `QueryEngine.submit_message`

#### Scenario: 多附件混合发送
- **WHEN** 客户端发送含 1 张图片 + 1 个 PDF 文件的 `FrontendRequest`
- **THEN** 图片附件成为 `ImageBlock`，PDF 附件经文档提取后成为 `DocumentBlock`，均附加到同一 `ConversationMessage`

#### Scenario: 附件超出大小限制
- **WHEN** 单个附件 base64 解码后字节数超过 5MB 或所有附件解码后总字节数超过 10MB
- **THEN** Gateway 在调用 `push_request` 之前返回 `BackendEvent(type="error", message="附件过大：单文件限制 5MB，总计限制 10MB")`，消息不被处理；大小校验使用实际 base64 解码长度（`len(data) * 3 // 4`），不信任客户端上报的 `size_bytes`

#### Scenario: 仅附件无文本的消息
- **WHEN** 客户端发送 `FrontendRequest(type="submit_line", line="", attachments=[...])` 且 `line` 为空
- **THEN** 后端以纯附件内容构建 `ConversationMessage`（无 `TextBlock`），正常提交；`ReactBackendHost` 的空行 `continue` 检查 SHALL 在附件存在时跳过

### Requirement: ReactBackendHost 提供可覆盖的 `_build_submit_coroutine` 接口
`ReactBackendHost.run()` 的 `submit_line` 处理 SHALL 通过可覆盖的方法 `_build_submit_coroutine(request: FrontendRequest) -> Coroutine | None` 分发处理逻辑，以便 SDK 层（`WebBackendHost`）通过覆盖该方法加入附件处理，而不修改核心请求循环。

#### Scenario: 基类实现降级为文本处理
- **WHEN** `ReactBackendHost._build_submit_coroutine` 被调用且 `request.attachments` 为空
- **THEN** 返回 `self._process_line(request.line or "".strip())` 协程；若 `line` 为空且无附件，返回 `None`（循环跳过）

#### Scenario: SDK 覆盖加入附件处理
- **WHEN** `WebBackendHost._build_submit_coroutine` 被调用且 `request.attachments` 非空
- **THEN** 返回 `self._process_message_with_attachments(request)` 协程，由 `AttachmentProcessor` 处理后调用 `handle_message`

#### Scenario: 核心循环调用该方法
- **WHEN** `ReactBackendHost.run()` 收到 `type="submit_line"` 请求
- **THEN** 调用 `coro = await self._build_submit_coroutine(request)`；若 `coro is None` 则 `continue`；否则 `self._run_active_request(coro)`

### Requirement: 新增 DocumentBlock 内容类型
引擎消息模型 SHALL 新增 `DocumentBlock(type="document", filename: str, mime_type: str, text_content: str)` 表示从文档文件中提取的文本内容。

#### Scenario: DocumentBlock 序列化为 API 请求
- **WHEN** `serialize_content_block` 处理 `DocumentBlock`
- **THEN** 输出格式为 `{"type": "text", "text": "[文件: {filename}]\n\n{text_content}"}`，将文件名作为上下文前缀嵌入文本

#### Scenario: DocumentBlock 加入 ContentBlock union
- **WHEN** 代码执行 `from openharness.engine.messages import ContentBlock`
- **THEN** `ContentBlock` union 包含 `DocumentBlock`，可通过 pydantic discriminator `type="document"` 正确解析

### Requirement: `_process_line` 支持传入用户媒体数据
`_process_line` SHALL 接受可选的 `user_media: list[MediaItem] | None = None` 参数，在发出用户 TranscriptItem 时将媒体数据附加，使用户消息气泡能显示附件缩略图。

#### Scenario: 含图片附件时用户 transcript item 携带 media
- **WHEN** `_process_line(line="分析这张图", user_media=[MediaItem(type="image", ...)])` 被调用
- **THEN** 发出的用户 `TranscriptItem` 包含 `media=[MediaItem(...)]`，Web UI 可在用户气泡中渲染图片缩略图

#### Scenario: 无附件时 media 为 None
- **WHEN** `_process_line("hello")` 被调用（无 user_media 参数）
- **THEN** 用户 `TranscriptItem.media = None`，与现有行为一致

### Requirement: `media_blocks → TranscriptItem.media` 在核心 backend_host 完成
`ToolExecutionCompleted` 事件中的 `media_blocks` → `TranscriptItem.media` 映射 SHALL 在 `ReactBackendHost._process_line._render_event` 闭包中完成（核心层），而非在 SDK `WebBackendHost` 中覆盖，原因是 `_render_event` 是局部闭包不可在子类覆盖。

#### Scenario: 核心渲染层处理 media_blocks
- **WHEN** `_render_event` 收到 `ToolExecutionCompleted(media_blocks=[{type: "image", ...}])`
- **THEN** 构建 `media = [MediaItem(**b) for b in event.media_blocks]`，加入 `TranscriptItem(role="tool_result", media=media)`；`media_blocks is None` 时 `TranscriptItem.media = None`

### Requirement: handle_message 函数扩展 runtime 层
`runtime.py` SHALL 新增 `handle_message(bundle, message: ConversationMessage, *, print_system, render_event, clear_output) -> bool` 函数，接受完整的 `ConversationMessage`（含附件 content blocks）。

#### Scenario: 纯文本消息路由到 handle_message
- **WHEN** 调用 `handle_line(bundle, "hello", ...)`
- **THEN** 内部调用 `handle_message(bundle, ConversationMessage.from_user_text("hello"), ...)`，行为与原来一致

#### Scenario: 含附件消息绕过命令解析
- **WHEN** 调用 `handle_message` 且 `message.content` 包含非 `TextBlock` 内容块
- **THEN** 跳过斜杠命令解析（不可能是命令），直接提交给 `engine.submit_message(message)`

#### Scenario: 纯文本仍触发命令解析
- **WHEN** 调用 `handle_message` 且 `message.content` 只含单个 `TextBlock`，文本以 `/` 开头
- **THEN** 正常执行命令解析和分发逻辑
