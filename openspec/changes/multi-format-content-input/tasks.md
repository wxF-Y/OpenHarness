## 1. 数据模型层

- [x] 1.1 在 `src/openharness/engine/messages.py` 新增 `DocumentBlock(type="document", filename, mime_type, text_content)` 模型
- [x] 1.2 将 `DocumentBlock` 加入 `ContentBlock` Annotated union（discriminator `type="document"`）
- [x] 1.3 在 `serialize_content_block` 中处理 `DocumentBlock`，输出 `{"type": "text", "text": "[文件: {filename}]\n\n{text_content}"}`
- [x] 1.4 将 `ToolResultBlock.content` 类型从 `str` 扩展为 `str | list[dict]`；更新 `serialize_content_block` 处理列表形式（对齐 Anthropic tool_result 多内容块格式）——无需 `@field_validator`，pydantic v2 已测试验证自动兼容
- [x] 1.5 在 `src/openharness/ui/protocol.py` 新增 `AttachmentPayload` 模型（`filename`, `mime_type`, `data: str`, `size_bytes: int`）
- [x] 1.6 在 `FrontendRequest` 中添加 `attachments: list[AttachmentPayload] | None = None` 字段
- [x] 1.7 在 `src/openharness/ui/protocol.py` 新增 `MediaItem` 模型（`type: Literal["image", "document"]`, `data: str`, `media_type: str`, `source_path: str | None`, `filename: str | None`）——`type="image"` 用于图片显示，`type="document"` 用于文档 chip 显示，`data=""` 作为懒加载/无数据哨兵
- [x] 1.8 在 `TranscriptItem` 中添加 `media: list[MediaItem] | None = None` 字段

## 2. 文档提取服务

- [x] 2.1 新建 `src/openharness/services/attachment_processor.py`，定义 `AttachmentProcessor` 类和 `process_attachments(attachments) -> list[ContentBlock] | AttachmentError`
- [x] 2.2 实现图片附件处理：`image/png`、`image/jpeg`、`image/gif`、`image/webp` → `ImageBlock`（含 mime 类型校验）
- [x] 2.3 实现 PDF 文本提取：使用 `pdfminer.six`（可选依赖），提取失败时返回结构化错误
- [x] 2.4 实现 DOCX 文本提取：使用 `python-docx`（可选依赖）
- [x] 2.5 实现 CSV/JSON/文本/代码文件处理：base64 解码 → UTF-8 → `DocumentBlock`
- [x] 2.6 实现不支持类型的明确拒绝逻辑（返回用户友好错误信息）
- [x] 2.7 实现大小校验：单文件 ≤5MB，总计 ≤10MB
- [x] 2.8 在 `pyproject.toml` 添加可选依赖组 `[document]`（pdfminer.six, python-docx, openpyxl）

## 3. 工具富输出层

- [x] 3.1 在 `src/openharness/tools/base.py` 的 `ToolResult` 新增 `media_blocks: list[dict] | None = None` 字段
- [x] 3.2 在 `src/openharness/engine/stream_events.py` 的 `ToolExecutionCompleted` 新增 `media_blocks: list[dict] | None = None` 字段
- [x] 3.3 在 `src/openharness/engine/query.py` 的工具执行完成处：从 `result.media_blocks` 填充 `ToolExecutionCompleted.media_blocks`
- [x] 3.4 在 `src/openharness/engine/query.py` 的 `ToolResultBlock` 构建处：当 `result.media_blocks` 非空时，将 `output` 文本和 media_blocks 合并为列表形式的 `content`
- [x] 3.5 修改 `src/openharness/tools/image_generation_tool.py`：成功写入图片文件后，填入 `result.media_blocks` 时 `data` 字段留空（`""`），只填 `source_path`（绝对路径）和 `media_type`；不读取文件 base64（输出图片走 REST 懒加载，见决策 6）

## 4. Runtime 层扩展

