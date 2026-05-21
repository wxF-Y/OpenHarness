## ADDED Requirements

### Requirement: Gateway main.py 注册 channels 路由
Gateway SHALL 在 `main.py` 中导入并注册 `channels` router，使 `/api/channels/*` 端点对外可用。

#### Scenario: channels 路由已注册
- **WHEN** Gateway 启动完成后，客户端发送 `GET /api/channels/types`
- **THEN** 返回 HTTP 200（而非 404），证明路由已注册

### Requirement: Gateway lifespan 启动时初始化 ChannelManager
Gateway lifespan startup SHALL 实例化 `ChannelManager` 并调用 `ChannelManager.startup()`，自动恢复已保存的 channel 连接；lifespan shutdown 时调用 `ChannelManager.shutdown()` 断开所有连接。

#### Scenario: 启动时无已配置 channel
- **WHEN** `{config_dir}/channels/` 目录为空或不存在
- **THEN** `ChannelManager.startup()` 静默完成，不报错，不影响其他服务启动

#### Scenario: 启动时存在已配置 channel
- **WHEN** `{config_dir}/channels/wechat_clawbot/` 下存在账号子目录（每个目录含 auth.json 和 config.json）
- **THEN** `ChannelManager.startup()` 调用 `ChannelStorage.list_accounts()` 枚举账号，为每个账号调用 `connect(auth, config)`，日志记录各账号连接结果
