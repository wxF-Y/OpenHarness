## ADDED Requirements

### Requirement: 图片文件直接转换为 ImageBlock
附件处理器 SHALL 将 MIME 类型为 `image/png`、`image/jpeg`、`image/gif`、`image/webp` 的附件直接转换为 `ImageBlock`，使用附件的 base64 `data` 字段。

#### Scenario: PNG 图片附件转 ImageBlock
- **WHEN** 附件 `{mime_type: "image/png", data: "<base64>", filename: "chart.png"}`
- **THEN** 输出 `ImageBlock(media_type="image/png", data="<base64>", source_path="chart.png")`

#### Scenario: 不支持的图片格式拒绝
- **WHEN** 附件 `{mime_type: "image/bmp", ...}`
- **THEN** 返回错误 `"不支持的图片格式：image/bmp。支持：PNG, JPEG, GIF, WebP"`

### Requirement: PDF 文件提取为文本
附件处理器 SHALL 对 `application/pdf` 附件使用 `pdfminer.six` 提取文本，结果存入 `DocumentBlock`。

#### Scenario: 成功提取 PDF 文本
- **WHEN** 附件为有效的文字型 PDF（非扫描图）
- **THEN** 输出 `DocumentBlock(filename="report.pdf", mime_type="application/pdf", text_content="<提取的文本>")`

#### Scenario: 扫描型 PDF 提取失败降级
- **WHEN** PDF 所有页均为扫描图像，`pdfminer` 提取结果为空字符串
- **THEN** 返回错误 `"该 PDF 不含可提取的文字（可能为扫描件）。请将 PDF 页面截图后作为图片附件发送。"`

#### Scenario: pdfminer 未安装时降级
- **WHEN** `pdfminer` 未安装（可选依赖），收到 PDF 附件
- **THEN** 返回错误 `"PDF 支持未安装。请运行 pip install openharness[document] 启用。"`

### Requirement: DOCX 文件提取为 Markdown 文本
附件处理器 SHALL 对 `application/vnd.openxmlformats-officedocument.wordprocessingml.document` 附件使用 `python-docx` 提取段落文本，以换行分隔存入 `DocumentBlock`。

#### Scenario: DOCX 成功提取
- **WHEN** 附件为有效的 `.docx` 文件
- **THEN** 输出 `DocumentBlock(filename="memo.docx", mime_type="application/vnd.openxmlformats-...", text_content="<段落文本，换行分隔>")`

### Requirement: CSV/JSON/纯文本文件作为 DocumentBlock
附件处理器 SHALL 将 `text/csv`、`application/json`、`text/plain`、`text/markdown` 及常见代码文件（`text/x-python`、`application/javascript` 等）的附件直接解码为 UTF-8 文本，存入 `DocumentBlock`。

#### Scenario: CSV 文件直接读取
- **WHEN** 附件 `{mime_type: "text/csv", filename: "data.csv", data: "<base64>"}`
- **THEN** 输出 `DocumentBlock(filename="data.csv", mime_type="text/csv", text_content="<CSV 文本>")`

#### Scenario: 编码错误降级
- **WHEN** 文件 base64 解码后无法以 UTF-8 解析（二进制文件误报为文本类型）
- **THEN** 返回错误 `"无法读取文件 {filename}：内容不是有效的 UTF-8 文本"`

### Requirement: 不支持的 MIME 类型明确拒绝
附件处理器 SHALL 对未列在支持范围内的 MIME 类型返回明确错误，而不是静默忽略。

#### Scenario: 视频文件被拒绝
- **WHEN** 附件 `{mime_type: "video/mp4", filename: "demo.mp4"}`
- **THEN** 返回错误 `"不支持的文件类型：video/mp4。支持：图片（PNG/JPEG/GIF/WebP）、PDF、Word、CSV、JSON、文本、代码文件"`
