## ADDED Requirements

### Requirement: WebBackendHost 通过覆盖 `_build_submit_coroutine` 注入附件处理
`WebBackendHost` SHALL 覆盖 `ReactBackendHost` 新增的 `_build_submit_coroutine(request: FrontendRequest)` 方法（而非 `push_request` 或直接修改核心循环），在检测到 `request.attachments` 时返回附件处理协程，无附件时降级到父类实现。

> **背景**：接口审查发现 `push_request` 并非正确的附件处理注入点——它只是把请求放入队列，附件处理应在请求实际被处理时（`_build_submit_coroutine`）进行，而非入队时。

#### Scenario: 含附件请求走附件处理路径，混合场景（文字+图片+PDF）全部正确处理
- **WHEN** `_build_submit_coroutine` 收到 `{line: "分析", attachments: [image.png, report.pdf]}` 请求
- **THEN** 返回 `_process_message_with_attachments(request)` 协程，执行时：①`AttachmentProcessor` 将 image.png → `ImageBlock`、report.pdf → `DocumentBlock`；②构建 `user_media = [MediaItem(type="image", data="<base64>", ...), MediaItem(type="document", data="", filename="report.pdf", ...)]`；③emit `TranscriptItem(role="user", text="分析", media=user_media)` 图片和文档 chip 都在同一 TranscriptItem 中；④`ConversationMessage.content = [TextBlock("分析"), ImageBlock(...), DocumentBlock(...)]` 提交 engine ✓

#### Scenario: 无附件请求降级到文本处理
- **WHEN** `_build_submit_coroutine` 收到 `request.attachments` 为空的请求
- **THEN** 调用 `super()._build_submit_coroutine(request)` 返回原有 `_process_line(line)` 协程

#### Scenario: 附件处理失败时发送 error 事件并终止
- **WHEN** `AttachmentProcessor` 返回错误（如不支持的 MIME 类型）
- **THEN** `_process_message_with_attachments` 发出 `BackendEvent(type="error", message="<错误信息>")`，返回 `True`（继续处理下一条消息，不终止会话）

#### Scenario: 仅附件无文本时正常构建消息
- **WHEN** `request.line` 为空、`request.attachments` 非空
- **THEN** 构建 `ConversationMessage(content=[ImageBlock(...)])` 无 `TextBlock`，正常送入 engine

### Requirement: media_blocks → TranscriptItem.media 映射在核心层完成（不在 SDK）
`ToolExecutionCompleted.media_blocks → TranscriptItem.media` 的映射 SHALL 在 `ReactBackendHost._process_line._render_event` 闭包中实现，而非 `WebBackendHost` 覆盖，原因是 `_render_event` 是局部闭包无法子类覆盖。

#### Scenario: 核心渲染层处理 media_blocks（通过 image_generation metadata 路径）
- **WHEN** `_render_event` 收到 `ToolExecutionCompleted(tool_name="image_generation", media_blocks=[{...}])`
- **THEN** 在 `backend_host.py` 核心层中构建 `MediaItem` 列表，填入 `TranscriptItem.media`，发出包含媒体数据的 `tool_completed` 事件

#### Scenario: SDK 不需要覆盖 _render_event
- **WHEN** SDK `WebBackendHost` 实例处理 `ToolExecutionCompleted` 事件
- **THEN** 继承自 `ReactBackendHost` 的 `_process_line` 中的 `_render_event` 闭包处理，SDK 层无需任何 media_blocks 相关覆盖

### Requirement: 文档附件处理后发出提取确认事件
`WebBackendHost._process_message_with_attachments` SHALL 在成功处理文档类附件（PDF/DOCX/CSV/JSON）后，在发出用户消息 transcript item 之前，先 emit 一条 `transcript_item`（role="system"）确认消息，告知用户文档被读取的字数/行数。

#### Scenario: PDF 成功提取后发出确认消息
- **WHEN** `AttachmentProcessor` 成功将 report.pdf 提取为 2340 字的文本
- **THEN** 先 emit `BackendEvent(type="transcript_item", item=TranscriptItem(role="system", text="📄 report.pdf 已读取（约 2,340 字）"))`，再发送用户消息到 engine

#### Scenario: 扫描版 PDF 发出友好警告消息
- **WHEN** `AttachmentProcessor` 判断 PDF 为扫描件（提取内容为空）
- **THEN** emit 警告系统消息（含建议文字），放弃发送该消息给模型，返回 `True`（继续会话）

#### Scenario: 图片附件不发出确认消息
- **WHEN** `AttachmentProcessor` 成功将图片处理为 `ImageBlock`
- **THEN** 不发出额外系统消息，直接进入正常消息发送流程

