## Context

HLAgent 是一个基于 Python/FastAPI 的 Agent 网关，目前通过 Web UI 和 REST API 提供交互入口。项目已有完整的 session 管理、cron 调度和 swarm 协作基础设施。

参考：KuClaw 项目中已有成熟的 TypeScript WeChat ClawBot channel 实现（`kuclaw-main/channel-plugin/weixin/`），使用 ilink 平台 API，通过 `loginWithQrStart` / `loginWithQrWait` 两步完成二维码登录，再通过 long-poll 接收入站消息。

约束：
- HLAgent gateway 使用 Python（httpx 已有），不依赖 Node.js 运行时
- channel 功能必须完全可选（不影响未配置 channel 的现有功能）
- channel 账号凭据持久化到 `~/.hlagent/channels/`

## Goals / Non-Goals

**Goals:**
- 定义通用 `ChannelBase` 抽象，允许后续以插件方式接入更多 channel
- 实现 WeChat ClawBot channel（ilink API），支持二维码扫码登录并绑定账号
- Gateway 提供 `/api/channels/*` REST 端点，管理 channel 实例、连接状态和配置
- Web UI 新增 Channels 页面，支持二维码展示轮询和手动配置两种接入方式
- 入站消息触发新的 HLAgent 会话（或关联到已有会话）
- 接收并处理微信用户发送的多种文件类型（图片、语音、文件、视频），通过下载解密后传递给 Agent

**Non-Goals:**
- 不实现媒体文件**发送**（仅接收；出站仍为纯文本）
- 不实现多用户到同一 Bot 的会话隔离（第一版单 Bot 单会话）
- 不实现 Discord、飞书等其他 channel（本次只做 WeChat ClawBot）
- 不重构现有 session/cron 逻辑

## Decisions

### 决策 1：Python 原生实现 ilink API 调用，不复用 TS 代码

**选择**：在 `src/openharness/channels/wechat_clawbot/` 用 Python + httpx 直接调用 ilink HTTP API。

**理由**：HLAgent gateway 是纯 Python 进程，引入 Node.js 子进程会显著增加部署复杂度和启动延迟。ilink API 是标准 HTTP REST，Python 实现不复杂。

**替代方案**：通过 subprocess 调用已有 TS channel plugin → 拒绝，因进程间通信复杂、错误隔离差。

---

### 决策 2：ChannelBase 抽象使用 Python ABC；类型注册与配置存储命名分离

**选择**：
- `CHANNEL_TYPES: dict[str, type[ChannelBase]]` —— 内存中类型注册表（type string → class），在 `src/openharness/channels/types.py`
- `ChannelStorage` —— 账号配置持久化管理器（auth.json / config.json），在 `src/openharness/channels/storage.py`
- `ChannelBase(ABC)` —— 抽象基类，在 `src/openharness/channels/base.py`

**理由**：原方案 `CHANNEL_REGISTRY`（类型注册）和 `ChannelRegistry`（持久化）命名高度相似，实现时极易混淆。分开命名消除歧义。

**替代方案**：使用 Python entry_points 插件机制 → 拒绝，过度设计，部署更复杂。

---

### 决策 3：二维码登录采用两步 REST API（start + poll）；超时层次分明

**选择**：
- `POST /api/channels/wechat/qr/start` → 返回 `{ qr_data_url, session_key }`（base64 图片）
- `POST /api/channels/wechat/qr/wait` body `{ session_key, timeout_ms }` → 单次短轮询（`timeout_ms` 建议 30 秒），返回 `{ status: "pending"|"confirmed"|"expired" }`

**超时分层**：
| 层级 | 时长 | 控制方 |
|------|------|--------|
| 单次 wait API 超时 | 30 秒 | Gateway 向 ilink 发起 `get_qrcode_status` 的轮询 |
| 前端轮询间隔 | 3 秒 | 前端每 3 秒调一次 wait |
| 二维码总有效期 | 5 分钟 | 前端累计计时，超时显示"重新生成" |
| ilink 侧最大等待 | 8 分钟 | ilink 平台服务端，作为硬上限 |

