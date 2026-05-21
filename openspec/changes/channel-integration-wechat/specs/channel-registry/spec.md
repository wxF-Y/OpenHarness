## ADDED Requirements

### Requirement: 系统提供通用 ChannelBase 抽象
系统 SHALL 定义 `ChannelBase` 抽象基类，所有 channel 实现必须继承并实现其接口，以保证 channel 的可替换性和统一管理。

#### Scenario: Channel 类型注册
- **WHEN** 一个新的 channel 类实现继承 `ChannelBase` 并调用 `CHANNEL_TYPES.register("wechat_clawbot", WechatClawbotChannel)`
- **THEN** 该 channel 类型可通过 `CHANNEL_TYPES.get("wechat_clawbot")` 检索到

#### Scenario: 未注册 channel 类型检索
- **WHEN** 调用 `CHANNEL_TYPES.get("nonexistent")` 检索未注册的 channel 类型
- **THEN** 返回 `None`，不抛出异常

### Requirement: ChannelBase 定义必须实现的生命周期方法
`ChannelBase` SHALL 声明以下抽象方法，所有子类必须实现。所有方法均为 `async def`：
- `connect(auth: dict, config: dict) -> None` — 从 auth/config 两个 dict 建立连接；内部启动 long-poll 后立即 return，不阻塞调用方
- `disconnect() -> None` — 断开连接并清理资源（取消 long-poll task）
- `send_message(to: str, text: str) -> None` — 向指定目标发送文本消息
- `get_status() -> ChannelStatus` — 返回当前连接状态

#### Scenario: 未实现抽象方法
- **WHEN** 尝试实例化一个未实现所有抽象方法的 `ChannelBase` 子类
- **THEN** 抛出 `TypeError`

#### Scenario: connect 不阻塞 Gateway 启动
- **WHEN** `ChannelManager.startup()` 调用 `channel.connect(auth, config)` 时，long-poll 尚未收到任何消息
- **THEN** `connect()` 立即 return，Gateway lifespan 继续完成启动

### Requirement: ChannelBase 定义 on_inbound_message 回调接口契约
系统 SHALL 约定 `ChannelManager.on_inbound_message` 的签名为：
```
on_inbound_message(
    channel_type: str,
    account_id: str,
    sender_id: str,
    text: str,
    attachments: list[dict]  # [{"type": "image"|"file", "path": str, "mime"?: str, "name"?: str}]
) -> None
```
所有 channel 实现调用此回调时 SHALL 使用此签名。

#### Scenario: 回调签名一致
- **WHEN** `WechatClawbotChannel` 收到入站消息后调用 `on_inbound_message()`
- **THEN** 参数与契约签名完全一致，`attachments` 为空列表（文本消息）或包含文件 dict 的列表

### Requirement: Channel 账号配置持久化（认证与运营配置分离）
系统 SHALL 将 channel 账号配置分两个 JSON 文件持久化到 `{config_dir}/channels/{channel_type}/{account_id}/`：
- `auth.json`：token 等认证凭据，文件权限 600（Unix），仅登录流程写入
- `config.json`：display_name、cwd、model、system_prompt、max_turns、accept_file_types、enabled 等可编辑的运营配置

**account_id 格式校验**：仅允许 `[a-zA-Z0-9_-]{1,64}`，非法字符 SHALL 在调用方（Gateway 路由层）拦截并返回 422。

#### Scenario: 保存新 channel 账号的认证凭据
- **WHEN** 调用 `ChannelStorage.save_auth(channel_type, account_id, auth_data)`
- **THEN** 文件被写入 `{config_dir}/channels/{channel_type}/{account_id}/auth.json`，内容包含 `created_at` 时间戳

#### Scenario: 保存或更新运营配置（merge 语义）
- **WHEN** 调用 `ChannelStorage.save_config(channel_type, account_id, config_data)`，config.json 已存在
- **THEN** 仅更新 config_data 中包含的字段，未提供的字段保持原值

#### Scenario: 初次写入 config.json（无已有文件）
- **WHEN** `save_config()` 调用时 config.json 不存在
- **THEN** 写入完整默认值（accept_file_types=["image","voice","file"]，max_turns=10，enabled=true 等）并合并传入的 config_data

#### Scenario: 加载认证凭据
- **WHEN** 调用 `ChannelStorage.load_auth(channel_type, account_id)`，auth.json 存在
- **THEN** 返回包含所有认证字段的 dict

#### Scenario: 加载运营配置
- **WHEN** 调用 `ChannelStorage.load_config(channel_type, account_id)`，config.json 存在
- **THEN** 返回包含所有配置字段的 dict

#### Scenario: 加载不存在的账号
- **WHEN** 调用 `load_auth("wechat_clawbot", "nonexistent")`，对应目录不存在
- **THEN** 返回 `None`

### Requirement: ChannelStorage 提供账号列表枚举
系统 SHALL 实现 `ChannelStorage.list_accounts(channel_type: str | None = None) -> list[dict]`，返回所有已保存账号的元信息（channel_type, account_id, auth_exists, config_exists）。

#### Scenario: 列出所有账号
- **WHEN** 调用 `ChannelStorage.list_accounts()` 且存在 2 个已保存账号（1 wechat_clawbot, 1 其他）
- **THEN** 返回列表包含 2 个 dict，每项含 channel_type 和 account_id

#### Scenario: 按类型过滤
- **WHEN** 调用 `ChannelStorage.list_accounts(channel_type="wechat_clawbot")`
- **THEN** 仅返回 wechat_clawbot 类型的账号列表

#### Scenario: 无任何账号时返回空列表
- **WHEN** `{config_dir}/channels/` 目录为空
- **THEN** 返回 `[]`

### Requirement: Channel 管理器跟踪活跃连接状态
系统 SHALL 维护一个内存中的 `ChannelManager`，记录每个已注册 channel 账号的运行状态（connected / disconnected / error / connecting）。

#### Scenario: 获取所有 channel 实例状态
- **WHEN** 调用 `ChannelManager.list_instances()`
- **THEN** 返回列表，每项包含 `channel_type`、`account_id`、`status`、`last_connected_at`（可为 null）

#### Scenario: Gateway 启动时自动恢复已配置的 channel 连接
- **WHEN** Gateway 启动（lifespan startup），`{config_dir}/channels/` 目录下存在已保存的账号目录（含 auth.json 和 config.json）
- **THEN** `ChannelManager` 调用 `ChannelStorage.list_accounts()`，为每个账号查找对应 channel 类（`CHANNEL_TYPES.get(channel_type)`），实例化并调用 `connect(auth, config)`，状态变为 `connected` 或 `error`

#### Scenario: 未知 channel 类型在启动时跳过
- **WHEN** 存在 channel_type="unknown_channel" 的账号目录，但该类型未在 `CHANNEL_TYPES` 中注册
- **THEN** 跳过该账号，日志记录 WARNING，不影响其他账号启动
