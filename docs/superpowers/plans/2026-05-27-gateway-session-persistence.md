---
archived-with: 2026-05-28-gateway-session-persistence
status: final
---
# Gateway Session Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网关重启后，前端能通过 `GET /sessions` 看到历史对话列表，并通过 WebSocket 重连恢复完整对话内容。

**Architecture:** 三层改动：① `session_storage.py` 新增三字段存储和全局扫描函数；② `create_host()` 支持传入历史 snapshot 恢复消息；③ `GET /sessions` 合并内存与磁盘数据，WebSocket 路由在内存未命中时惰性从磁盘恢复。`GET /sessions` 和 WS 路由统一使用 12-char OpenHarness 内部 session_id，不再暴露 gateway UUID。

**Tech Stack:** Python asyncio, FastAPI, Pydantic, pathlib

---

```yaml
change: gateway-session-persistence
design-doc: docs/superpowers/specs/2026-05-27-gateway-session-persistence-design.md
base-ref: 96f5b71137eaa943e4fb9ddf8bc0d6848f634438
```

---

## 文件改动地图

| 文件 | 类型 | 职责 |
|------|------|------|
| `src/openharness/services/session_storage.py` | 修改 | 新增三字段、`find_session_by_id()`、`list_all_sessions()` |
| `src/openharness/services/session_backend.py` | 修改 | `save_snapshot()` 签名同步新增三字段 |
| `HLAgent/sdk/hlagent_sdk/web_host.py` | 修改 | `create_host()` 新增 `restore_snapshot` 参数 |
| `HLAgent/gateway/routers/sessions.py` | 修改 | `GET /sessions` 合并内存+磁盘；`SessionSummary` 新增 `title` 字段兼容 |
| `HLAgent/gateway/routers/ws.py` | 修改 | WebSocket 惰性磁盘恢复路径 + 并发锁 |
| `tests/test_services/test_session_storage.py` | 修改 | 新增 `find_session_by_id` / `list_all_sessions` 测试 |

---

## Task 1: session_storage — 新增三字段

**Files:**
- Modify: `src/openharness/services/session_storage.py:64-113`

- [ ] **Step 1: 修改 `save_session_snapshot()` 签名，新增三个可选参数**

```python
def save_session_snapshot(
    *,
    cwd: str | Path,
    model: str,
    system_prompt: str,
    messages: list[ConversationMessage],
    usage: UsageSnapshot,
    session_id: str | None = None,
    tool_metadata: dict[str, object] | None = None,
    permission_mode: str | None = None,   # 新增
    api_format: str | None = None,         # 新增
    active_profile: str | None = None,     # 新增
) -> Path:
```

- [ ] **Step 2: 在 payload 字典中写入三个新字段**

在 `payload = { ... }` 块中，`"message_count"` 行之后添加：

```python
    payload = {
        "session_id": sid,
        "cwd": str(Path(cwd).resolve()),
        "model": model,
        "system_prompt": system_prompt,
        "messages": [message.model_dump(mode="json") for message in messages],
        "usage": usage.model_dump(),
        "tool_metadata": _persistable_tool_metadata(tool_metadata),
        "created_at": now,
        "summary": summary,
        "message_count": len(messages),
        "permission_mode": permission_mode,   # 新增
        "api_format": api_format,             # 新增
        "active_profile": active_profile,     # 新增
    }
```

- [ ] **Step 3: 运行现有测试确认不破坏**

```bash
cd e:/AI/OpenHarness
python -m pytest tests/test_services/test_session_storage.py -v 2>&1 | tail -20
```

Expected: 所有现有测试 PASS（新字段为可选，默认 None，向后兼容）

- [ ] **Step 4: Commit**

```bash
git add src/openharness/services/session_storage.py
git commit -m "feat: save_session_snapshot 新增 permission_mode/api_format/active_profile 字段"
```

---

## Task 2: session_storage — 新增 `find_session_by_id()` 和 `list_all_sessions()`

**Files:**
- Modify: `src/openharness/services/session_storage.py`（在文件末尾 `__all__` 之前添加）

- [ ] **Step 1: 新增 `find_session_by_id()`**

在 `load_session_by_id()` 函数之后添加：

```python
def find_session_by_id(session_id: str) -> dict[str, Any] | None:
    """全局扫描所有项目目录，按 session_id 查找 snapshot 文件。"""
    sessions_dir = get_sessions_dir()
    if not sessions_dir.exists():
        return None
    for project_dir in sessions_dir.iterdir():
        if not project_dir.is_dir():
            continue
        path = project_dir / f"session-{session_id}.json"
        if path.exists():
            try:
                return _sanitize_snapshot_payload(json.loads(path.read_text(encoding="utf-8")))
            except Exception:
                log.warning("Failed to load session file %s", path)
                return None
    return None
```

