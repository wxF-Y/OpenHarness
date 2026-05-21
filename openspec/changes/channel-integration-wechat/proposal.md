## Why

HLAgent 目前只能通过 Web UI 和 REST API 交互，无法接收来自微信等即时通讯平台的消息触发 Agent 执行。通过接入 WeChat ClawBot（ilink 平台），用户可以直接在微信内与 HLAgent 对话，大幅扩展使用场景，同时为后续接入更多 channel（Discord、飞书等）奠定通用基础。

## What Changes

- 新增通用 **Channel 抽象层**：统一 channel 的注册、配置、连接生命周期管理
- 新增 **WeChat ClawBot channel 实现**：通过 ilink API 进行二维码扫描登录，建立 Bot 与微信用户的消息双向桥接
- 新增 **HLAgent Gateway channel 路由**：`/api/channels/*` REST 端点，管理 channel 的增删查和连接状态
- 新增 **Web UI channel 配置页**：支持二维码扫描接入和手动填写配置两种接入方式
- `cron_runner` 中的消息分发逻辑扩展以支持来自 channel 的入站消息触发 Agent 会话

## Capabilities

### New Capabilities

- `channel-registry`: 通用 channel 注册和生命周期管理 —— 定义 channel 接口协议、channel 实例的持久化配置、连接状态跟踪（connected/disconnected/error）
- `wechat-clawbot-channel`: WeChat ClawBot channel 实现 —— 通过 ilink API 完成二维码登录认证，订阅入站消息并路由到 Agent 会话，支持发送消息回 WeChat 用户
- `channel-gateway-api`: HLAgent Gateway channel REST API —— 提供 channel 管理端点，包括列出可用 channel 类型、添加/删除 channel 实例、获取二维码、查询连接状态
- `channel-web-ui`: Web UI channel 配置界面 —— 新增 Channels 页面，展示已连接 channel 列表，支持通过二维码扫描或手动填写配置两种方式添加新 channel

### Modified Capabilities

- `hlagent-gateway`: 新增 `/api/channels` 路由注册，扩展 lifespan 以启动/停止 channel 连接

## Impact

- **新增文件**：
  - `src/openharness/channels/` —— channel 抽象基类和注册表
  - `src/openharness/channels/wechat_clawbot/` —— WeChat ClawBot channel 实现
  - `HLAgent/gateway/routers/channels.py` —— channel REST API 路由
  - `HLAgent/web/src/pages/ChannelsPage.tsx` —— Web UI channel 管理页面
  - `HLAgent/web/src/components/QrCodeScanner.tsx` —— 二维码展示与轮询组件
- **修改文件**：
  - `HLAgent/gateway/main.py` —— 注册 channels 路由，lifespan 中启动 channel manager
  - `HLAgent/web/src/components/Sidebar.tsx` —— 添加 Channels 导航项
- **外部依赖**：ilink API（WeChat ClawBot 平台）；Python `httpx`（已有）用于 API 调用
- **无 breaking changes**：channel 功能完全可选，不影响现有 sessions/cron/swarm 功能
