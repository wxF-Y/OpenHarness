## ADDED Requirements

### Requirement: 聊天输入区显示附件按钮
Web UI 的聊天输入组件 SHALL 在文本输入框旁显示文件附件按钮（回形针图标），点击后打开系统文件选择对话框。

#### Scenario: 点击附件按钮选择文件
- **WHEN** 用户点击附件按钮
- **THEN** 打开文件选择对话框，接受的文件类型过滤为：图片（image/*）、PDF、Word、CSV、JSON、纯文本、代码文件

#### Scenario: 选择多个文件
- **WHEN** 用户在文件选择对话框中选择多个文件
- **THEN** 所有选中文件显示为输入区上方的附件预览条

### Requirement: 附件预览条视觉规格
附件预览条 SHALL 出现在 textarea 上方、输入区边框内部，背景色 `#11111b`（`--ctp-crust`），上下 padding `8px`，左右 padding `12px`，以水平可滚动 flex row 展示附件卡片，卡片间距 `8px`。

#### Scenario: 图片附件卡片视觉
- **WHEN** 预览条中存在图片附件
- **THEN** 每张图片显示为 `64×64px` 正方形缩略图（`border-radius: 6px`，`object-fit: cover`），右上角有 `18×18px` 的 × 移除按钮（背景 `rgba(17,17,27,0.8)`，悬停变红 `#f38ba8`），图片外有 `2px solid #313244` 边框

#### Scenario: 文档附件卡片视觉
- **WHEN** 预览条中存在文档类附件（PDF/DOCX/XLSX/CSV/JSON）
- **THEN** 显示宽 `180px`、高 `44px` 的横向卡片：左侧 `16px` 区域显示文件类型颜色徽章（PDF→`#f38ba8`，DOCX→`#89b4fa`，XLSX→`#a6e3a1`，CSV→`#f9e2af`，JSON→`#cba6f7`）及对应图标，中间显示文件名（最多 20 字符截断加 `...`）和文件大小（如 `34KB`），右侧 × 移除按钮

#### Scenario: 附件卡片移除动画
- **WHEN** 用户点击 × 按钮
- **THEN** 该卡片以 `150ms ease-out` 透明度+缩放动画消失（`opacity: 0, scale(0.8)`）

### Requirement: 拖拽文件到聊天区域
Web UI 的聊天内容区 SHALL 支持文件拖拽：拖入时显示全屏覆盖的投放指示遮罩，松手后将文件加入附件列表。

#### Scenario: 拖拽进入时的遮罩视觉
- **WHEN** 用户将文件拖入聊天区域（`dragenter` 事件）
- **THEN** 在聊天区上方叠加 `position: absolute; inset: 0` 遮罩：背景 `rgba(30,30,46,0.88)`（`--ctp-base` + 透明度），中央显示 `96px` 虚线圆形边框（`3px dashed #89b4fa`），内置 `📎` 图标（`3rem`）和主提示文字"释放以添加附件"（`#89b4fa`，`1rem`），下方辅助文字"支持图片 · PDF · Word · Excel · CSV · JSON"（`#6c7086`，`0.75rem`）

#### Scenario: 拖离时遮罩消失
- **WHEN** 用户将文件拖出聊天区域（`dragleave` 事件，目标已离开根容器）
- **THEN** 遮罩以 `120ms ease` 淡出消失

#### Scenario: 拖入不支持的文件类型
- **WHEN** 用户拖入 `.mp4` 视频文件松手后
- **THEN** 遮罩消失，底部出现红色 Toast 提示（背景 `#f38ba8`，文字白色）：`"不支持的文件类型：video/mp4"`，3 秒后自动消失

### Requirement: 剪贴板粘贴图片
Web UI 的聊天输入框 SHALL 监听 `paste` 事件，将剪贴板中的图片数据自动加入附件列表。

#### Scenario: 截图粘贴视觉反馈
- **WHEN** 用户在聊天输入框聚焦时按 Ctrl+V，剪贴板含截图数据
- **THEN** 附件预览条以 `200ms slide-down` 动画出现（若之前隐藏），图片缩略图以 `180ms ease-out scale(0.6→1.0)` 弹入动画显示，同时显示短暂的绿色 Toast`"已从剪贴板添加图片"`（1.5 秒后消失）

### Requirement: 附件大小超限前端拦截与视觉反馈
附件处理器 SHALL 在文件超过 5MB 时，以红色 Toast 提示拒绝，不加入列表，Toast 包含文件名和大小。

#### Scenario: 单文件超限提示
- **WHEN** 用户选择或粘贴 6MB 的文件
- **THEN** 显示 Toast：`"文件过大：screenshot.png（6.2MB）超过 5MB 限制"` ，背景 `#f38ba8`（`--ctp-red`），3 秒后自动关闭

### Requirement: 输入区提示快捷键更新
有附件待发送时，输入区底部提示行 SHALL 追加附件数量提示，无附件时不显示。

#### Scenario: 有附件时底部提示显示附件数
- **WHEN** 附件预览条中有 2 个附件
- **THEN** 底部提示行追加一项`"📎 2个附件"` ，颜色 `#89b4fa`

### Requirement: 含附件消息通过 WebSocket 发送
Web UI SHALL 在发送 `FrontendRequest` 时将附件 base64 编码后内联在 `attachments` 字段，不做分离上传。

#### Scenario: 含附件的消息通过 WebSocket 发送
- **WHEN** 用户点击发送，输入区有文本和 1 个图片附件
- **THEN** WebSocket 发送 `{type: "submit_line", line: "<文本>", attachments: [{filename: "...", mime_type: "image/png", data: "<base64>", size_bytes: N}]}`

#### Scenario: 发送后清空附件预览条
- **WHEN** 用户提交消息（附件 + 文本）
- **THEN** 消息发送后附件预览条以动画收起并清空

### Requirement: 附件按钮显示支持格式提示
附件按钮 SHALL 在鼠标悬停时显示 tooltip，清楚告知用户支持的格式及 AI 如何处理每种类型，避免用户因不了解支持范围而产生困惑。

#### Scenario: 悬停附件按钮显示格式说明 tooltip
- **WHEN** 用户悬停在附件按钮上超过 500ms
- **THEN** 显示多行 tooltip（`max-width: 220px; background: #11111b; border: 1px solid #313244; border-radius: 6px; padding: 8px 10px; font-size: 0.75rem`）：
  - 第一行："🖼️ 图片" + `#89b4fa`色子标题"AI 可直接看见图片内容"
  - 第二行："📄 文档（PDF / Word / Excel）" + `#6c7086`色子标题"AI 将读取文字内容"
  - 第三行："📋 数据（CSV / JSON）" + `#6c7086`色子标题"AI 将读取结构化内容"
  - 分隔线后：`"最大 5MB / 总计 10MB"` `#585b70` 小字

#### Scenario: 附件按钮显示已附加文件数量角标
- **WHEN** 附件预览条中已有 N 个文件（N ≥ 1）
- **THEN** 附件按钮右上角显示蓝色角标（`background: #89b4fa; color: #1e1e2e; border-radius: 50%; width: 14px; height: 14px; font-size: 0.6rem; font-weight: 700`），内容为 N；N = 0 时角标隐藏

### Requirement: 文档附件卡片显示 AI 处理方式说明
文档类附件（PDF/DOCX/XLSX/CSV/JSON）的预览卡片 SHALL 在文件名下方显示一行浅色说明文字，让用户明白 AI 会"读取文字内容"而非看到文件版式，避免误解。

#### Scenario: 文档 chip 显示处理说明
- **WHEN** 预览条中存在 PDF 附件
- **THEN** `DocumentChip` 中间区域显示两行：第一行文件名（`#cdd6f4`），第二行"将提取文字内容"（`#6c7086`，`0.65rem`），代替原有"文件大小"单行设计

#### Scenario: 扫描型 PDF 无法提取的预警（发送后）
- **WHEN** 服务端返回错误"该 PDF 是扫描版，无法提取文字"
- **THEN** 在 transcript 中显示带引导的 system 消息：`"⚠️ report.pdf 无法读取文字（扫描版PDF）\n💡 建议：将 PDF 关键页截图后作为图片发送，AI 可以看到图片内容"`，颜色 `#f9e2af`（黄色警告）

### Requirement: 剪贴板粘贴图片自动命名
从剪贴板粘贴的图片 SHALL 自动生成带时间戳的文件名，而非使用无意义的 `image.png`，让用户在 transcript 中能辨识这是哪张截图。

#### Scenario: 粘贴截图自动命名
- **WHEN** 用户 Ctrl+V 粘贴截图
- **THEN** 图片文件名自动设置为 `截图_HH-MM`（当前本地时间，如 `截图_14-32`）；若同一分钟内有多次粘贴，追加序号（`截图_14-32_2`）

### Requirement: AI 正在响应时禁用附件添加
当 AI 正在响应（`busy = true`）时，附件按钮 SHALL 禁用，防止用户在处理中意外添加文件引发状态混乱。

#### Scenario: 运行中附件按钮禁用
- **WHEN** `busy = true`（AI 正在处理）
- **THEN** 附件按钮变为半透明（`opacity: 0.4; cursor: not-allowed`），悬停 tooltip 显示"AI 响应完成后再添加附件"；已有附件卡片仍可见但 × 按钮也禁用

### Requirement: 发送中进度状态反馈
含附件的消息发送时，因 base64 编码可能耗时 0.5~2 秒，输入区 SHALL 在此期间显示处理状态，避免用户以为卡住而重复点击。

#### Scenario: 含附件消息发送中显示进度提示
- **WHEN** 用户点击发送后、WebSocket 消息实际发出前（编码阶段）
- **THEN** 发送按钮文字变为"处理中…"，`disabled = true`；若附件超过 2 个，底部提示行临时显示`"正在编码 3 个附件…"`（`color: #89b4fa`）；消息发出后恢复正常

### Requirement: 不支持类型错误消息提供下一步建议
当用户提交了不支持类型的文件时，错误提示 SHALL 在说明原因之外，给出用户可立即采取的替代行动，而非仅仅拒绝。

#### Scenario: 视频文件拒绝附带建议
- **WHEN** 用户拖入或选择 `.mp4` / `.mov` 等视频文件
- **THEN** Toast 提示：`"不支持视频文件 📎\n💡 可以截取视频帧后作为图片发送"`，显示 4 秒

#### Scenario: 超大文件附带建议
- **WHEN** 用户选择 8MB 的图片文件
- **THEN** Toast 提示：`"screenshot.jpg（8.3MB）超过 5MB 限制\n💡 可用截图工具裁剪后重试"`，显示 4 秒