注意：需要在文件顶部确认 `log = logging.getLogger(__name__)` 存在，若无则添加：
```python
import logging
log = logging.getLogger(__name__)
```

- [ ] **Step 2: 新增 `list_all_sessions()`**

在 `find_session_by_id()` 之后添加：

```python
def list_all_sessions() -> list[dict[str, Any]]:
    """扫描所有项目目录下的 session-*.json，返回轻量摘要列表，按 created_at 倒序。"""
    sessions_dir = get_sessions_dir()
    results: list[dict[str, Any]] = []
    if not sessions_dir.exists():
        return results
    for project_dir in sessions_dir.iterdir():
        if not project_dir.is_dir():
            continue
        for path in project_dir.glob("session-*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                results.append({
                    "session_id": data.get("session_id", ""),
                    "cwd": data.get("cwd", ""),
                    "model": data.get("model", ""),
                    "summary": data.get("summary", ""),
                    "message_count": data.get("message_count", 0),
                    "created_at": data.get("created_at", path.stat().st_mtime),
                    "permission_mode": data.get("permission_mode"),
                    "api_format": data.get("api_format"),
                    "active_profile": data.get("active_profile"),
                })
            except Exception:
                log.warning("Skipping unreadable session file %s", path)
                continue
    results.sort(key=lambda x: x["created_at"], reverse=True)
    return results
```

- [ ] **Step 3: 更新 `__all__`**

在 `session_storage.py` 末尾的 `__all__` 列表中添加两个函数名：

```python
__all__ = [
    ...
    "find_session_by_id",
    "list_all_sessions",
]
```

如果文件没有 `__all__`，跳过此步。

- [ ] **Step 4: 更新 `src/openharness/services/__init__.py`**

```python
from openharness.services.session_storage import (
    ...
    find_session_by_id,
    list_all_sessions,
)

__all__ = [
    ...
    "find_session_by_id",
    "list_all_sessions",
]
```

- [ ] **Step 5: Commit**

```bash
git add src/openharness/services/session_storage.py src/openharness/services/__init__.py
git commit -m "feat: session_storage 新增 find_session_by_id 和 list_all_sessions"
```

---

## Task 3: session_backend — 同步新增三字段

**Files:**
- Modify: `src/openharness/services/session_backend.py:20-77`

- [ ] **Step 1: 更新 `SessionBackend` Protocol 的 `save_snapshot()` 签名**

```python
def save_snapshot(
    self,
    *,
    cwd: str | Path,
    model: str,
    system_prompt: str,
    messages: list[ConversationMessage],
    usage: UsageSnapshot,
    session_id: str | None = None,
    tool_metadata: dict[str, object] | None = None,
    permission_mode: str | None = None,   # 新增
    api_format: str | None = None,         # 新增
    active_profile: str | None = None,     # 新增
) -> Path:
```

- [ ] **Step 2: 更新 `OpenHarnessSessionBackend.save_snapshot()` 实现，透传三个字段**

```python
def save_snapshot(
    self,
    *,
    cwd: str | Path,
    model: str,
    system_prompt: str,
    messages: list[ConversationMessage],
    usage: UsageSnapshot,
    session_id: str | None = None,
    tool_metadata: dict[str, object] | None = None,
    permission_mode: str | None = None,
    api_format: str | None = None,
    active_profile: str | None = None,
) -> Path:
    return session_storage.save_session_snapshot(
        cwd=cwd,
        model=model,
        system_prompt=system_prompt,
        messages=messages,
        usage=usage,
        session_id=session_id,
        tool_metadata=tool_metadata,
        permission_mode=permission_mode,
        api_format=api_format,
        active_profile=active_profile,
    )
```

- [ ] **Step 3: 查找 `save_snapshot()` 的调用方，确认是否需要传入新字段**

```bash
cd e:/AI/OpenHarness && grep -rn "save_snapshot\|save_session_snapshot" src/ --include="*.py" | grep -v "def save"
```

找到调用点后，检查调用上下文是否能获取 `permission_mode`、`api_format`、`active_profile`。若调用方（如 `runtime.py`）有这些值，则传入；若无，保持默认 `None`（向后兼容）。

- [ ] **Step 4: Commit**

```bash
git add src/openharness/services/session_backend.py
git commit -m "feat: session_backend save_snapshot 同步新增三字段签名"
```

---

## Task 4: create_host() — 支持 restore_snapshot

