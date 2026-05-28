## ADDED Requirements

### Requirement: 网关重启后 WebSocket 可重连已有 session
网关重启后，客户端使用原有 `session_id` 发起 WebSocket 连接时，系统 SHALL 从磁盘 snapshot 恢复该 session，并允许连接成功（不返回 4004）。

#### Scenario: 磁盘有 snapshot 时重连成功
- **WHEN** 客户端携带有效 `session_id` 连接 `/ws/{session_id}`，且内存中无该 session 但磁盘有对应 snapshot
- **THEN** 系统从磁盘加载 snapshot，重建 `WebBackendHost`，注入 `SessionManager`，WebSocket 连接建立成功

#### Scenario: 磁盘无 snapshot 时返回 4004
- **WHEN** 客户端携带 `session_id` 连接 `/ws/{session_id}`，且内存和磁盘均无该 session
- **THEN** 系统返回 WebSocket close code 4004，reason 为 "Session not found"

#### Scenario: 并发重连同一 session 不产生竞态
- **WHEN** 多个客户端同时用同一 `session_id` 重连，且该 session 正在从磁盘恢复
- **THEN** 第一个请求触发恢复，后续请求等待恢复完成后复用同一 `WebBackendHost`，不创建重复实例

---

### Requirement: 重连后历史对话内容可见
重连成功后，系统 SHALL 通过 `_replay_transcript` 将历史消息回放给客户端，使用户能看到重启前的完整对话内容。

#### Scenario: 历史消息正常回放
- **WHEN** 客户端重连成功，且 snapshot 中含有历史 `messages`
- **THEN** 系统在 WebSocket 建立后立即回放全部历史消息，顺序与原始对话一致

#### Scenario: 空历史 session 重连正常
- **WHEN** 客户端重连成功，且 snapshot 中 `messages` 为空列表
- **THEN** 系统正常建立连接，不发送任何历史消息，等待新输入

---

### Requirement: create_host 支持带历史恢复启动
`create_host()` 函数 SHALL 接受可选的 `restore_snapshot` 参数，并将其 `messages` 和 `tool_metadata` 传入底层 `build_runtime()`，使 OpenHarness 引擎以历史状态启动。

#### Scenario: 传入 snapshot 时引擎以历史状态启动
- **WHEN** 调用 `create_host(config, restore_snapshot=snapshot)`，且 `snapshot.messages` 非空
- **THEN** 底层 `BackendHostConfig` 包含 `restore_messages` 和 `restore_tool_metadata`，引擎启动后上下文包含历史对话

#### Scenario: 不传入 snapshot 时行为不变
- **WHEN** 调用 `create_host(config)`（无 `restore_snapshot` 参数）
- **THEN** 行为与现有实现完全一致，引擎以空上下文启动

---

### Requirement: SessionManager 支持从磁盘恢复 session
`SessionManager` SHALL 提供 `recover_from_snapshot(session_id, snapshot, config)` 方法，将磁盘 snapshot 转换为内存 `SessionEntry` 并注入 host。

#### Scenario: 成功恢复并注入
- **WHEN** 调用 `recover_from_snapshot(session_id, snapshot, config)`
- **THEN** `SessionManager._sessions[session_id]` 被正确设置，`session_mgr.get(session_id)` 返回恢复的 host

#### Scenario: snapshot 文件损坏时安全降级
- **WHEN** 磁盘 snapshot 文件存在但内容无法解析（JSON 损坏、字段缺失）
- **THEN** 系统记录 WARNING 日志，方法返回 `None`，调用方按 session 不存在处理
