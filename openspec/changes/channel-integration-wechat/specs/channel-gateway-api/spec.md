## ADDED Requirements

### Requirement: Gateway 提供获取可用 channel 类型列表端点
Gateway SHALL 提供 `GET /api/channels/types` 端点，返回系统中已注册的所有 channel 类型及其元信息。

#### Scenario: 获取 channel 类型列表
- **WHEN** 客户端发送 `GET /api/channels/types`
- **THEN** 返回 HTTP 200，body 含 `[{ "type": "wechat_clawbot", "display_name": "微信 ClawBot", "auth_methods": ["qr", "manual"] }]`

### Requirement: Gateway 提供获取已配置 channel 实例列表端点
Gateway SHALL 提供 `GET /api/channels` 端点，返回所有已配置的 channel 实例及其实时连接状态。

#### Scenario: 返回已配置 channel 列表
- **WHEN** 客户端发送 `GET /api/channels`，已配置 1 个 wechat_clawbot 账号
- **THEN** 返回 HTTP 200，body 含 `[{ "channel_type": "wechat_clawbot", "account_id": "...", "status": "connected", "last_connected_at": "...", "display_name": "..." }]`

#### Scenario: 无已配置 channel
- **WHEN** 客户端发送 `GET /api/channels`，无任何已配置 channel
- **THEN** 返回 HTTP 200，body 为 `[]`

### Requirement: Gateway 提供二维码登录启动端点
Gateway SHALL 提供 `POST /api/channels/wechat/qr/start` 端点，启动 ilink 二维码登录流程，返回二维码图片和 session_key。

#### Scenario: 成功启动二维码登录
- **WHEN** 客户端发送 `POST /api/channels/wechat/qr/start`，body `{ "base_url": "https://...", "bot_type": "3" }`（均可选）
- **THEN** 返回 HTTP 200，body 含 `{ "qr_data_url": "<URL>", "session_key": "<uuid>", "message": "ok" }`

#### Scenario: ilink 服务不可达
- **WHEN** `POST /api/channels/wechat/qr/start`，ilink 服务超时或连接拒绝
- **THEN** 返回 HTTP 502，body 含 `{ "detail": "无法连接到 ilink 服务: ..." }`

### Requirement: Gateway 提供二维码登录轮询端点（三态响应）
Gateway SHALL 提供 `POST /api/channels/wechat/qr/wait` 端点，单次轮询扫码状态，返回三态：`pending`、`confirmed`、`expired`。**出于安全考虑，`bot_token` 不返回给前端。**

#### Scenario: 扫码已确认
- **WHEN** 客户端发送 `POST /api/channels/wechat/qr/wait`，body `{ "session_key": "<uuid>", "timeout_ms": 30000 }`，用户已扫码确认
- **THEN** 返回 HTTP 200，body 含 `{ "status": "confirmed", "account_id": "..." }`（不含 bot_token）；Gateway 内部已保存 auth.json 和默认 config.json

#### Scenario: 单次等待超时（前端继续轮询）
- **WHEN** 30 秒内无扫码动作
- **THEN** 返回 HTTP 200，body 含 `{ "status": "pending", "message": "waiting" }`

#### Scenario: 二维码已过期
- **WHEN** ilink 返回 expired 或 session_key TTL 超期
- **THEN** 返回 HTTP 200，body 含 `{ "status": "expired", "message": "QR code expired, please regenerate" }`

#### Scenario: session_key 不存在
- **WHEN** 传入的 session_key 不在内存 dict 中
- **THEN** 返回 HTTP 404，body 含 `{ "detail": "session not found or expired" }`

### Requirement: Gateway 提供手动配置接入端点
Gateway SHALL 提供 `POST /api/channels/wechat/manual` 端点，支持通过直接填写 bot_token 和 base_url 的方式添加 WeChat ClawBot 账号。

#### Scenario: 成功通过手动配置添加账号
- **WHEN** 客户端发送 `POST /api/channels/wechat/manual`，body `{ "bot_token": "...", "base_url": "https://...", "account_id": "my-bot" }`
- **THEN** 返回 HTTP 201，`auth.json` 被保存，`config.json` 以默认值初始化，channel 连接被建立，body 含 `{ "account_id": "my-bot", "status": "connected" }`

#### Scenario: bot_token 缺失
- **WHEN** `POST /api/channels/wechat/manual` body 中缺少 bot_token
- **THEN** 返回 HTTP 422，body 含字段验证错误描述

