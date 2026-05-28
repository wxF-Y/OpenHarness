# Comet Design Handoff

- Change: gateway-session-persistence
- Phase: design
- Mode: compact
- Context hash: 895acc6d9a2e74b2d3ea4d9d09259c0bad223434beb697855e40fc18295f5deb

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/gateway-session-persistence/proposal.md

- Source: openspec/changes/gateway-session-persistence/proposal.md
- Lines: 1-29
- SHA256: 17299bf67a3f64506b8fe49fe4d9a9088d93b95688ff77ddeda6238032194837

```md
## Why

网关（Gateway）重启后，`SessionManager` 的纯内存状态被清空，客户端无法恢复之前的对话 session，WebSocket 连接直接返回 4004 错误。OpenHarness 层已有完整的文件持久化基础设施（`~/.hlagent/data/sessions/`），但网关层从未使用它来恢复状态。

## What Changes

- **网关启动时扫描持久化目录**：`lifespan` 启动钩子读取 `~/.hlagent/data/sessions/` 中的 snapshot 文件，重建 `SessionManager` 内存状态。
- **WebSocket 降级加载**：`/ws/{session_id}` 路由在 `session_mgr.get()` 返回 `None` 时，尝试从磁盘加载 session snapshot 并重建 `WebBackendHost`。
- **`create_host()` 支持恢复消息**：`HLAgent/sdk/hlagent_sdk/web_host.py` 中的 `create_host()` 接受并传递 `restore_messages` / `restore_tool_metadata` 参数到 `build_runtime()`。
- **`SessionManager` 新增磁盘恢复方法**：添加 `recover_from_snapshot(snapshot)` 和 `load_from_disk(project_dir)` 方法。

## Capabilities

### New Capabilities

- `session-persistence-recovery`: 网关重启后从磁盘恢复 session 列表及对话历史，使客户端可以无缝重连并看到历史消息。

### Modified Capabilities

（无现有规格变更）

## Impact

- `HLAgent/gateway/main.py`：`lifespan` 添加启动恢复逻辑
- `HLAgent/gateway/services/session_manager.py`：添加磁盘恢复方法
- `HLAgent/gateway/routers/ws.py`：添加 session 未找到时的降级恢复路径
- `HLAgent/gateway/routers/sessions.py`：`create_session` 接受可选的 `restore_from` 参数
- `HLAgent/sdk/hlagent_sdk/web_host.py`：`create_host()` 传递 `restore_messages`
- 依赖：`src/openharness/services/session_storage.py`（`load_latest`、`load_session_by_id`）
```

## openspec/changes/gateway-session-persistence/design.md

- Source: openspec/changes/gateway-session-persistence/design.md
- Lines: 1-91
- SHA256: 93d2e38dd076fc3d12d08269b00ed61e5bd7008244d96e52ee0281a2a528cbc3

[TRUNCATED]

```md
## Context

OpenHarness 网关使用 `SessionManager`（`HLAgent/gateway/services/session_manager.py`）以内存字典管理所有活跃 session。而 OpenHarness 引擎层（`src/openharness/services/session_storage.py`）已在 `~/.hlagent/data/sessions/{project}-{hash}/` 以 JSON 文件持久化每次会话 snapshot。两层之间没有任何恢复路径：网关重启后内存被清空，客户端发起 WebSocket 连接时因 `session_mgr.get(id)` 返回 `None` 而收到 4004 并断开。

**现有基础设施（可直接利用）：**
- `session_storage.load_session_by_id(sid, cwd)` / `load_latest(cwd)` — 从磁盘加载 snapshot
- `build_runtime(restore_messages=..., restore_tool_metadata=...)` — 支持带历史恢复启动
- `WebBackendHost` 接受 `BackendHostConfig`，其中预留了恢复参数

## Goals / Non-Goals

**Goals:**
- 网关重启后，已有 snapshot 的 session 可被客户端重新连接
- 重连后客户端能看到历史对话内容（通过 `_replay_transcript`）
- 新建 session 行为不变
- 性能影响最小（惰性加载优于全量预热）

**Non-Goals:**
- 跨机器 session 迁移
- 实时 session 状态同步（如多网关副本共享）
- 强制清除过期 session（垃圾回收属于独立 task）
- WebSocket 重连的断点续传（消息队列/幂等投递）

## Decisions

### D1：惰性恢复 vs 启动全量预热

**决策：惰性恢复（Lazy Recovery）**

客户端请求 `/ws/{session_id}` 时，若 `session_mgr.get(session_id)` 返回 `None`，则尝试从磁盘加载 snapshot 并重建 `WebBackendHost`，再注入 `session_mgr`。

**备选：启动时全量扫描磁盘**
- 优点：第一次重连无延迟
- 缺点：磁盘上可能有数百个旧 session，全部预热会大量消耗内存和启动时间

**理由：** 大多数旧 session 不会被重连，惰性加载只付"被需要"的代价。若未来需要提升首连速度，可在后台异步预热热点 session。

---

### D2：`create_host()` 参数扩展方式

**决策：添加可选参数 `restore_snapshot`**

```python
def create_host(
    config: AgentSessionConfig,
    restore_snapshot: SessionSnapshot | None = None,
) -> WebBackendHost:
```

内部将 `restore_snapshot.messages` / `restore_snapshot.tool_metadata` 传入 `BackendHostConfig`。

**理由：** 与现有 `BackendHostConfig` 结构对齐，不破坏现有调用点（新参数默认 `None`）。

---

### D3：Session 元数据在 `session_mgr` 中的恢复范围

**决策：仅恢复 `WebBackendHost` 对象（会话标识 + 对话内容），不恢复完整 `SessionEntry` 元数据**

网关的 `SessionEntry` 包含 `config`（`cwd`、`model`、权限模式等）和 `host`。磁盘 snapshot 包含这些字段，可完整重建 `SessionEntry`。

**理由：** 完整重建使 `/sessions` REST API 也能返回恢复后的 session 列表，用户体验更一致。

---

### D4：恢复失败策略

**决策：降级为 404，不静默创建空 session**

若磁盘 snapshot 不存在或损坏，WebSocket 路由返回 `4004 Session not found`，与当前行为一致，避免用空 session 误导客户端。

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|---------|
| Snapshot 文件损坏导致恢复失败 | try/except 捕获，降级为 4004，记录 warning log |
| 惰性加载时出现竞态（同一 session_id 并发重连） | 用 asyncio.Lock per session_id 序列化加载，加载完成后再处理等待队列 |
| 历史 session 长期占用内存 | （非本次范围）后续添加 LRU 驱逐策略 |
| `restore_messages` 中含大量消息导致启动慢 | 当前不做截断，依赖现有 OpenHarness context compaction |
```

