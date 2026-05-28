---
comet_change: gateway-session-persistence
role: technical-design
canonical_spec: openspec
archived-with: 2026-05-28-gateway-session-persistence
status: final
---

## 问题

网关重启后 `SessionManager._sessions`（纯内存字典）被清空。前端调用 `GET /sessions` 返回空列表，历史对话不可见，WebSocket 连接返回 4004。

OpenHarness 引擎层已将每次对话持久化到 `~/.hlagent/data/sessions/{project}-{hash}/session-{sid}.json`，数据没有丢失，只是网关层没有读取它。

archived-with: 2026-05-28-gateway-session-persistence
status: final
---

## 设计

### 1. GET /sessions 扫描磁盘后返回

**现状**：只返回 `session_mgr.list_ids()` 的内存数据，重启后为空。

### 1. GET /sessions 内存活跃为主，磁盘历史为辅

**现状**：只返回 `session_mgr.list_ids()` 的内存数据，重启后为空。

**改动**：内存活跃 session 优先，磁盘历史补充不在内存中的，去重后统一返回。

```
① 内存活跃 session（主）
   遍历 session_mgr._sessions
   → 提取：session_id（12-char 内部 ID）、cwd、model、created_at 等

② 磁盘历史（辅）
   扫描 ~/.hlagent/data/sessions/**/session-*.json
   → 跳过 session_id 已在内存中的（去重）
   → 补入剩余历史 session

③ 返回合并结果，按 created_at 倒序
```

返回的 `session_id` 统一使用 12-char OpenHarness 内部 ID。

### 2. WebSocket 惰性恢复

**现状**：`session_mgr.get(session_id)` 返回 `None` → 直接关闭 4004。

**改动**：返回 `None` 时，扫描磁盘找 `session-{session_id}.json`，找到则恢复。

```
WS /ws/{session_id}
  ↓
session_mgr.get(session_id) → None
  ↓
scan: ~/.hlagent/data/sessions/**/session-{session_id}.json
  ↓ 找到
load: cwd, messages, tool_metadata, permission_mode, api_format, active_profile
  ↓
create_host(config, restore_snapshot=data)
  ↓
session_mgr 注册，继续正常 WS 流程
  ↓ 找不到
close(4004)
```

扫描是 O(n)，n = 当前项目数（通常 < 20），本地文件系统极快。

并发重连同一 session_id 时，用 `asyncio.Lock` per session_id 防止重复创建。

### 3. session 文件补存三个字段

`save_session_snapshot()` 新增三个参数并写入 payload：

| 字段 | 用途 | 缺失影响 |
|------|------|---------|
| `permission_mode` | 控制 agent 权限行为 | 恢复后权限模式改变，体验不一致 |
| `api_format` | API 格式（如 OpenAI 兼容） | 非默认格式时请求发错地方 |
| `active_profile` | 配置 profile | 恢复后使用默认 profile |

调用方（`session_backend.py` 等保存 snapshot 的地方）同步传入这三个字段。

### 4. create_host() 传递恢复参数

`create_host()` 新增可选参数 `restore_snapshot: dict | None = None`，将其中的字段映射到 `BackendHostConfig`：

```python
def create_host(config: AgentSessionConfig, restore_snapshot: dict | None = None) -> WebBackendHost:
    host_config = BackendHostConfig(
        model=config.model or (restore_snapshot or {}).get("model"),
        cwd=config.cwd,
        permission_mode=config.permission_mode or (restore_snapshot or {}).get("permission_mode"),
        ...
        restore_messages=(restore_snapshot or {}).get("messages"),
        restore_tool_metadata=(restore_snapshot or {}).get("tool_metadata"),
    )
    return WebBackendHost(host_config)
```

archived-with: 2026-05-28-gateway-session-persistence
status: final
---

## 文件改动范围

| 文件 | 改动 |
|------|------|
| `src/openharness/services/session_storage.py` | `save_session_snapshot()` 新增 `permission_mode`、`api_format`、`active_profile` 参数 |
| `src/openharness/services/session_storage.py` | 新增 `find_session_by_id(session_id)` — 全局扫描返回 snapshot dict |
| `HLAgent/sdk/hlagent_sdk/web_host.py` | `create_host()` 新增 `restore_snapshot` 参数 |
| `HLAgent/gateway/routers/sessions.py` | `GET /sessions` 合并磁盘历史 session |
| `HLAgent/gateway/routers/ws.py` | `websocket_endpoint` 增加磁盘恢复路径 |
| 保存 snapshot 的调用方 | 传入新增的三个字段 |

archived-with: 2026-05-28-gateway-session-persistence
status: final
---

## 风险

| 风险 | 缓解 |
|------|------|
| session 文件损坏 | `try/except` 跳过，记录 WARNING |
| 并发重连竞态 | `asyncio.Lock` per session_id |
| 磁盘 session 数量增大导致扫描慢 | 当前 < 20 dirs，未来可加 index 文件 |
| 旧 session 文件缺少新字段 | 读取时用 `.get()` + 默认值，向后兼容 |