**理由**：分层超时既保证用户扫码体验，又防止前端无限等待。单次 wait 30 秒足够 ilink 响应而不至于占用过长连接。

**替代方案**：WebSocket 推送扫码状态 → 拒绝，增加前端状态机复杂度，REST 轮询已足够。

---

### 决策 4：入站消息创建独立 Agent 会话

**选择**：WeChat 入站消息通过调用现有 `SessionManager.create_session()` 创建新会话，将消息作为 user 第一条消息投递；Bot 回复通过 ilink API 发送回微信。

**理由**：复用现有 session 生命周期和 streaming 逻辑，最小化新增代码。

**替代方案**：共享 session（追加消息到已有会话）→ 作为 v2 功能，第一版以简单为主。

---

### 决策 5：channel 配置持久化格式

**选择**：JSON 文件分两层存储：

**认证层**（`auth.json`）— 仅由登录流程写入，权限 600（Unix）/ 用户私有目录（Windows）：
```json
{
  "channel_type": "wechat_clawbot",
  "account_id": "hex-im-bot",
  "token": "...",
  "base_url": "https://...",
  "user_id": "...",
  "created_at": "2026-05-20T..."
}
```

**运营配置层**（`config.json`）— 可通过 API/UI 编辑，可写字段白名单：`display_name`、`cwd`、`model`、`system_prompt`、`max_turns`（默认 10）、`bot_type`（默认 "3"）、`accept_file_types`（默认 `["image","voice","file"]`，不含 video）、`enabled`（默认 true）：
```json
{
  "display_name": "我的微信Bot",
  "cwd": "/path/to/project",
  "model": "claude-sonnet-4-6",
  "system_prompt": "You are a helpful assistant.",
  "max_turns": 10,
  "bot_type": "3",
  "accept_file_types": ["image", "voice", "file"],
  "enabled": true
}
```

路径：`{config_dir}/channels/wechat_clawbot/{account_id}/auth.json` 和 `config.json`

**`account_id` 规则**：由 ilink 返回的 `ilink_bot_id`（如 `"hex@im.bot"`）规范化而来，规则：`re.sub(r'[^a-zA-Z0-9_-]', '-', raw_id).strip('-')[:64]`。手动配置未提供时同规则处理 base_url 域名部分。重复 account_id 返回 409。

**`cwd` 安全校验**：PATCH config 写 cwd 时，SHALL 验证：路径存在、是目录、是绝对路径、不含符号链接逃逸。非法路径返回 422。

**`session_key` 生命周期**：`qr/start` 生成 UUID 作 session_key，存入 Gateway 进程内存 dict，成功/超时/进程重启后失效，TTL = 10 分钟。

**理由**：认证与运营配置职责分离；file_types 白名单防止意外处理不期望的文件类型；video 默认不含（体积大、只传描述）。

---

### 决策 6：入站多文件类型处理

**选择**：根据 ilink `MessageItem.type`（整数枚举）分类处理：

| type 值 | 类型 | 处理方式 | 传给 Agent |
|---------|------|---------|-----------|
| 1 | TEXT | 直接使用 | 文本内容 |
| 2 | IMAGE | CDN 下载 + AES-128-ECB 解密，存受限临时目录 | `attachments=[{"type":"image","path":"...","mime":"image/jpeg"}]`，text="[图片]" |
| 3 | VOICE | 优先使用 `item_list[i].voice_item.text`（ilink 已转文字） | 转写文字；无则 `[语音消息，时长{playtime}ms]` |
| 4 | FILE | CDN 下载 + AES 解密，≤20MB；校验 MIME 白名单后存受限临时目录 | `attachments=[{"type":"file","path":"...","name":"..."}]`，text="[文件: {name}]" |
| 5 | VIDEO | 不下载 | `[视频消息，时长{play_length}s，大小{size}MB]` |

**ilink AES 解密**：`item_list[i].image_item.aeskey`（hex 字符串，16 字节）+ AES-128-ECB。`voice_item.text` 是 `item_list[i].voice_item.text` 字段（直接字符串）。

**临时文件**：存放于 `{config_dir}/channels/{type}/{account_id}/tmp/`；Agent 会话结束后删除；进程启动时清理残留文件（GC）。

