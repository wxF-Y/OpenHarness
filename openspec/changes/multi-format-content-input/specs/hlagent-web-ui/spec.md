## ADDED Requirements

### Requirement: MessageInput 新增附件预览条子组件
HLAgent Web UI 的 `MessageInput` 组件 SHALL 拆分出 `AttachmentStrip` 子组件，在 textarea 上方、输入区内部渲染，当附件列表为空时高度为 0（`overflow: hidden`），有附件时以 `200ms ease` 展开动画出现。

#### Scenario: AttachmentStrip 出现动画
- **WHEN** 第一个附件被加入列表
- **THEN** `AttachmentStrip` 从 `height: 0` 以 `200ms ease` 过渡到 `height: 88px`（含 padding）

#### Scenario: AttachmentStrip 消失动画
- **WHEN** 最后一个附件被移除或消息发送后
- **THEN** `AttachmentStrip` 以 `160ms ease` 收起回 `height: 0`

### Requirement: 图片附件卡片（ImageChip）完整规格
`ImageChip` 组件 SHALL 渲染图片附件的可交互预览卡片，遵循 Catppuccin Mocha 设计语言。

#### Scenario: ImageChip 正常态
- **WHEN** 图片附件卡片正常展示
- **THEN** 渲染 `64×64px` 容器（`position: relative; border-radius: 6px; overflow: hidden; border: 2px solid #313244`），内部 `<img>` 填满（`width: 100%; height: 100%; object-fit: cover`）；右上角移除按钮（`position: absolute; top: 3px; right: 3px; width: 18px; height: 18px; border-radius: 50%; background: rgba(17,17,27,0.75); color: #a6adc8; font-size: 0.65rem; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none`）

#### Scenario: ImageChip 悬停态
- **WHEN** 鼠标悬停在图片卡片上
- **THEN** 边框颜色变为 `#89b4fa`，移除按钮背景变为 `rgba(243,139,168,0.9)`（红色半透明），按钮颜色变为 `#1e1e2e`，过渡 `150ms ease`

### Requirement: 文档附件卡片（DocumentChip）完整规格
`DocumentChip` 组件 SHALL 渲染文档类附件的预览卡片。

#### Scenario: DocumentChip 正常态
- **WHEN** 文档附件卡片正常展示
- **THEN** 渲染 `min-width: 160px; max-width: 200px; height: 44px; border-radius: 6px; background: #11111b; border: 1px solid #313244; display: flex; align-items: center; gap: 8px; padding: 0 8px; position: relative`；左侧 `20px` 宽色彩徽章（`border-radius: 3px; font-size: 0.65rem; font-weight: 700; display: flex; align-items: center; justify-content: center`）显示类型简称（PDF/DOC/XLS/CSV/JSON）及其对应颜色（见文档提取 spec）；中间两行：文件名（`0.75rem; color: #cdd6f4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px`）+ 大小（`0.65rem; color: #6c7086`）；右侧移除按钮（`16×16px; color: #585b70; hover: #f38ba8; cursor: pointer`）

### Requirement: 拖拽投放遮罩（DropOverlay）完整规格
`DropOverlay` 组件 SHALL 在聊天容器内以 `position: absolute; inset: 0; z-index: 50` 覆盖，在文件拖入时显示。

#### Scenario: DropOverlay 完整视觉
- **WHEN** `isDragOver = true`
- **THEN** 渲染：背景 `rgba(30,30,46,0.88)`（`--ctp-base` 88% 不透明度）；中央垂直居中区域含 `96×96px` 虚线圆（`border: 3px dashed #89b4fa; border-radius: 50%; display: flex; align-items: center; justify-content: center`）内置 `📎` 图标（`2.5rem`）；圆下方 `16px` 处主文字"释放以添加附件"（`1rem; color: #89b4fa; font-weight: 600`）；下方 `8px` 处副文字"图片 · PDF · Word · Excel · CSV · JSON"（`0.75rem; color: #6c7086`）；整体出现/消失动画 `120ms ease opacity`

