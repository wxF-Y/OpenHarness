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

## Migration Plan

1. 变更向后兼容，不需要数据迁移
2. 现有运行中的网关无需重启即可接受新部署（热重载支持）
3. 若需回滚，删除 `session_manager.py` 中的恢复逻辑，`ws.py` 恢复原有提前返回行为

## Open Questions

- Q1：`SessionManager` 是否应暴露 `list_recoverable(project_dir)` 方法供 `/sessions` API 返回？（倾向：是，保持列表视图完整）
- Q2：inactivity timeout 策略是否需要考虑恢复后的旧 session？（建议：恢复时重置 last_active 时间戳）
