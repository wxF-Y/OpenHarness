## ADDED Requirements

### Requirement: TranscriptItem 支持 media 字段
`TranscriptItem` SHALL 新增可选字段 `media: list[MediaItem] | None = None`，其中 `MediaItem` 为新增模型，包含 `type: Literal["image"]`、`data: str`（base64）、`media_type: str`（MIME 类型）、`source_path: str | None`（原始文件路径，可选）。

#### Scenario: 工具结果含图片时 TranscriptItem 携带 media
- **WHEN** `ToolExecutionCompleted` 事件含 `media_blocks` 数据
- **THEN** 后端发出的 `BackendEvent(type="tool_completed", item=TranscriptItem(role="tool_result", text="Wrote image.png", media=[MediaItem(type="image", ...)]))` 包含图片数据

#### Scenario: 纯文本工具结果 media 为 None
- **WHEN** `ToolExecutionCompleted.media_blocks is None`
- **THEN** `TranscriptItem.media is None`；JSON 序列化时省略该字段

### Requirement: ToolCallCard 中的图片网格替换文本输出
当 `ToolCallCard` 的 `resultItem.media` 非空时，图片结果区域 SHALL 渲染图片网格，取代原有的纯文本 pre 块显示。

#### Scenario: image_generation 工具结果显示图片网格
- **WHEN** `resultItem.media` 含 1~N 张图片
- **THEN** ToolCallCard 的输出区渲染图片网格（flex-wrap，每张图片最大宽度 `220px`，间距 `6px`），每张图片有 `border-radius: 6px` 和 `cursor: pointer`，文件路径文本以灰色小字显示在图片网格下方（`#6c7086`，`0.7rem`）

#### Scenario: 多图片超出 3 张时折叠显示
- **WHEN** `resultItem.media` 含 4 张以上图片
- **THEN** 默认显示前 3 张，第 4 张位置渲染 `+N` 计数遮罩（深色半透明背景，白色数字），点击后展开显示全部；展开/折叠有 `200ms ease` 高度动画

### Requirement: 图片点击展开 Lightbox
ToolCallCard 和 Transcript 中的图片 SHALL 支持点击后展开 Lightbox 全屏预览。

#### Scenario: Lightbox 视觉规格
- **WHEN** 用户点击图片缩略图
- **THEN** 渲染全屏遮罩（`position: fixed; inset: 0; z-index: 1000`，背景 `rgba(17,17,27,0.92)`），中央显示图片（`max-width: 90vw; max-height: 85vh; border-radius: 8px; box-shadow: 0 8px 40px rgba(0,0,0,0.7)`），右上角有关闭按钮（`32×32px`，背景 `#313244`，悬停 `#45475a`，`×` 字符），左下角显示文件名（`#a6adc8`，`0.8rem`），右下角有下载按钮（蓝色 `#89b4fa` 文字，`↓ 下载`）

#### Scenario: Lightbox 多图导航
- **WHEN** 来自同一 ToolCallCard 的多张图片
- **THEN** Lightbox 显示左右箭头（`◀ ▶`，悬停背景 `rgba(137,180,250,0.15)`），点击或键盘 `←/→` 切换；底部显示 `1/3` 页码指示器（白色圆点，当前页蓝色实心）

#### Scenario: Lightbox 关闭方式
- **WHEN** 用户按 `Esc`、点击遮罩或点击 × 按钮
- **THEN** Lightbox 以 `150ms ease` 淡出关闭，焦点回到触发元素

#### Scenario: 图片加载状态
- **WHEN** `<img>` 元素尚未加载完成
- **THEN** 显示骨架屏占位（背景 `#313244`，带 shimmer 动画，尺寸与图片目标尺寸相同）

#### Scenario: 图片加载失败降级
- **WHEN** `<img>` 触发 `onError`
- **THEN** 占位区域显示灰色背景 + `🖼️` 图标 + `[无法加载图片]` 文字（`#6c7086`，`0.75rem`），不报 JS 异常

