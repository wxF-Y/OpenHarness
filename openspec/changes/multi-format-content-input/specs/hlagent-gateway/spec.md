## ADDED Requirements

### Requirement: Gateway 提供文件上传端点（可选预处理路径）
Gateway SHALL 提供 `POST /api/sessions/{id}/attachments` 端点，接受 multipart/form-data，返回附件元数据（供未来异步上传使用）。初始版本中此端点为可选路径，Web UI 优先使用内联 base64 协议。

#### Scenario: 预上传文件并获取引用 ID
- **WHEN** 客户端 POST multipart 请求含文件字段 `file`（支持图片、PDF、DOCX 等）
- **THEN** 返回 HTTP 201，body 含 `{"attachment_id": "<uuid>", "filename": "...", "mime_type": "...", "size_bytes": N}`；文件暂存至服务器内存或临时目录

#### Scenario: 文件大小超限
- **WHEN** 上传文件超过 5MB
- **THEN** 返回 HTTP 413，body 含 `{"error": "文件过大，最大 5MB"}`

### Requirement: Gateway WebSocket 消息对附件做服务端字节校验
Gateway WS handler SHALL 在调用 `push_request` 之前，对 `FrontendRequest.attachments` 进行**服务端实际字节数校验**，不信任客户端上报的 `size_bytes`（可伪造）。

#### Scenario: 服务端校验使用 base64 实际长度
- **WHEN** WS 收到含 `attachments` 的消息
- **THEN** 对每个附件计算 `actual_bytes = len(attachment.data) * 3 // 4`（base64 解码近似值）；单个超过 5MB 或总计超过 10MB 时，发送 `BackendEvent(type="error", ...)` 并跳过，不调用 `push_request`

#### Scenario: WS 消息附件校验通过正常路由
- **WHEN** 所有附件实际字节数在限制内
- **THEN** 调用 `await host.push_request(req)`，将完整请求（含 attachments）传入 host

#### Scenario: WS 消息附件总大小超限（服务端检测）
- **WHEN** WS 消息中 attachments 实际总字节数超过 10MB
- **THEN** Gateway 直接向 WebSocket 发送 `BackendEvent(type="error", message="附件过大：单文件限制 5MB，总计限制 10MB")`，不调用 `push_request`

### Requirement: Gateway WebSocket 事件发送全局使用 exclude_none 序列化
Gateway WS handler 中所有 `event.model_dump()` 调用 SHALL 改为 `event.model_dump(exclude_none=True)`，避免 `None` 字段占用带宽，在 media base64 数据存在时尤其重要。

#### Scenario: 含 media 的事件正常序列化
- **WHEN** 发送包含 `TranscriptItem.media = [MediaItem(...)]` 的 BackendEvent
- **THEN** JSON 中 `item.media` 字段存在，包含图片 base64 数据

#### Scenario: 无 media 的事件不含 media 字段
- **WHEN** 发送 `TranscriptItem.media = None` 的普通文本事件
- **THEN** 序列化后 JSON 不含 `media` 键，减少无附件消息的体积约 30%

### Requirement: Gateway WS `_replay_transcript` 正确处理 list 类型 ToolResultBlock.content
`_replay_transcript` 函数 SHALL 处理 `ToolResultBlock.content` 为 `list[dict]` 的情况，同时在重放时恢复图片 media 数据。

#### Scenario: 重放含 list content 的 tool_result
- **WHEN** 历史 `ToolResultBlock.content` 为 `[{"type": "text", "text": "ok"}, {"type": "image", ...}]`
- **THEN** 重放的 `TranscriptItem.text` 提取 text 部分（`"ok"`），`TranscriptItem.media` 恢复图片 `MediaItem`（`data=""`，`source_path` 从 dict 取出）；不调用 `str(list)` 生成乱码

#### Scenario: 重放纯文本 tool_result
- **WHEN** 历史 `ToolResultBlock.content` 为字符串 `"command output"`
- **THEN** 重放行为与当前一致（`text = content[:1000]`, `media = None`）

### Requirement: Gateway 提供输出文件懒加载端点
Gateway SHALL 提供 `GET /api/sessions/{id}/files?path={abs_path}` 端点，服务 session cwd 范围内的本地文件（主要用于 `image_generation` 等工具的输出图片懒加载）。

#### Scenario: 正常加载 session cwd 内的图片文件
- **WHEN** 客户端请求 `GET /api/sessions/{id}/files?path=/abs/path/to/generated_images/image.png`，路径在 session cwd 下
- **THEN** 返回 HTTP 200，`Content-Type: image/png`，文件字节流（`FileResponse`）

#### Scenario: 路径在 cwd 之外时拒绝
- **WHEN** 请求路径解析后不在 session cwd 范围内（如 `/../../../etc/passwd`）
- **THEN** 返回 HTTP 403，body 含 `{"error": "路径超出 session 工作目录范围"}`

#### Scenario: 文件不存在时返回 404
- **WHEN** 请求的路径在 cwd 范围内但文件已被删除
- **THEN** 返回 HTTP 404，body 含 `{"error": "文件不存在"}`

#### Scenario: session 不存在时返回 404
- **WHEN** `session_id` 对应的 session 不在 `session_mgr` 中
- **THEN** 返回 HTTP 404，body 含 `{"error": "Session not found"}`