#### Scenario: account_id 含非法字符
- **WHEN** `account_id` 包含 `/`、`..`、空格或不匹配 `[a-zA-Z0-9_-]{1,64}`
- **THEN** 返回 HTTP 422，body 含 `{ "detail": "account_id must match [a-zA-Z0-9_-]{1,64}" }`

#### Scenario: account_id 已存在（重复添加）
- **WHEN** 发送相同 account_id 的 manual 配置请求
- **THEN** 返回 HTTP 409，body 含 `{ "detail": "account_id already exists, use re-login to update token" }`

### Requirement: Gateway 提供查询单个 channel 账号配置端点
Gateway SHALL 提供 `GET /api/channels/{channel_type}/{account_id}/config` 端点，返回该账号的运营配置（不含 token 等认证字段）。

#### Scenario: 获取已配置账号的运营配置
- **WHEN** 客户端发送 `GET /api/channels/wechat_clawbot/my-bot/config`
- **THEN** 返回 HTTP 200，body 含 config.json 中的所有字段（display_name、cwd、model、accept_file_types 等），不含 token

#### Scenario: 账号不存在
- **WHEN** 客户端发送 `GET /api/channels/wechat_clawbot/nonexistent/config`
- **THEN** 返回 HTTP 404

### Requirement: Gateway 提供更新 channel 运营配置端点
Gateway SHALL 提供 `PATCH /api/channels/{channel_type}/{account_id}/config` 端点，允许部分更新 config.json 中的**可写字段白名单**：`display_name`、`cwd`（需路径校验）、`model`、`system_prompt`、`max_turns`、`bot_type`、`accept_file_types`、`enabled`。其他字段一律返回 422。

#### Scenario: 成功更新部分配置字段
- **WHEN** 客户端发送 `PATCH .../config`，body `{ "cwd": "/new/path", "model": "claude-opus-4-7" }`，`/new/path` 为已存在目录
- **THEN** 返回 HTTP 200，body 含更新后的完整 config.json 内容（merge 结果）

#### Scenario: cwd 路径无效
- **WHEN** `PATCH .../config`，body `{ "cwd": "/nonexistent/path" }`
- **THEN** 返回 HTTP 422，body 含 `{ "detail": "cwd must be an existing absolute directory without symlink escapes" }`

#### Scenario: 更新 accept_file_types
- **WHEN** 客户端发送 `PATCH .../config`，body `{ "accept_file_types": ["image", "file"] }`
- **THEN** 返回 HTTP 200，config.json 中 accept_file_types 更新为 `["image", "file"]`，voice 不再接受

#### Scenario: 不允许修改认证字段
- **WHEN** 客户端发送 `PATCH .../config`，body 中包含 `token`、`base_url`、`user_id` 或 `created_at`
- **THEN** 返回 HTTP 422，body 含 `{ "detail": "field '{field}' is not allowed via config endpoint" }`

#### Scenario: channel 类型未注册
- **WHEN** 客户端发送任意 `/api/channels/{channel_type}/...` 请求，`channel_type` 不在 `CHANNEL_TYPES` 中
- **THEN** 返回 HTTP 404，body 含 `{ "detail": "unknown channel type: {channel_type}" }`

### Requirement: Gateway 提供删除 channel 账号端点
Gateway SHALL 提供 `DELETE /api/channels/{channel_type}/{account_id}` 端点，断开连接、删除账号配置目录，并清理临时附件目录。

#### Scenario: 成功删除已配置的 channel 账号
- **WHEN** 客户端发送 `DELETE /api/channels/wechat_clawbot/my-bot`，该账号存在
- **THEN** 返回 HTTP 204；若该账号有运行中的 long-poll task，先调用 `disconnect()` 取消；账号目录（auth.json + config.json）和 tmp 目录被删除

#### Scenario: 删除时有进行中的 Agent 会话
- **WHEN** `DELETE` 请求时，该账号正在处理入站消息（Agent 会话运行中）
- **THEN** 仍然完成删除操作，Agent 会话自然结束后无法发送回复（捕获异常，日志 WARNING）

#### Scenario: 删除不存在的账号
- **WHEN** 客户端发送 `DELETE /api/channels/wechat_clawbot/nonexistent`
- **THEN** 返回 HTTP 404，body 含 `{ "detail": "Channel account not found" }`