- [x] 4.1 在 `src/openharness/ui/runtime.py` 新增 `handle_message(bundle, message: ConversationMessage, *, print_system, render_event, clear_output) -> bool`
- [x] 4.2 在 `handle_message` 中：仅当 message 为单 TextBlock 时执行斜杠命令解析；否则直接提交给 engine
- [x] 4.3 重构 `handle_line` 内部调用 `handle_message`（向后兼容包装）

## 4b. Core ReactBackendHost 接口修复（接口审查发现的 P0/P1 问题）

- [x] 4b.1 【P0】修复 `src/openharness/ui/backend_host.py` `ReactBackendHost.run()` 中的空行 `continue` 检查：改为 `if not line and not getattr(request, "attachments", None): continue`，修复附件无文本消息被静默丢弃的 bug
- [x] 4b.2 【P0】在 `ReactBackendHost` 中新增可覆盖方法 `_build_submit_coroutine(self, request: FrontendRequest) -> Coroutine | None`：基类实现返回 `_process_line(line)` 协程（无附件时）或 `None`（空消息时）；`run()` 循环调用该方法替代直接调用 `_process_line`
- [x] 4b.3 【P1】修改 `_process_line(line, *, transcript_line=None)` 方法签名为 `_process_line(line, *, transcript_line=None, user_media=None)`，在发出用户 TranscriptItem 时带入 `media=user_media`
- [x] 4b.4 【P1】在 `_process_line._render_event` 闭包中处理 `ToolExecutionCompleted.media_blocks`：构建 `MediaItem` 列表，填入 `TranscriptItem(role="tool_result", media=media)`；不在 SDK 层覆盖（因为闭包不可覆盖）

## 5. SDK 层：WebBackendHost 附件处理

- [x] 5.1 在 `HLAgent/sdk/hlagent_sdk/web_host.py` 的 `WebBackendHost` 中覆盖 `_build_submit_coroutine`：`request.attachments` 非空时返回 `self._process_message_with_attachments(request)` 协程；否则 `super()._build_submit_coroutine(request)`
- [x] 5.2 新建 `_process_message_with_attachments(request: FrontendRequest) -> bool` 方法，调用链如下：①调用 `AttachmentProcessor.process_attachments(request.attachments)`；失败时 emit error BackendEvent 并返回 `True`；②成功后构建 `user_media`：从 content_blocks 提取 `ImageBlock` → `MediaItem(type="image", data=<base64>, media_type=..., filename=...)` 和 `DocumentBlock` → `MediaItem(type="document", data="", media_type=..., filename=...)`；③直接 emit 用户 `TranscriptItem(role="user", text=request.line or "", media=user_media)`；④构建完整 `ConversationMessage(role="user", content=[TextBlock(line)]+content_blocks if line else content_blocks)`；⑤调用 `handle_message(self._bundle, message, ...)` 提交 engine；⑥返回 `bool`
- [x] 5.3 文档类附件提取成功后，先 emit 系统确认消息（"📄 X.pdf 已读取（约 N 字）"），再进入正常消息处理
- [x] 5.4 扫描版 PDF 提取失败时：emit 友好警告 + 恢复建议，放弃发送给模型，返回 True

## 6. Gateway 网关层

- [x] 6.1 在 `HLAgent/gateway/` 新增 `POST /api/sessions/{id}/attachments` 路由（multipart/form-data），返回附件元数据
- [x] 6.2 【P0】修改 `HLAgent/gateway/routers/ws.py` `forward_requests`：在 `push_request` 前加入服务端字节数校验（`len(a.data) * 3 // 4`），超限时发送 error BackendEvent 并 `continue`，不信任客户端 `size_bytes`
- [x] 6.3 【P2】将 `ws.py` 中所有 `event.model_dump()` 改为 `event.model_dump(exclude_none=True)`（涵盖 `forward_events`、`_replay_transcript`、`websocket.send_json` 调用处）
- [x] 6.4 【P1】修复 `ws.py` `_replay_transcript` 中 `ToolResultBlock.content` 处理：`isinstance(tr.content, list)` 时提取 text 部分 + 恢复图片 `MediaItem`（path-only，`data=""`）；不调用 `str(list)`
- [x] 6.5 【决策 6】新增 `GET /api/sessions/{id}/files` 端点（`HLAgent/gateway/routers/sessions.py` 或新文件 `files.py`）：接受 `?path={abs_path}` 查询参数，验证路径在 session cwd 范围内（`Path(path).resolve().is_relative_to(session_cwd)`），返回文件字节（`FileResponse`）；路径穿越时返回 HTTP 403