**文件大小预检**：使用 `file_item.len`（encrypted size，字符串）预判；下载时使用流式 + 20MB 硬上限，超出立即中断（防恶意大文件攻击）。

**CDN 下载时 MIME 校验**（防止恶意内容）：解密后 `python-magic` 检测实际 MIME，非 `image/*`、`audio/*`、`application/*`、`text/*` 一律拒绝并记 WARNING。

**AES-128-ECB 风险说明**：ECB 模式无完整性保护，属 ilink 协议规定。解密后内容视为"不可信输入"，落盘到受限目录，不可执行、不在 web root 下提供访问。

**`ChannelBase.connect()` 异步语义**：必须是 `async def`，启动内部 long-poll 后立即 return；不阻塞 Gateway lifespan startup。

**ilink errcode 处理**：
- `errcode=0` 或字段缺失：正常
- `errcode=-14`：session 超时/token 失效 → 停止轮询，ChannelManager 状态改为 `error`，日志 ERROR
- 其他非零 errcode：日志 WARNING，重试最多 3 次（指数退避 1s/2s/4s），超过则同上设 `error`

**理由**：分层安全防御（大小限制 + 流式 + MIME 检测）降低文件处理风险。临时文件明确生命周期防止磁盘泄漏。

**替代方案**：所有非文本均返回占位符 → 拒绝，图片和文件是常见用例（截图、PDF），用户期望 Agent 能理解。

---

## Risks / Trade-offs

- **ilink API 变更风险** → 与 KuClaw TS 实现保持 API 调用逻辑同步，TS 实现作为参考基准
- **超时分层** → 单次 wait 30s / 前端总 5min / ilink 硬上限 8min，三层独立控制，互不依赖
- **Bot token 泄露** → token 存储在 `{config_dir}/channels/.../auth.json`，权限 600（Unix）或用户私有目录（Windows）；API 响应中不返回 token 明文
- **Windows 权限保护** → `os.chmod(0o600)` 在 Windows 仅影响只读位；依赖文件系统 ACL 或放置在 `%APPDATA%` 私有路径下，文档中注明跨平台限制
- **入站消息触发并发会话** → 第一版用 per-account asyncio Lock 限制每个 account_id 最多一个 active session；并发消息回复用户"请稍候"而非静默丢弃
- **CDN 文件下载防御** → 流式下载 + 20MB 硬断流 + 事前 `file_item.len` 预判；MIME 校验防恶意内容
- **AES-128-ECB 风险** → 协议规定，无完整性保护；解密后内容视为不可信，落盘到受限目录，进行 MIME 类型校验
- **`cryptography` 依赖** → 需新增 pip 依赖 `cryptography`，解密约 1ms/文件，无性能风险
- **临时文件磁盘泄漏** → 会话结束后删除；进程启动时 GC 残留文件
- **SessionManager 不支持 attachments** → 若 SessionManager 不支持 vision attachments，图片降级为 "图片已下载但无法传递给 Agent" 占位符；此为潜在跨 change 依赖
- **`account_id` 路径穿越** → 白名单正则 `[a-zA-Z0-9_-]{1,64}` 过滤，非法字符返回 422
- **cwd 路径穿越** → 必须为绝对路径、不含符号链接逃逸、目录存在，否则 422

## Migration Plan

1. 新增 `src/openharness/channels/` 包（纯新增，不修改现有代码）
2. 新增 `HLAgent/gateway/routers/channels.py`，在 `main.py` 中注册路由
3. 新增前端页面，在 Sidebar 添加入口
4. 功能标志：channel manager 在 lifespan 中启动时，若 `~/.hlagent/channels/` 目录为空则静默跳过，不影响现有用户
5. 无 breaking changes，无需数据迁移

## Open Questions

- `DEFAULT_ILINK_BASE_URL`：硬编码常量，可通过环境变量 `ILINK_BASE_URL` 覆盖；手动配置与 QR 模式共享此默认值
- SessionManager attachments 支持：若当前版本不支持，图片 attachment 降级为文本描述；实现时检查 API 并按降级策略处理
- 图片解密后是否需要二次 resize：暂定直接传给 Agent，如 token 超限则提示用户
