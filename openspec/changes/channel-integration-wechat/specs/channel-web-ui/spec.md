## ADDED Requirements

### Requirement: Web UI Sidebar 包含 Channels 导航入口
Web UI 侧边栏 SHALL 包含 "Channels" 导航项，点击后跳转到 Channels 管理页面。

#### Scenario: Channels 导航入口可见
- **WHEN** 用户访问 HLAgent Web UI 任意页面
- **THEN** 侧边栏中显示 "Channels" 导航项

### Requirement: Channels 页面展示已连接 channel 列表
Channels 页面 SHALL 调用 `GET /api/channels` 展示所有已配置的 channel 实例，每项显示 display_name（或 account_id）、连接状态（绿色/红色/黄色指示器）和操作按钮（配置、删除）。

#### Scenario: 展示已配置的 channel 列表
- **WHEN** 用户导航到 Channels 页面，已有 1 个 wechat_clawbot 账号，状态 connected
- **THEN** 页面列出该账号，绿色状态指示器，显示 display_name，有"配置"和"删除"按钮

#### Scenario: 展示 error 状态的 channel
- **WHEN** 某 channel 账号状态为 `error`（如 token 失效）
- **THEN** 状态指示器为红色，旁边显示"重新登录"按钮

#### Scenario: 无已配置 channel 时展示空状态
- **WHEN** 用户导航到 Channels 页面，无任何已配置 channel
- **THEN** 页面显示空状态提示"尚未连接任何 Channel"和"添加 Channel"按钮

### Requirement: Web UI 支持通过二维码扫码添加 WeChat ClawBot（三态状态机）
用户点击"添加 Channel → 微信 ClawBot → 二维码扫码"后，Web UI SHALL 管理以下三态：
- **showing**：展示二维码，每 3 秒轮询一次 `qr/wait`（timeout_ms=30000）
- **confirmed**：扫码成功，提示并刷新
- **expired**：超时或过期，提示重新生成

前端 SHALL 维护一个累计计时器，从第一次 `qr/start` 开始计时，5 分钟后强制切换到 `expired` 状态（不依赖后端判断）。

#### Scenario: 展示二维码
- **WHEN** 用户选择"二维码扫码"接入方式，`qr/start` 返回 `qr_data_url`
- **THEN** 页面显示由 `qr_data_url` 渲染的二维码图片和"等待扫码中..."状态提示，累计计时器启动

#### Scenario: 轮询返回 pending（继续等待）
- **WHEN** `qr/wait` 返回 `{ "status": "pending" }`
- **THEN** 页面保持二维码展示，3 秒后发起下一次轮询

#### Scenario: 扫码成功后页面更新
- **WHEN** `qr/wait` 返回 `{ "status": "confirmed", "account_id": "..." }`
- **THEN** 页面隐藏二维码，显示"✅ 连接成功"，3 秒后跳转回 channel 列表页并刷新

#### Scenario: 二维码过期（后端返回或前端超时）
- **WHEN** `qr/wait` 返回 `{ "status": "expired" }` 或前端累计计时超过 5 分钟
- **THEN** 页面停止轮询，显示"二维码已过期"提示和"重新生成二维码"按钮；点击后重新调用 `qr/start`，重置计时器

### Requirement: Web UI 支持通过手动填写配置添加 WeChat ClawBot
用户选择"手动配置"接入方式后，Web UI SHALL 展示包含 bot_token（必填）、base_url（选填）、account_id（选填）字段的表单，提交后调用 `POST /api/channels/wechat/manual`。

#### Scenario: 成功提交手动配置表单
- **WHEN** 用户填写有效 bot_token 并点击"保存"
- **THEN** 调用 `POST /api/channels/wechat/manual`，成功后显示"连接成功"并刷新列表

#### Scenario: bot_token 为空时表单校验
- **WHEN** 用户点击"保存"但 bot_token 输入框为空
- **THEN** 显示内联错误"Bot Token 不能为空"，不发送 API 请求

#### Scenario: 服务端返回 409（account_id 重复）
- **WHEN** 服务端返回 HTTP 409
- **THEN** 显示内联错误"该账号 ID 已存在，如需更新 Token 请使用重新登录功能"

### Requirement: Web UI 支持编辑 channel 运营配置
用户点击 channel 列表项的"配置"按钮后，Web UI SHALL 展示配置编辑面板，调用 `GET .../config` 加载当前配置，并通过 `PATCH .../config` 保存变更。

#### Scenario: 打开配置面板
- **WHEN** 用户点击"配置"按钮
- **THEN** 展示包含以下字段的表单（当前值预填充）：display_name（文本）、cwd（路径输入）、model（下拉）、system_prompt（textarea）、max_turns（数字）、accept_file_types（多选 checkbox: image/voice/file）、enabled（toggle）

#### Scenario: 保存配置成功
- **WHEN** 用户修改字段后点击"保存"，PATCH 返回 HTTP 200
- **THEN** 显示"保存成功"提示，关闭面板

#### Scenario: cwd 路径校验失败（服务端）
- **WHEN** 用户填写不存在的 cwd 路径，服务端返回 HTTP 422
- **THEN** 在 cwd 字段旁显示"路径不存在或无效"错误提示

### Requirement: Web UI 支持断开并删除 channel 账号
channel 列表中每个账号项 SHALL 包含"删除"操作，点击后展示确认对话框，确认后调用 `DELETE /api/channels/{channel_type}/{account_id}`。

#### Scenario: 用户确认删除
- **WHEN** 用户点击账号项的"删除"按钮并在确认弹框中点击"确认"
- **THEN** 调用 DELETE 端点，成功后从列表中移除该账号

#### Scenario: 用户取消删除
- **WHEN** 用户点击"删除"后在弹框中点击"取消"
- **THEN** 不发送 API 请求，列表保持不变