Full source: openspec/changes/gateway-session-persistence/design.md

## openspec/changes/gateway-session-persistence/tasks.md

- Source: openspec/changes/gateway-session-persistence/tasks.md
- Lines: 1-31
- SHA256: 4e63aa240f694f5b86da65330778cf76950b9737f06824fdb59d6e281d3d6467

```md
## 1. session_storage：补存三个字段 + 全局查找函数

- [ ] 1.1 `save_session_snapshot()` 新增参数 `permission_mode`、`api_format`、`active_profile`，写入 payload
- [ ] 1.2 找到所有调用 `save_session_snapshot()` 的地方，传入这三个字段
- [ ] 1.3 新增 `find_session_by_id(session_id: str) -> dict | None`：扫描 `~/.hlagent/data/sessions/**/session-{session_id}.json`，返回第一个匹配的 snapshot dict

## 2. create_host()：支持传入 restore_snapshot

- [ ] 2.1 `create_host()` 新增可选参数 `restore_snapshot: dict | None = None`
- [ ] 2.2 将 `restore_snapshot` 中的 `messages`、`tool_metadata` 写入 `BackendHostConfig.restore_messages` / `restore_tool_metadata`
- [ ] 2.3 `permission_mode`、`api_format`、`active_profile` 从 `restore_snapshot` 中读取作为 fallback（config 显式传值优先）

## 3. GET /sessions：合并磁盘历史与内存活跃 session

- [ ] 3.1 在 `session_storage` 新增 `list_all_sessions() -> list[dict]`：扫描所有项目目录下的 `session-*.json`，返回轻量摘要（session_id、cwd、model、summary、message_count、created_at）
- [ ] 3.2 `GET /sessions` 路由：先遍历 `session_mgr._sessions` 取内存活跃 session（主），再调用 `list_all_sessions()` 补入磁盘中 session_id 不在内存的历史记录（辅），去重后按 created_at 倒序返回

## 4. WebSocket：磁盘惰性恢复路径

- [ ] 4.1 `websocket_endpoint` 中 `host is None` 分支：调用 `session_storage.find_session_by_id(session_id)` 查磁盘
- [ ] 4.2 找到 snapshot 时：调用 `create_host(config_from_snapshot, restore_snapshot=data)` 重建 host，注入 `session_mgr`
- [ ] 4.3 找不到时：保持原有 `close(code=4004)` 行为
- [ ] 4.4 并发重连保护：`_recovery_locks: dict[str, asyncio.Lock]`，同一 session_id 的并发重连等待第一个完成后复用

## 5. 测试与验证

- [ ] 5.1 单元测试：`find_session_by_id` 找到 / 找不到 / 文件损坏三种路径
- [ ] 5.2 单元测试：`list_all_sessions` 正确合并多个项目目录的 sessions
- [ ] 5.3 集成测试：清空 `session_mgr`（模拟重启）→ `GET /sessions` 能返回磁盘历史
- [ ] 5.4 集成测试：清空 `session_mgr` → WS 用历史 session_id 重连 → 连接成功 → 历史消息回放
- [ ] 5.5 手动验收：启动网关 → 对话几轮 → 重启网关 → 前端刷新 → 历史 session 出现在列表 → 点击恢复 → 看到完整对话
```

## openspec/changes/gateway-session-persistence/specs/session-persistence-recovery/spec.md

- Source: openspec/changes/gateway-session-persistence/specs/session-persistence-recovery/spec.md
- Lines: 1-55
- SHA256: 954b486f3510ee6452b4236814a90373e4a6871244fec56f4a447ca4506da2e2

```md
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
```

