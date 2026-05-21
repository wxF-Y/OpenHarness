## 1. Channel 抽象层基础设施

- [ ] 1.1 创建 `src/openharness/channels/__init__.py`，导出 `ChannelBase`、`ChannelStatus`、`CHANNEL_TYPES`、`ChannelStorage`、`ChannelManager`
- [ ] 1.2 在 `src/openharness/channels/base.py` 定义 `ChannelStatus` 枚举（connected / disconnected / error / connecting）和 `ChannelBase` ABC，声明 `connect(auth, config)`、`disconnect`、`send_message`、`get_status` 抽象方法（均为 `async def`）
- [ ] 1.3 在 `src/openharness/channels/types.py` 实现 `CHANNEL_TYPES` 类型注册表（`dict[str, type[ChannelBase]]`，提供 `register()` / `get()` 方法）
- [ ] 1.4 在 `src/openharness/channels/storage.py` 实现 `ChannelStorage`：双文件持久化（`{account_id}/auth.json` + `{account_id}/config.json`），实现 `save_auth`、`save_config`（merge 语义，不覆盖已有 config）、`load_auth`、`load_config`、`list_accounts(channel_type?)` 方法；account_id 格式校验 `[a-zA-Z0-9_-]{1,64}`
- [ ] 1.5 在 `src/openharness/channels/manager.py` 实现 `ChannelManager`：内存状态跟踪（per-account asyncio Lock）、`startup()` / `shutdown()` 生命周期方法；`startup()` 从 `ChannelStorage.list_accounts()` 枚举，跳过未知 channel 类型；`on_inbound_message(channel_type, account_id, sender_id, text, attachments)` 回调：从 config.json 读取 cwd/model/system_prompt/max_turns，cwd 无效时 fallback 到 gateway cwd；会话结束后删除临时附件文件；并发时向用户回复"请稍候"

## 2. WeChat ClawBot Channel 实现