### Requirement: Toast 通知系统
附件操作的反馈 Toast SHALL 在聊天区右上角叠加，多个 Toast 垂直堆叠（间距 `8px`），最多同时显示 3 条。

#### Scenario: Toast 完整视觉
- **WHEN** 显示 Toast 通知
- **THEN** Toast 渲染 `position: fixed; top: 16px; right: 16px; z-index: 200; min-width: 240px; max-width: 360px; padding: 10px 14px; border-radius: 8px; font-size: 0.8125rem; font-weight: 500; box-shadow: 0 4px 16px rgba(0,0,0,0.4); display: flex; align-items: center; gap: 8px`；成功态：背景 `#a6e3a1`，文字 `#1e1e2e`；错误态：背景 `#f38ba8`，文字 `#1e1e2e`；信息态：背景 `#89b4fa`，文字 `#1e1e2e`；出现动画 `200ms ease slide-in-right + opacity`，消失动画 `150ms ease`

### Requirement: Lightbox 图片查看器组件（ImageLightbox）完整规格
`ImageLightbox` SHALL 为独立的 Portal 组件，挂载到 `document.body`，遮罩全屏覆盖。

#### Scenario: ImageLightbox 视觉与布局
- **WHEN** 用户点击任意图片缩略图，触发 Lightbox
- **THEN** Portal 渲染：遮罩 `position: fixed; inset: 0; z-index: 1000; background: rgba(17,17,27,0.92); display: flex; align-items: center; justify-content: center`（出现动画 `180ms ease opacity`）；图片 `max-width: 90vw; max-height: 85vh; border-radius: 8px; box-shadow: 0 8px 40px rgba(0,0,0,0.7); object-fit: contain; user-select: none`；顶部右侧 `32×32px` 关闭按钮（`background: #313244; border-radius: 6px; hover: #45475a`，`×` 图标 `#cdd6f4`）；底部 bar（`padding: 10px 16px; display: flex; align-items: center; justify-content: space-between`）：左侧文件名 `0.8rem; color: #a6adc8`，右侧`"↓ 下载"` 按钮（`color: #89b4fa; font-size: 0.8125rem; cursor: pointer; background: none; border: none`）

#### Scenario: ImageLightbox 多图导航控件
- **WHEN** 同组图片数量 ≥ 2
- **THEN** 左右各有导航箭头（`40×64px; background: transparent; border: none; color: #a6adc8; font-size: 1.5rem; cursor: pointer; hover background: rgba(137,180,250,0.12); border-radius: 6px; transition: 150ms`）；底部中央页码 dots（每个 `8×8px` 圆点，当前页 `background: #89b4fa`，其余 `background: #45475a`，间距 `6px`）；键盘 `←/→` 切换，`Esc` 关闭

### Requirement: ToolCallCard 图片网格区域视觉规格
当 `resultItem.media` 非空时，`ToolCallCard` 的图片展示区 SHALL 替代原有文本 pre 块。

#### Scenario: 图片网格布局
- **WHEN** `resultItem.media` 含图片
- **THEN** 渲染 `div`（`padding: 8px 12px 10px; display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start`）；每张图片：`max-width: 220px; max-height: 160px; border-radius: 6px; object-fit: cover; cursor: pointer; border: 1px solid #313244; transition: opacity 150ms; hover opacity: 0.85`

#### Scenario: 图片网格下方路径显示
- **WHEN** 图片有 `source_path` 元数据
- **THEN** 网格下方显示路径文字（`padding: 0 12px 8px; font-size: 0.7rem; color: #6c7086; font-family: monospace`）：`"📁 已保存至 <path>"`；多张图片只显示目录路径（去掉文件名部分）

#### Scenario: 超过 3 张图片折叠显示
- **WHEN** `resultItem.media` 含 4 张以上图片
- **THEN** 前 3 张正常显示，第 4 张容器渲染为半透明黑色遮罩（`background: rgba(17,17,27,0.7); border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #cdd6f4; font-size: 1.25rem; font-weight: 700`），内容为 `+N`（N = 剩余张数）；点击后展开显示全部，展开按钮文字变为 `"▲ 收起"`