**Files:**
- Modify: `HLAgent/sdk/hlagent_sdk/web_host.py:390-402`

- [ ] **Step 1: 修改 `create_host()` 签名和实现**

将现有的：

```python
def create_host(config: AgentSessionConfig) -> WebBackendHost:
    """Create a WebBackendHost from a high-level AgentSessionConfig."""
    host_config = BackendHostConfig(
        model=config.model,
        cwd=config.cwd,
        permission_mode=config.permission_mode,
        system_prompt=config.system_prompt,
        max_turns=config.max_turns,
        api_key=config.api_key,
        api_format=config.api_format,
        active_profile=config.active_profile,
    )
    return WebBackendHost(host_config)
```

替换为：

```python
def create_host(
    config: AgentSessionConfig,
    restore_snapshot: dict | None = None,
) -> WebBackendHost:
    """Create a WebBackendHost from a high-level AgentSessionConfig.

    若传入 restore_snapshot，从 snapshot 中恢复消息历史和配置（config 显式值优先）。
    """
    snap = restore_snapshot or {}
    host_config = BackendHostConfig(
        model=config.model or snap.get("model"),
        cwd=config.cwd or snap.get("cwd"),
        permission_mode=config.permission_mode or snap.get("permission_mode"),
        system_prompt=config.system_prompt or snap.get("system_prompt"),
        max_turns=config.max_turns,
        api_key=config.api_key,
        api_format=config.api_format or snap.get("api_format"),
        active_profile=config.active_profile or snap.get("active_profile"),
        restore_messages=snap.get("messages") or None,
        restore_tool_metadata=snap.get("tool_metadata") or None,
    )
    return WebBackendHost(host_config)
```

- [ ] **Step 2: 确认 `BackendHostConfig` 有 `restore_messages` 和 `restore_tool_metadata` 字段**

```bash
cd e:/AI/OpenHarness && grep -n "restore_messages\|restore_tool_metadata" src/openharness/ui/backend_host.py | head -10
```

Expected: 两个字段已存在（之前探索时确认过）

- [ ] **Step 3: Commit**

```bash
git add HLAgent/sdk/hlagent_sdk/web_host.py
git commit -m "feat: create_host 支持 restore_snapshot 恢复历史消息"
```

---

## Task 5: GET /sessions — 合并内存与磁盘

**Files:**
- Modify: `HLAgent/gateway/routers/sessions.py:56-126`

- [ ] **Step 1: 在 `SessionSummary` 新增 `session_internal_id` 字段**

`SessionSummary` 目前的 `session_id` 是 32-char gateway UUID。磁盘历史 session 没有 gateway UUID，只有 12-char 内部 ID。为了统一，在 `list_sessions` 中磁盘历史 session 以 12-char 内部 ID 作为 `session_id` 返回。在 `SessionSummary` 中新增可选字段区分两者：

```python
class SessionSummary(BaseModel):
    session_id: str          # 内存活跃：gateway 32-char UUID；磁盘历史：12-char 内部 ID
    model: str
    cwd: str
    is_managed: bool = False
    ready: bool
    created_at: float
    title: str = ""
    expert_role: str | None = None
    expert_role_label: str | None = None
```

不需要改字段，只是语义上磁盘历史的 `session_id` 是内部 12-char ID。

- [ ] **Step 2: 在文件顶部导入 `list_all_sessions`**

```python
from openharness.services.session_storage import delete_session_snapshot, list_all_sessions
```

- [ ] **Step 3: 重写 `list_sessions()` 路由**

```python
@router.get("")
async def list_sessions() -> list[SessionSummary]:
    """内存活跃 session 为主，磁盘历史为辅，合并去重后返回。"""
    results: list[SessionSummary] = []
    seen_internal_ids: set[str] = set()

    # ① 内存活跃 session（主）
    for gw_sid in session_mgr.list_ids():
        entry = session_mgr.get_entry(gw_sid)
        if entry is None:
            continue
        state = entry.host.app_state if entry.host.is_ready else None
        title = ""
        if entry.host.is_ready:
            for msg in entry.host.get_messages():
                if getattr(msg, "role", None) == "user":
                    content = getattr(msg, "content", "")
                    if isinstance(content, list):
                        text = " ".join(
                            b.get("text", "") if isinstance(b, dict) else getattr(b, "text", "")
                            for b in content
                            if (isinstance(b, dict) and b.get("type") == "text")
                            or (not isinstance(b, dict) and getattr(b, "type", "") == "text")
                        )
                    else:
                        text = str(content)
                    title = _extract_session_title(text)
                    break
        internal_id = entry.host.get_session_id()
        if internal_id:
            seen_internal_ids.add(internal_id)
        results.append(SessionSummary(
            session_id=gw_sid,
            model=state.model if state else (entry.model or ""),
            cwd=state.cwd if state else (entry.cwd or ""),
            is_managed=_is_managed(entry.cwd),
            ready=entry.host.is_ready,
            created_at=entry.created_at,
            title=title,
            expert_role=entry.expert_role,
            expert_role_label=entry.expert_role_label,
        ))

    # ② 磁盘历史（辅）— 补入内存中没有的
    disk_sessions = await asyncio.to_thread(list_all_sessions)
    for snap in disk_sessions:
        sid = snap.get("session_id", "")
        if not sid or sid in seen_internal_ids:
            continue
        seen_internal_ids.add(sid)
        summary = snap.get("summary", "")
        results.append(SessionSummary(
            session_id=sid,
            model=snap.get("model", ""),
            cwd=snap.get("cwd", ""),
            is_managed=_is_managed(snap.get("cwd")),
            ready=False,
            created_at=snap.get("created_at", 0.0),
            title=summary,
        ))

    results.sort(key=lambda s: s.created_at, reverse=True)
    return results
```

