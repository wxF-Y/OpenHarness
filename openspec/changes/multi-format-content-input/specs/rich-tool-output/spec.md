## ADDED Requirements

### Requirement: ToolResult 支持 media_blocks 字段
`ToolResult` SHALL 新增可选字段 `media_blocks: list[dict] | None = None`，存储序列化为 dict 的图片内容块（含 `type`、`media_type`、`data` 字段），供后端层传播到 Transcript。

#### Scenario: 工具返回含图片的 ToolResult
- **WHEN** `image_generation` 工具成功生成图片并调用 `ToolResult(output="Wrote image.png", media_blocks=[{"type": "image", "media_type": "image/png", "data": "<base64>", "source_path": "image.png"}])`
- **THEN** `result.media_blocks` 非空；`result.output` 仍为可读文本摘要

#### Scenario: 不返回图片的工具 media_blocks 为 None
- **WHEN** `bash_tool` 执行命令并返回 `ToolResult(output="$ ls\nfile.txt")`
- **THEN** `result.media_blocks is None`；整个系统行为与现有一致（向后兼容）

### Requirement: ToolResultBlock.content 支持内容块列表
`ToolResultBlock.content` 字段类型 SHALL 扩展为 `str | list[dict]`，当 `ToolResult.media_blocks` 非空时，后端将文本 output 和 media_blocks 合并为列表形式。

#### Scenario: 纯文本工具结果序列化
- **WHEN** `ToolResultBlock.content` 为 `str`
- **THEN** `serialize_content_block` 输出 `{"type": "tool_result", "tool_use_id": "...", "content": "<str>"}`（与现有格式完全一致）

#### Scenario: 图片工具结果序列化
- **WHEN** `ToolResultBlock.content` 为 `[{"type": "text", "text": "Wrote image.png"}, {"type": "image", "source": {"type": "base64", ...}}]`
- **THEN** `serialize_content_block` 输出对应的 Anthropic API list 格式，模型可看到图片内容

#### Scenario: 会话历史反序列化兼容
- **WHEN** 从存储加载旧会话（`content` 字段为 `str`）
- **THEN** 反序列化正常完成，不报类型错误；`content` 值为字符串类型，行为与写入时一致

### Requirement: ToolExecutionCompleted 携带 media_blocks 字段
`ToolExecutionCompleted` 流式事件 SHALL 新增 `media_blocks: list[dict] | None = None` 字段，当工具返回含 media_blocks 的 `ToolResult` 时，该字段由引擎层自动填充。

#### Scenario: 工具有图片输出时事件携带媒体
- **WHEN** 工具执行完成，`result.media_blocks` 非空
- **THEN** `ToolExecutionCompleted(tool_name=..., output=..., media_blocks=[...])` 事件包含图片数据

#### Scenario: 工具无图片输出时 media_blocks 为 None
- **WHEN** 工具执行完成，`result.media_blocks is None`
- **THEN** `ToolExecutionCompleted(tool_name=..., output=..., media_blocks=None)`（与现有格式一致）

### Requirement: image_generation 工具在 media_blocks 中提供 source_path，不内联 base64
`image_generation` 工具 SHALL 在成功生成图片后，将 `source_path`（绝对路径）和 `media_type` 填入 `ToolResult.media_blocks`，但 `data` 字段**留空（`""`）**。前端通过 `GET /api/sessions/{id}/files?path=...` 懒加载图片文件，不通过 WS 内联传输 base64。

**原因**：uvicorn 默认 WS 帧上限 16MB；`n=3 high` 或 `n=10 medium` 的图片 base64 总量轻易超限，导致连接断开。输出图片已在服务器磁盘上，无需通过 WS 传输。

#### Scenario: 单张图片生成后 media_blocks 只含路径
- **WHEN** `image_generation` 工具成功生成 1 张图片并写入 `output_dir/image.png`
- **THEN** `result.media_blocks = [{"type": "image", "media_type": "image/png", "data": "", "source_path": "/abs/path/to/image.png"}]`；**`data` 为空字符串**，不读取文件内容

#### Scenario: 多张图片生成 media_blocks 含多个 path-only 条目
- **WHEN** `n=5`，生成 5 张图片
- **THEN** `result.media_blocks` 含 5 个 dict，每个 `data=""` 但 `source_path` 各不相同；WS 消息体积约 1KB（5 个路径字符串），远小于旧方案的 ~10MB base64

#### Scenario: 图片文件写入失败时 media_blocks 为 None
- **WHEN** 图片文件因磁盘满等原因写入失败
- **THEN** `result.media_blocks = None`；`result.output` 保持原有错误文本