### Requirement: 用户消息气泡中显示发送的附件
当用户消息含图片附件时，用户消息行 SHALL 在文本下方渲染附件预览行。

#### Scenario: 用户消息图片附件显示
- **WHEN** 用户消息 `TranscriptItem` 含 `media` 字段（图片）
- **THEN** 在消息文本 `div` 下方（`padding-top: 6px`）渲染图片缩略图行：每张图片 `56×56px` 正方形（`border-radius: 4px`，`object-fit: cover`，`cursor: pointer`），点击可进入 Lightbox，最多并排显示 4 张，超出折叠

#### Scenario: 用户消息文档附件显示为 chip
- **WHEN** 用户消息 `TranscriptItem.media` 含 `type="document"` 的 `MediaItem`（`filename="report.pdf"`, `media_type="application/pdf"`）
- **THEN** 渲染文档 chip：圆角胶囊（`border-radius: 12px`，`border: 1px solid #313244`，`padding: 3px 8px`），左侧文件类型颜色图标（PDF→红色 `#f38ba8`，DOCX→蓝色 `#89b4fa` 等），右侧 `filename`（`0.75rem`，`#a6adc8`）

#### Scenario: 混合消息（文字 + 图片 + 文档）在用户气泡中全部显示
- **WHEN** 用户发送 "分析这张图和报告" + screenshot.png + report.pdf
- **THEN** 用户消息气泡显示：文本 "分析这张图和报告" → 图片缩略图（来自 `type="image"` MediaItem）→ PDF chip（来自 `type="document"` MediaItem），所有元素在同一气泡内垂直排列

### Requirement: BackendEvent tool_completed 携带媒体数据
当 `ToolExecutionCompleted` 事件含媒体数据时，`BackendEvent` 的 `tool_completed` 类型事件 SHALL 在 `item.media` 字段中传递图片数据到 Web UI。

#### Scenario: tool_completed 事件含图片 item
- **WHEN** 后端发出 `BackendEvent(type="tool_completed", item=TranscriptItem(role="tool_result", media=[...]))`
- **THEN** Web UI 收到的 JSON 含 `item.media` 数组，每项包含 `type`、`data`、`media_type`、`source_path`

### Requirement: 文档附件发送后在 transcript 显示提取确认消息
当用户发送含文档附件的消息后，系统 SHALL 在 transcript 中显示一条简短的 system 消息，告知用户文档已被读取及提取字数，让用户知道 AI 确实"看到"了文档内容。

#### Scenario: PDF 成功提取后显示确认消息
- **WHEN** 服务端成功提取 report.pdf 的文字内容（约 2340 字）
- **THEN** transcript 中在用户消息之后、AI 回复之前，插入 system 消息：`"📄 report.pdf 已读取（约 2,340 字）"`，颜色 `#6c7086`，字体 `0.75rem`，无角色标签（区别于正式 assistant/system 消息）

#### Scenario: CSV/JSON 提取后显示确认消息
- **WHEN** 服务端成功读取 data.csv（42 行）
- **THEN** transcript 显示：`"📋 data.csv 已读取（42 行）"`，同上样式

#### Scenario: 图片附件不显示提取确认消息
- **WHEN** 用户发送含图片附件的消息，服务端转为 ImageBlock
- **THEN** 不显示额外 system 消息（图片是直觉性的，用户理解 AI 能看图片）

### Requirement: Lightbox 中提供"复制到剪贴板"功能
Lightbox 工具栏 SHALL 提供"复制"按钮，让用户可直接将生成的图片复制到系统剪贴板，以便粘贴到其他应用，无需先下载再上传。

#### Scenario: Lightbox 复制按钮
- **WHEN** Lightbox 打开后，用户点击"📋 复制"按钮
- **THEN** 调用 `navigator.clipboard.write([ClipboardItem({...})])` 将图片写入剪贴板；成功后按钮短暂变为"✓ 已复制"（`color: #a6e3a1`），1.5 秒后恢复；失败时显示 Toast"复制失败，请手动下载"