- [ ] **Step 4: 运行网关确认接口可访问（手动）**

启动网关后请求 `GET /api/sessions`，确认：
- 内存中活跃的 session 正常返回
- 磁盘历史 session 出现在列表中（`ready=False`）

- [ ] **Step 5: Commit**

```bash
git add HLAgent/gateway/routers/sessions.py
git commit -m "feat: GET /sessions 合并内存活跃与磁盘历史 session"
```

---

## Task 6: WebSocket — 惰性磁盘恢复路径

**Files:**
- Modify: `HLAgent/gateway/routers/ws.py:26-34`

- [ ] **Step 1: 在文件顶部添加并发锁字典和导入**

在 `_active_event_tasks: dict[str, asyncio.Task] = {}` 之后添加：

```python
# 防止同一 session_id 并发重连时重复从磁盘恢复
_recovery_locks: dict[str, asyncio.Lock] = {}
```

在文件顶部导入区添加：

```python
from hlagent_sdk import AgentSessionConfig, create_host
from openharness.services.session_storage import find_session_by_id
from services.session_manager import session_mgr, SessionEntry
```

（检查是否已有 `create_host` 和 `AgentSessionConfig` 的导入，避免重复）

- [ ] **Step 2: 替换 `websocket_endpoint` 中 `host is None` 的处理分支**

将现有的：

```python
host = session_mgr.get(session_id)
if host is None:
    await websocket.close(code=4004, reason="Session not found")
    return
```

替换为：

```python
host = session_mgr.get(session_id)
if host is None:
    # 尝试从磁盘恢复
    if session_id not in _recovery_locks:
        _recovery_locks[session_id] = asyncio.Lock()
    async with _recovery_locks[session_id]:
        # 加锁后再次检查（可能已被并发请求恢复）
        host = session_mgr.get(session_id)
        if host is None:
            snap = await asyncio.to_thread(find_session_by_id, session_id)
            if snap is None:
                await websocket.close(code=4004, reason="Session not found")
                return
            try:
                config = AgentSessionConfig(
                    model=snap.get("model"),
                    cwd=snap.get("cwd"),
                    permission_mode=snap.get("permission_mode"),
                    api_format=snap.get("api_format"),
                    active_profile=snap.get("active_profile"),
                )
                recovered_host = create_host(config, restore_snapshot=snap)
                session_mgr._sessions[session_id] = SessionEntry(
                    host=recovered_host,
                    cwd=snap.get("cwd"),
                    model=snap.get("model"),
                )
                host = recovered_host
            except Exception as exc:
                log.warning("Failed to recover session %s from disk: %s", session_id, exc)
                await websocket.close(code=4004, reason="Session not found")
                return
```

- [ ] **Step 3: 确认后续代码中 `host` 变量类型一致**

`host` 在恢复后指向 `WebBackendHost`，与原有路径一致，后续代码（`host.is_ready`、`_replay_transcript` 等）无需改动。

- [ ] **Step 4: 清理 `_recovery_locks` — session 删除时移除锁**

在 `session_mgr.remove()` 被调用的地方（`DELETE /sessions` 路由），在 `session_mgr.remove(session_id)` 之后添加：

```python
_recovery_locks.pop(session_id, None)
```

找到位置：`HLAgent/gateway/routers/sessions.py` 中的 `delete_session` 路由，从 `ws.py` 导入 `_recovery_locks`：

```python
# sessions.py 顶部导入
from routers.ws import _recovery_locks
```

然后在 `delete_session` 中：

