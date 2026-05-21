## ADDED Requirements

### Requirement: WeChat ClawBot channel 通过二维码启动登录流程
WeChat ClawBot channel 实现 SHALL 通过调用 ilink API `GET ilink/bot/get_bot_qrcode?bot_type={bot_type}` 获取二维码，并返回二维码图片 URL 和 session_key 供客户端展示。`session_key` 为 Gateway 进程内生成的 UUID，存入内存 dict（TTL 10 分钟），用于后续 `qr_login_wait` 关联。

#### Scenario: 成功获取二维码
- **WHEN** 调用 `WechatQrLoginFlow.start(base_url, bot_type="3")`
- **THEN** 返回 `{ "qr_data_url": "<图片URL或base64>", "session_key": "<uuid>", "message": "ok" }`，session_key 已注册到内存 dict

#### Scenario: ilink API 返回错误
- **WHEN** ilink API 返回非 200 状态码或响应体不含 qrcode 字段
- **THEN** 返回 `{ "qr_data_url": null, "session_key": null, "message": "<错误描述>" }`

### Requirement: WeChat ClawBot channel 轮询等待扫码确认
`WechatQrLoginFlow.wait(session_key, base_url, timeout_ms=30000)` SHALL 通过单次轮询 ilink API `GET ilink/bot/get_qrcode_status`（单次超时 30 秒），返回三态状态：`pending`（未扫码）、`confirmed`（成功）、`expired`（已过期）。

#### Scenario: 用户已确认扫码
- **WHEN** 调用 `wait(session_key, ...)` 且 ilink 返回 `status: "confirmed"`
- **THEN** 返回 `{ "status": "confirmed", "bot_token": "<token>", "account_id": "<normalized_id>", "base_url": "..." }`（bot_token 仅内部使用，不透传给前端 API）

#### Scenario: 单次等待超时（pending）
- **WHEN** 30 秒内 ilink 未返回扫码结果
- **THEN** 返回 `{ "status": "pending", "message": "waiting" }`，前端可继续轮询

#### Scenario: 二维码已过期
- **WHEN** ilink 返回 `status: "expired"` 或 `session_key` 在内存中已 TTL 超期
- **THEN** 返回 `{ "status": "expired", "message": "QR code expired, please regenerate" }`，内存中移除该 session_key

#### Scenario: session_key 不存在
- **WHEN** 传入的 session_key 不在内存 dict 中（进程重启或已清理）
- **THEN** 返回 `{ "status": "expired", "message": "session not found" }`

### Requirement: WeChat ClawBot channel 保存账号凭据和运营配置
登录成功后，channel SHALL 写入两个独立的 JSON 文件：
- `auth.json`（仅登录时写，Unix 权限 600）：bot_token、base_url、user_id、account_id、created_at
- `config.json`（可通过 API/UI 后续编辑）：默认值 display_name、cwd=""、model=""、system_prompt=""、max_turns=10、bot_type="3"、accept_file_types=["image","voice","file"]、enabled=true

#### Scenario: 登录成功后凭据持久化（两文件）
- **WHEN** `WechatQrLoginFlow.wait()` 返回 `status: "confirmed"`
- **THEN** `{config_dir}/channels/wechat_clawbot/{account_id}/auth.json` 写入 token/base_url/user_id，`config.json` 写入默认运营配置

#### Scenario: 已有 config.json 时重新登录不覆盖
- **WHEN** 同一 account_id 重新扫码登录（token 续期）
- **THEN** 仅更新 `auth.json`，`config.json` 中的用户自定义配置保持不变

#### Scenario: 已连接账号 token 续期后重连
- **WHEN** 新 token 写入 auth.json 后，ChannelManager 中该账号已有 `connected` 实例
- **THEN** ChannelManager 先调用旧实例的 `disconnect()`，再用新 auth 调用 `connect()`，状态重新变为 `connected`

### Requirement: WeChat ClawBot channel 通过 long-poll 接收入站消息
channel 连接后，SHALL 在后台 asyncio task 中持续通过 ilink long-poll API 接收入站消息，并将每条消息路由到 `ChannelManager.on_inbound_message()` 回调。

#### Scenario: 接收入站文本消息
- **WHEN** ilink long-poll 返回新的用户消息，`message_type=USER`（type=1），`item_list[0].type=TEXT`（1）
- **THEN** `on_inbound_message(channel_type, account_id, sender_id, text=<消息文本>, attachments=[])` 被调用一次

#### Scenario: 接收入站图片消息
- **WHEN** ilink long-poll 返回 `item_list[0].type=IMAGE`（2），且 config 中 accept_file_types 包含 `"image"`
- **THEN** 调用 `media.download_and_decrypt(image_item.media, image_item.aeskey, tmp_dir)`；成功后 `on_inbound_message()` 被调用，`attachments=[{"type":"image","path":"<tmp_path>","mime":"image/jpeg"}]`，`text="[图片]"`

#### Scenario: 接收图片但 accept_file_types 不含 image
- **WHEN** ilink long-poll 返回图片消息，config 中 accept_file_types 不含 `"image"`
- **THEN** `on_inbound_message()` 被调用，`text="[图片消息（已跳过）]"`，`attachments=[]`

