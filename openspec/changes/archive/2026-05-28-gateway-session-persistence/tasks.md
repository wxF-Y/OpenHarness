## 1. session_storage：补存三个字段 + 全局查找函数

- [x] 1.1 `save_session_snapshot()` 新增参数 `permission_mode`、`api_format`、`active_profile`，写入 payload
- [x] 1.2 找到所有调用 `save_session_snapshot()` 的地方，传入这三个字段
- [x] 1.3 新增 `find_session_by_id(session_id: str) -> dict | None`：扫描 `~/.hlagent/data/sessions/**/session-{session_id}.json`，返回第一个匹配的 snapshot dict

## 2. create_host()：支持传入 restore_snapshot

- [x] 2.1 `create_host()` 新增可选参数 `restore_snapshot: dict | None = None`
- [x] 2.2 将 `restore_snapshot` 中的 `messages`、`tool_metadata` 写入 `BackendHostConfig.restore_messages` / `restore_tool_metadata`
- [x] 2.3 `permission_mode`、`api_format`、`active_profile` 从 `restore_snapshot` 中读取作为 fallback（config 显式传值优先）

## 3. GET /sessions：合并磁盘历史与内存活跃 session

- [x] 3.1 在 `session_storage` 新增 `list_all_sessions() -> list[dict]`：扫描所有项目目录下的 `session-*.json`，返回轻量摘要（session_id、cwd、model、summary、message_count、created_at）
- [x] 3.2 `GET /sessions` 路由：先遍历 `session_mgr._sessions` 取内存活跃 session（主），再调用 `list_all_sessions()` 补入磁盘中 session_id 不在内存的历史记录（辅），去重后按 created_at 倒序返回

## 4. WebSocket：磁盘惰性恢复路径

- [x] 4.1 `websocket_endpoint` 中 `host is None` 分支：调用 `session_storage.find_session_by_id(session_id)` 查磁盘
- [x] 4.2 找到 snapshot 时：调用 `create_host(config_from_snapshot, restore_snapshot=data)` 重建 host，注入 `session_mgr`
- [x] 4.3 找不到时：保持原有 `close(code=4004)` 行为
- [x] 4.4 并发重连保护：`_recovery_locks: dict[str, asyncio.Lock]`，同一 session_id 的并发重连等待第一个完成后复用

## 5. 测试与验证

- [x] 5.1 单元测试：`find_session_by_id` 找到 / 找不到 / 文件损坏三种路径
- [x] 5.2 单元测试：`list_all_sessions` 正确合并多个项目目录的 sessions
- [x] 5.3 集成测试：清空 `session_mgr`（模拟重启）→ `GET /sessions` 能返回磁盘历史（verify 阶段手动验收）
- [x] 5.4 集成测试：清空 `session_mgr` → WS 用历史 session_id 重连 → 连接成功 → 历史消息回放（verify 阶段手动验收）
- [x] 5.5 手动验收：启动网关 → 对话几轮 → 重启网关 → 前端刷新 → 历史 session 出现在列表 → 点击恢复 → 看到完整对话（verify 阶段手动验收）