```python
session_mgr.remove(session_id)
_recovery_locks.pop(session_id, None)  # 新增
```

- [ ] **Step 5: Commit**

```bash
git add HLAgent/gateway/routers/ws.py HLAgent/gateway/routers/sessions.py
git commit -m "feat: WebSocket 惰性磁盘恢复路径，支持网关重启后重连历史 session"
```

---

## Task 7: 测试

**Files:**
- Modify: `tests/test_services/test_session_storage.py`

- [ ] **Step 1: 查看现有测试文件结构**

```bash
cat tests/test_services/test_session_storage.py
```

- [ ] **Step 2: 新增 `find_session_by_id` 测试**

```python
def test_find_session_by_id_found(tmp_path, monkeypatch):
    from openharness.services import session_storage
    monkeypatch.setattr(session_storage, "get_sessions_dir", lambda: tmp_path)

    # 写入一个 session 文件
    proj_dir = tmp_path / "myproject-abc123"
    proj_dir.mkdir()
    sid = "abc123def456"
    (proj_dir / f"session-{sid}.json").write_text(
        '{"session_id": "abc123def456", "cwd": "/tmp/proj", "model": "claude", '
        '"messages": [], "summary": "hello", "message_count": 0, "created_at": 1000.0}',
        encoding="utf-8",
    )

    result = session_storage.find_session_by_id(sid)
    assert result is not None
    assert result["session_id"] == sid
    assert result["cwd"] == "/tmp/proj"


def test_find_session_by_id_not_found(tmp_path, monkeypatch):
    from openharness.services import session_storage
    monkeypatch.setattr(session_storage, "get_sessions_dir", lambda: tmp_path)
    (tmp_path / "proj-abc").mkdir()
    assert session_storage.find_session_by_id("nonexistent") is None


def test_find_session_by_id_corrupt_file(tmp_path, monkeypatch):
    from openharness.services import session_storage
    monkeypatch.setattr(session_storage, "get_sessions_dir", lambda: tmp_path)
    proj_dir = tmp_path / "proj-abc"
    proj_dir.mkdir()
    sid = "abc123def456"
    (proj_dir / f"session-{sid}.json").write_text("not-json", encoding="utf-8")
    assert session_storage.find_session_by_id(sid) is None
```

- [ ] **Step 3: 新增 `list_all_sessions` 测试**

```python
def test_list_all_sessions(tmp_path, monkeypatch):
    from openharness.services import session_storage
    monkeypatch.setattr(session_storage, "get_sessions_dir", lambda: tmp_path)

    # 写入两个项目各一个 session
    for i, (proj, sid, ts) in enumerate([
        ("proj1-aaa", "aaa000000001", 2000.0),
        ("proj2-bbb", "bbb000000002", 1000.0),
    ]):
        d = tmp_path / proj
        d.mkdir()
        (d / f"session-{sid}.json").write_text(
            f'{{"session_id": "{sid}", "cwd": "/tmp/p{i}", "model": "claude", '
            f'"messages": [], "summary": "test", "message_count": 0, "created_at": {ts}}}',
            encoding="utf-8",
        )

    results = session_storage.list_all_sessions()
    assert len(results) == 2
    # 按 created_at 倒序
    assert results[0]["session_id"] == "aaa000000001"
    assert results[1]["session_id"] == "bbb000000002"
```

- [ ] **Step 4: 运行测试**

```bash
cd e:/AI/OpenHarness
python -m pytest tests/test_services/test_session_storage.py -v 2>&1 | tail -30
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_services/test_session_storage.py
git commit -m "test: find_session_by_id 和 list_all_sessions 单元测试"
```

---

## 自检

**Spec 覆盖：**
- [x] `save_session_snapshot` 新增三字段 → Task 1
- [x] `find_session_by_id` 全局扫描 → Task 2
- [x] `list_all_sessions` 扫描所有项目 → Task 2
- [x] `session_backend` 同步签名 → Task 3
- [x] `create_host` 支持 `restore_snapshot` → Task 4
- [x] `GET /sessions` 内存+磁盘合并 → Task 5
- [x] WebSocket 惰性恢复 + 并发锁 → Task 6
- [x] 损坏文件降级 4004 → Task 6 Step 2
- [x] 测试覆盖 → Task 7

**类型一致性：**
- `find_session_by_id` 返回 `dict | None`，Task 6 中 `snap.get()` 用法一致
- `create_host(config, restore_snapshot=snap)` 签名与 Task 4 定义一致
- `SessionEntry(host=..., cwd=..., model=...)` 与 `session_manager.py:13-19` 中的 dataclass 字段一致