## 7. Web UI 前端：协议类型扩展

- [x] 7.1 在 `HLAgent/web/src/types/protocol.ts` 新增 `MediaItem` 接口（`type: "image" | "document"`, `data: string`, `media_type: string`, `source_path?: string`, `filename?: string`）；前端逻辑：`type="image" && data` → img 直显；`type="image" && !data` → REST lazy；`type="document"` → chip
- [x] 7.2 在 `TranscriptItem` 接口中添加 `media?: MediaItem[]` 字段
- [x] 7.3 在 `FrontendRequest` 接口中添加 `attachments?: AttachmentPayload[]`；新增 `AttachmentPayload` 接口（`filename`, `mime_type`, `data`, `size_bytes`）

## 8. Web UI 前端：输入附件 UX

- [x] 8.1 新建 `HLAgent/web/src/components/AttachmentStrip.tsx`：`AttachmentStrip` 组件，接受 `attachments: AttachmentFile[]` 和 `onRemove: (id) => void`，支持 `height: 0 → 88px` 出现/消失动画
- [x] 8.2 新建 `ImageChip.tsx`：`64×64px` 图片缩略图卡片，悬停时边框变蓝（`#89b4fa`），× 按钮悬停变红（`#f38ba8`），含 `150ms ease` 过渡
- [x] 8.3 新建 `DocumentChip.tsx`：文档卡片（`min-width: 160px; height: 44px`），左侧文件类型颜色徽章（PDF→red、DOCX→blue、XLSX→green、CSV→yellow、JSON→mauve），中间两行显示文件名和"将提取文字内容"说明（`#6c7086; 0.65rem`），右侧 × 按钮
- [x] 8.4 在 `MessageInput.tsx` 中引入 `AttachmentStrip`，置于 textarea 上方；在输入区左侧添加附件按钮（`📎`），绑定隐藏 `<input type="file" multiple accept=...>`；附件按钮悬停显示格式说明 tooltip（三行：图片/文档/数据 + AI 处理方式 + 大小限制）
- [x] 8.5 附件按钮右上角显示已附加数量角标（N ≥ 1 时显示蓝色圆角标，N = 0 时隐藏）
- [x] 8.6 在 `MessageInput.tsx` 中新增 `useAttachments` hook：管理 `AttachmentFile[]` 状态，提供 `addFiles / removeFile / clearAll`；`addFiles` 中实现 5MB 大小校验，超限时 Toast 包含文件名、大小和"可用截图工具裁剪"建议
- [x] 8.7 新建 `DropOverlay.tsx`：`position: absolute; inset: 0; z-index: 50` 覆盖层，中央 `96×96px` 虚线圆 + 格式说明文字，`120ms ease opacity` 动画；不支持类型的 drop 显示含建议的错误 Toast（如视频→"可截取视频帧后作为图片发送"）
- [x] 8.8 在聊天容器绑定拖拽事件，控制 `DropOverlay` 显示；drop 后调用 `addFiles()`
- [x] 8.9 在 `MessageInput.tsx` 的 textarea 监听 `onPaste`：提取 `image/*` 类型 item，文件名自动命名为 `截图_HH-MM`（同分钟多次粘贴追加 `_2` `_3`），同时显示绿色 Toast
- [x] 8.10 新建 `Toast.tsx`：`ToastContainer` + `useToast()` hook，支持 success/error/info 三种 variant；错误 Toast 支持两行显示（第一行原因 + 第二行建议），4 秒超时（建议型）/ 3 秒（普通型）
- [x] 8.11 `busy = true` 时附件按钮禁用（`opacity: 0.4; cursor: not-allowed`），悬停提示"AI 响应完成后再添加附件"；已有附件 × 按钮也禁用
- [x] 8.12 修改 `sendMessage` 函数：发送时附件列表 base64 编码期间将发送按钮文字改为"处理中…"，附件 ≥ 3 个时底部提示行临时显示"正在编码 N 个附件…"，消息发出后恢复；发送成功后调用 `clearAll()`；底部提示行有附件时追加`"📎 N个附件"` 提示