#### Scenario: 接收图片下载/解密失败
- **WHEN** CDN 下载返回非 200 或 AES 解密抛出异常
- **THEN** `on_inbound_message()` 被调用，`text="[图片，下载失败]"`，`attachments=[]`，日志记录 WARNING

#### Scenario: 接收语音消息（有转写文字）
- **WHEN** ilink long-poll 返回 `item_list[0].type=VOICE`（3），`item_list[0].voice_item.text` 非空
- **THEN** `on_inbound_message()` 被调用，`text="[语音转写] {voice_item.text}"`，`attachments=[]`（不下载音频）

#### Scenario: 接收语音消息（无转写文字）
- **WHEN** ilink long-poll 返回 VOICE 消息，`voice_item.text` 为空或缺失
- **THEN** `on_inbound_message()` 被调用，`text="[语音消息，时长 {playtime}ms]"`，`attachments=[]`

#### Scenario: 接收文件消息（文件大小 ≤ 20MB）
- **WHEN** ilink long-poll 返回 `item_list[0].type=FILE`（4），`file_item.len` ≤ 20MB，accept_file_types 含 `"file"`
- **THEN** 流式下载并 AES 解密，超出 20MB 硬中断；MIME 校验通过后保存到 tmp 目录；`on_inbound_message()` 被调用，`text="[文件: {file_name}]"`，`attachments=[{"type":"file","path":"<tmp_path>","name":"{file_name}"}]`

#### Scenario: 接收文件消息（文件大小 > 20MB）
- **WHEN** `file_item.len` 超过 20MB
- **THEN** 不下载；`on_inbound_message()` 被调用，`text="[文件: {file_name}，{size}MB，超出处理限制]"`，`attachments=[]`

#### Scenario: 接收视频消息
- **WHEN** ilink long-poll 返回 `item_list[0].type=VIDEO`（5）
- **THEN** 不下载视频；`on_inbound_message()` 被调用，`text="[视频消息，时长 {play_length}s，大小 {size}MB]"`，`attachments=[]`

#### Scenario: long-poll 超时后继续轮询
- **WHEN** long-poll 请求超过 35 秒无新消息（ilink 服务端关闭连接）
- **THEN** channel 立即发起新的 long-poll 请求，不记录错误日志

#### Scenario: long-poll 收到 errcode=-14（token 失效）
- **WHEN** ilink long-poll 响应中 `errcode=-14`
- **THEN** 停止轮询，ChannelManager 将该账号状态设为 `error`，日志记录 ERROR "token expired for account_id={id}"

#### Scenario: long-poll 网络错误（最多重试 3 次）
- **WHEN** long-poll 发生网络异常（连接拒绝、5xx 等）
- **THEN** 按 1s/2s/4s 指数退避重试，超过 3 次后设状态为 `error` 并停止轮询

#### Scenario: 连接断开时停止轮询
- **WHEN** 调用 `WechatClawbotChannel.disconnect()`
- **THEN** 后台 long-poll task 被取消，轮询停止

### Requirement: WeChat ClawBot channel 发送文本消息回微信用户
channel SHALL 实现 `send_message(to: str, text: str) -> None`，通过 ilink API 向指定用户发送文本消息（`to` = ilink sender user_id）。消息超过 1800 字时 SHALL 自动拆分为多条发送。

#### Scenario: 成功发送消息
- **WHEN** 调用 `send_message(to="<user_id>", text="Hello")` 且 bot token 有效
- **THEN** ilink API 发送成功，不抛出异常

#### Scenario: 消息超过 1800 字自动拆分
- **WHEN** `text` 长度超过 1800 字
- **THEN** 按换行符就近拆分为多条，依序发送，每条 ≤ 1800 字

#### Scenario: bot token 无效
- **WHEN** 调用 `send_message()` 但 ilink API 返回 `ret != 0` 或认证失败
- **THEN** 抛出 `ChannelAuthError`，日志记录 ERROR

### Requirement: 入站消息触发 HLAgent 会话
`ChannelManager.on_inbound_message()` SHALL 从 channel 的 `config.json` 读取 `cwd`（必须为已存在的绝对目录，fallback 到 gateway cwd）、`model`、`system_prompt`、`max_turns` 参数创建 Agent 会话；附件文件路径随会话传入；Agent 完成后删除临时附件文件并调用 `send_message()` 将最终文本回复发回用户。

#### Scenario: 入站文本消息创建 Agent 会话并回复
- **WHEN** 收到来自 sender_id 的文本消息 "hello"
- **THEN** 新建 Agent 会话，`cwd`/`model` 来自 config.json；Agent 完成后通过 `send_message(to=sender_id, ...)` 发回

#### Scenario: 入站消息含图片附件时传入会话
- **WHEN** 收到含 1 张图片附件的消息
- **THEN** 附件路径传入 Agent 会话（作为 vision attachment）；Agent 完成后删除临时文件

#### Scenario: 同一 account_id 已有进行中的会话（回复用户）
- **WHEN** 前一条消息的 Agent 会话尚未完成，又收到新消息
- **THEN** 通过 `send_message()` 回复"正在处理上一条消息，请稍候"，日志记录 INFO

#### Scenario: config.cwd 无效时 fallback
- **WHEN** config.cwd 为空字符串或路径不存在
- **THEN** 使用 gateway 当前 cwd，日志记录 DEBUG "using gateway cwd as fallback"