- [ ] 2.1 创建 `src/openharness/channels/wechat_clawbot/__init__.py`，向 `CHANNEL_TYPES` 注册 `"wechat_clawbot"` → `WechatClawbotChannel`
- [ ] 2.2 在 `src/openharness/channels/wechat_clawbot/ilink_api.py` 封装 ilink HTTP API 调用：`fetch_qrcode(base_url, bot_type)`、`poll_qr_status(base_url, session_key, timeout_ms=30000)`（返回三态 pending/confirmed/expired）、`send_text_message(base_url, token, to, text)`（含 1800 字拆分）、`long_poll_messages(base_url, token)` — 使用 httpx，含正确请求头（`AuthorizationType: ilink_bot_token`, `X-WECHAT-UIN: base64(random_uint32_decimal)`）
- [ ] 2.3 在 `src/openharness/channels/wechat_clawbot/qr_flow.py` 实现 `WechatQrLoginFlow`：`start(base_url, bot_type)` 生成 session_key 存入 in-memory dict（TTL 10min）；`wait(session_key, base_url, timeout_ms)` 返回三态；成功后调用 `ChannelStorage.save_auth()` + `save_config()`（已有 config.json 则不覆盖）
- [ ] 2.4 在 `src/openharness/channels/wechat_clawbot/media.py` 实现 CDN 媒体下载和 AES-128-ECB 解密：`download_and_decrypt(cdn_ref, aeskey_hex, dest_dir, max_bytes=20*1024*1024) -> Path | None`；流式下载超出 max_bytes 立即中断；解密后用 `python-magic` 校验 MIME 白名单（image/*, audio/*, application/*, text/*），不合规返回 None；依赖 `cryptography` + `python-magic` 包
- [ ] 2.5 在`src/openharness/channels/wechat_clawbot/message_handler.py` 实现多类型消息分发：根据 `item_list[i].type`（1-5）路由，返回 `(text: str, attachments: list[dict])`；根据 accept_file_types 白名单控制下载；ilink errcode=-14 → 抛出 `ChannelTokenExpiredError`；网络错误 → 指数退避重试（1s/2s/4s，超 3 次抛出 `ChannelNetworkError`）
- [ ] 2.6 在 `src/openharness/channels/wechat_clawbot/channel.py` 实现 `WechatClawbotChannel(ChannelBase)`：`connect(auth, config)` 启动 long-poll 后台 task 立即 return，`disconnect()` 取消 task 并清理，`send_message()` 调用 ilink API；接收 `ChannelTokenExpiredError` 时将 ChannelManager 状态设为 error 并停止轮询

## 3. Gateway Channel REST API

- [ ] 3.1 创建 `HLAgent/gateway/routers/channels.py`，实现以下端点：
  - `GET /api/channels/types` → 返回注册的 channel 类型列表
  - `GET /api/channels` → 返回已配置的 channel 实例和状态（含 display_name）
  - `POST /api/channels/wechat/qr/start` → body `{base_url?, bot_type?}`，调用 `WechatQrLoginFlow.start()`
  - `POST /api/channels/wechat/qr/wait` → body `{session_key, timeout_ms?}`，返回三态（status: pending/confirmed/expired），不透传 bot_token；404 for unknown session_key
  - `POST /api/channels/wechat/manual` → 校验 account_id 格式（422）、重复（409），保存 auth/config，连接
  - `GET /api/channels/{channel_type}/{account_id}/config` → 404 for unknown type
  - `PATCH /api/channels/{channel_type}/{account_id}/config` → 可写字段白名单；cwd 路径校验；禁止认证字段（422）；返回更新后完整 config
  - `DELETE /api/channels/{channel_type}/{account_id}` → disconnect + 删除目录（含 tmp/）；会话中的 disconnect 异常被捕获不阻断删除
- [ ] 3.2 在 `HLAgent/gateway/main.py` 中导入并注册 `channels` router（prefix `/api/channels`）
- [ ] 3.3 在 `HLAgent/gateway/main.py` lifespan startup 中初始化 `ChannelManager` 并调用 `startup()`，lifespan shutdown 中调用 `shutdown()`；在 `routers/channels.py` 中通过 app.state 或模块全局访问 ChannelManager 单例

## 4. Web UI Channel 管理页面

- [ ] 4.1 在 `HLAgent/web/src/pages/ChannelsPage.tsx` 实现 Channels 列表页：调用 `GET /api/channels` 展示实例列表（display_name/account_id + 状态指示器 + "配置"/"删除"按钮）；error 状态显示"重新登录"入口；空状态显示"添加 Channel"
- [ ] 4.2 在 `HLAgent/web/src/components/QrLoginFlow.tsx` 实现三态二维码接入组件：`showing`（展示 QR + 3 秒轮询 `qr/wait`）、`confirmed`（成功）、`expired`（超期）；前端累计 5 分钟强制切换 expired；重新生成按钮重置状态
- [ ] 4.3 在 `HLAgent/web/src/components/ManualConfigForm.tsx` 实现手动配置表单：bot_token（必填）、base_url（选填）、account_id（选填）字段；客户端空值校验；处理 409 重复错误提示
- [ ] 4.4 在 `HLAgent/web/src/pages/ChannelsPage.tsx` 中集成 QR 和 Manual 两种接入方式的切换 UI（Tab 或步骤向导）
- [ ] 4.5 在 `HLAgent/web/src/components/ChannelConfigPanel.tsx` 实现运营配置编辑面板：调用 `GET .../config` 预填充；提交 `PATCH .../config`；字段：display_name、cwd（路径输入，服务端 422 显示错误）、model（下拉）、system_prompt（textarea）、max_turns（数字）、accept_file_types（多选 checkbox: image/voice/file）、enabled（toggle）；返回更新后完整 config 刷新面板
- [ ] 4.6 在 `HLAgent/web/src/components/Sidebar.tsx` 中添加 Channels 导航项

## 5. 测试

- [ ] 5.1 为 `ChannelStorage` 编写单元测试（`tests/test_channels/test_storage.py`）：save_auth / save_config（merge 语义，不覆盖已有 config）/ load_auth / load_config / list_accounts / account_id 格式校验
- [ ] 5.2 为 `CHANNEL_TYPES` 和 `ChannelBase` ABC 编写单元测试：注册/检索/未实现抽象方法
- [ ] 5.3 为 `WechatQrLoginFlow` 编写单元测试（mock httpx）：三态返回、session_key TTL、重复登录不覆盖 config.json
- [ ] 5.4 为 `message_handler.py` 编写单元测试：TEXT/IMAGE/VOICE（有/无转写）/FILE（大小边界）/VIDEO、accept_file_types 白名单过滤、errcode=-14 抛出 ChannelTokenExpiredError、网络错误重试
- [ ] 5.5 为 `media.py` 编写单元测试（mock httpx + 真实 AES-128-ECB 解密）：正常下载解密、超 20MB 中断、MIME 校验失败、下载失败返回 None
- [ ] 5.6 为 Gateway 端点编写集成测试（mock ChannelManager / ChannelStorage）：`qr/wait` 三态、PATCH 白名单（含认证字段拒绝 + cwd 校验）、manual 409 重复、DELETE 清理流程、未知 channel_type 返回 404