## 9. Web UI 前端：输出媒体渲染

- [x] 9.1 新建 `HLAgent/web/src/components/ImageLightbox.tsx`：Portal 组件，全屏遮罩（`rgba(17,17,27,0.92)`），图片（`max: 90vw × 85vh`），工具栏：左下文件名 + 右下"↓ 下载"按钮 + "📋 复制"按钮（复制成功变"✓ 已复制" 1.5 秒后恢复，失败时 Toast 提示）；多图左右箭头 + dots 页码；键盘 `←/→/Esc`；`180ms ease opacity` 动画
- [x] 9.2 新建 `ImageGrid.tsx`：图片网格，每图 `max 220×160px; border-radius: 6px; object-fit: cover; cursor: pointer`，悬停时右下角浮现操作条（📋 复制 + ⤢ 全屏，`300ms` 延迟显示）；>3 张时第 4 位显示 `+N` 遮罩；骨架屏 shimmer；`onError` 降级；图片可点击进 Lightbox；**【决策 6】对 `media.data === ""` 的 lazy MediaItem，挂载时发起 `GET /api/sessions/{sessionId}/files?path={source_path}`，拉取后转为 data URL 显示；拉取中显示骨架屏**
- [x] 9.3 修改 `ToolCallCard.tsx`：`resultItem.media` 非空时用 `ImageGrid` 替换文本输出；路径行显示绝对路径（截断 + 悬停 tooltip 全路径）；路径行右侧加 `📁` 图标按钮（悬停变蓝，尝试打开目录）；路径行下方显示"💬 可继续描述修改意见，AI 将重新生成"提示文字（`#585b70; 0.7rem`）；ToolCallCard 右上角状态变为"ok N张图片"
- [x] 9.4 修改 `TranscriptViewer.tsx` 的 `MessageRow`：user 消息附件行：图片缩略图 `56×56px`（含 filename tooltip），文档显示 chip；超过 4 个附件显示"+N 更多"，可展开；所有图片可点击进 Lightbox；接收到 role="system" 的提取确认消息时以特殊样式渲染（无角色标签，`#6c7086; 0.75rem`，左侧 `📄` 或 `⚠️` 图标）
- [x] 9.5 在 `HLAgent/web/src/types/protocol.ts` 更新 `BackendEvent` 和 WebSocket 事件解析逻辑，正确反序列化 `item.media` 字段

## 10. 测试

- [x] 10.1 为 `AttachmentProcessor` 每种文件类型写单元测试（图片/PDF/DOCX/CSV/不支持类型/超限）
- [x] 10.2 为 `DocumentBlock` 和 `ToolResultBlock` 列表 content 序列化写单元测试
- [x] 10.3 为 `ToolExecutionCompleted.media_blocks` 传播写单元测试（engine query.py 层）
- [x] 10.4 为 `image_generation` 工具的 `media_blocks` 填充写单元测试（含降级场景）
- [x] 10.5 为 `handle_message` 写单元测试（含附件路径、命令解析绕过）
- [x] 10.6 为 `WebBackendHost` 附件处理和媒体渲染写集成测试（mock AttachmentProcessor）
- [x] 10.7 为 Gateway 附件端点和 WS 大小校验写 API 测试