#### Scenario: 内联图片网格悬停显示快捷操作
- **WHEN** 用户鼠标悬停在 ToolCallCard 中的图片缩略图上超过 300ms
- **THEN** 图片右下角浮现半透明操作条（`padding: 4px 6px; background: rgba(17,17,27,0.8); border-radius: 0 0 5px 5px; display: flex; gap: 6px`）：`"📋"` 复制按钮 + `"⤢"` 全屏按钮，均 `color: #cdd6f4; font-size: 0.7rem; cursor: pointer`；悬停离开时操作条以 `100ms` 消失

### Requirement: 图片生成工具显示绝对保存路径
`image_generation` 工具卡片显示的保存路径 SHALL 为绝对路径（或相对于 cwd 的清晰路径），悬停时 tooltip 显示完整路径，让用户能找到文件。

#### Scenario: 路径显示绝对路径，过长时截断
- **WHEN** ToolCallCard 渲染 `"📁 已保存至 <path>"` 路径文字
- **THEN** 若路径超过 50 字符，显示末尾 50 字符并前缀 `…`；完整路径在鼠标悬停 tooltip 中展示；路径文字可点击，点击后尝试打开文件所在目录（`window.__TAURI__?.shell.open()` 如在 Tauri 环境中，否则无响应但保持 cursor: default）

#### Scenario: 路径文字右侧显示"打开目录"图标
- **WHEN** ToolCallCard 的图片网格底部渲染路径行
- **THEN** 路径文字后面有一个 `📁` 图标按钮（`cursor: pointer; color: #6c7086; hover: #89b4fa`），悬停 tooltip "在文件管理器中打开"

### Requirement: 扫描版 PDF 提取失败提供友好引导
当 PDF 提取结果为空（扫描件）时，系统 SHALL 以用户能理解的语言说明原因，并提供明确的恢复操作建议，而非仅显示技术性错误。

#### Scenario: 扫描版 PDF 友好错误消息
- **WHEN** 服务端判断 PDF 为扫描件（提取文字为空字符串）
- **THEN** transcript 中在用户消息后显示 system 消息（警告样式，`color: #f9e2af`）：
  ```
  ⚠️ report.pdf 是扫描版，无法读取文字内容
  💡 试试这样做：将 PDF 的关键页面截图，然后作为图片发送给 AI
  ```
  同时不将该空文档发送给模型（节省 token，避免困惑 AI）

### Requirement: 图片生成后显示"继续编辑"引导提示
`image_generation` 工具成功生成图片后，工具卡片底部 SHALL 显示一行简短的使用提示，引导用户知道可以继续与 AI 交互来修改图片，消除"我该怎么继续"的疑惑。

#### Scenario: 图片生成成功后显示操作提示
- **WHEN** ToolCallCard 的图片网格渲染完成（`resultItem.media` 非空，非错误）
- **THEN** 网格最下方（路径文字之后）显示一行浅色提示（`color: #585b70; font-size: 0.7rem; padding: 4px 12px 8px`）：`"💬 可继续描述修改意见，AI 将重新生成"`

### Requirement: 用户消息在 transcript 中清晰标识已发送附件
用户消息气泡 SHALL 以直观方式展示随消息一起发送的附件，让用户回看历史时能快速辨识"我当时发了什么文件"。

#### Scenario: 图片附件在用户消息中带文件名
- **WHEN** 用户消息 `TranscriptItem` 含图片 `media` 字段
- **THEN** 缩略图下方（或 tooltip）显示文件名（如 `截图_14-32.png`），而非仅显示匿名图片块，让用户能识别具体是哪张截图

#### Scenario: 多附件超过 4 个时显示"+N更多"
- **WHEN** 用户消息含 7 个附件
- **THEN** 显示前 4 个缩略图/chip，第 5 位显示 `"+3 更多"` 文字 chip（`#6c7086`），点击后展开显示全部
