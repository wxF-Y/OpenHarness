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
