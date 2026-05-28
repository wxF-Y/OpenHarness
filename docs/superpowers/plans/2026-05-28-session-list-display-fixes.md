# Session List Display Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复两个 session 列表显示 bug：网关重启后磁盘恢复的 session 不显示 expert_role 专家标识；Swarm 团队 member session 混入列表。

**Architecture:** Bug 1 沿现有 permission_mode 透传链（AgentSessionConfig → BackendHostConfig → build_runtime → RuntimeBundle → save_snapshot）新增 expert_role / expert_role_label 字段；Bug 2 在 list_all_sessions() 中扫描 teams-tasks/*/team.json 构建 member UUID 集合，按目录名前缀过滤。

**Tech Stack:** Python dataclasses, FastAPI, asyncio, pathlib

---

```yaml
change: session-list-display-fixes
design-doc: docs/superpowers/specs/2026-05-28-session-list-display-fixes-design.md
base-ref: 9150e7dcc58a34329338fc7227d0b8588cd94308
```

---

## 文件改动地图

| 文件 | 改动 |
|------|------|
| `src/openharness/ui/backend_host.py` | `BackendHostConfig` 新增 `expert_role`/`expert_role_label`；`ReactBackendHost._build_runtime()` 透传 |
| `src/openharness/ui/runtime.py` | `build_runtime()` 签名 + `RuntimeBundle` 新增两字段；4 处 `save_snapshot()` 传入 |
| `src/openharness/services/session_storage.py` | `save_session_snapshot()` 新增两参数；新增 `_get_member_session_prefixes()`；`list_all_sessions()` 过滤 |
| `src/openharness/services/session_backend.py` | Protocol + 实现同步两参数 |
| `HLAgent/sdk/hlagent_sdk/web_host.py` | `AgentSessionConfig` + `create_host()` 新增两字段透传 |
| `HLAgent/gateway/routers/sessions.py` | `create_session` 将 expert_role 写入 `AgentSessionConfig`；`list_sessions` 磁盘路径读取 expert_role |

---

## Task 1: AgentSessionConfig + create_host 新增 expert_role 字段

**Files:**
- Modify: `HLAgent/sdk/hlagent_sdk/web_host.py:26-37`（AgentSessionConfig）
- Modify: `HLAgent/sdk/hlagent_sdk/web_host.py:390-411`（create_host）

- [ ] **Step 1: AgentSessionConfig 新增两字段**

将 `AgentSessionConfig`（第 26-37 行）改为：

```python
@dataclass
class AgentSessionConfig:
    """Configuration for one HLAgent session."""

    model: str | None = None
    cwd: str | None = None
    permission_mode: str | None = None
    system_prompt: str | None = None
    max_turns: int | None = None
    api_key: str | None = None
    api_format: str | None = None
    active_profile: str | None = None
    expert_role: str | None = None        # 新增
    expert_role_label: str | None = None  # 新增
```

- [ ] **Step 2: create_host() 透传两字段到 BackendHostConfig**

将 `create_host()` 中的 `BackendHostConfig(...)` 调用添加两个字段：

```python
def create_host(
    config: AgentSessionConfig,
    restore_snapshot: dict | None = None,
) -> WebBackendHost:
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
        expert_role=config.expert_role or snap.get("expert_role"),          # 新增
        expert_role_label=config.expert_role_label or snap.get("expert_role_label"),  # 新增
    )
    return WebBackendHost(host_config)
```

- [ ] **Step 3: Commit**

```bash
git add HLAgent/sdk/hlagent_sdk/web_host.py
git commit -m "feat: AgentSessionConfig + create_host 新增 expert_role/expert_role_label"
```

---

## Task 2: BackendHostConfig + build_runtime 新增 expert_role 字段

**Files:**
- Modify: `src/openharness/ui/backend_host.py:50-70`（BackendHostConfig）
- Modify: `src/openharness/ui/backend_host.py:95-115`（ReactBackendHost._build_runtime 调用）
- Modify: `src/openharness/ui/runtime.py`（build_runtime 函数签名 + RuntimeBundle + 4处save_snapshot）

- [ ] **Step 1: BackendHostConfig 新增两字段**

在 `BackendHostConfig` dataclass（第 50-70 行）中，在 `include_project_memory` 之后添加：

```python
    expert_role: str | None = None
    expert_role_label: str | None = None
```

- [ ] **Step 2: ReactBackendHost._build_runtime 透传两字段**

在 `backend_host.py` 约第 95-115 行的 `build_runtime(...)` 调用中添加：

```python
        expert_role=self._config.expert_role,
        expert_role_label=self._config.expert_role_label,
```

- [ ] **Step 3: RuntimeBundle 新增两字段**

在 `runtime.py` 的 `RuntimeBundle` dataclass（第 121 行起）中，在 `include_project_memory` 字段之后添加：

```python
    expert_role: str | None = None
    expert_role_label: str | None = None
```

- [ ] **Step 4: build_runtime() 函数签名新增两参数**

在 `build_runtime()` 函数定义（约第 315 行）中，在 `autodream_context` 参数之后添加：

```python
    expert_role: str | None = None,
    expert_role_label: str | None = None,
```

并在 `return RuntimeBundle(...)` 中添加：

```python
        expert_role=expert_role,
        expert_role_label=expert_role_label,
```

- [ ] **Step 5: 4 处 save_snapshot() 调用添加 expert_role**

修改 `runtime.py` 第 659、690、727、738 行的 4 处 `bundle.session_backend.save_snapshot()` 调用，每处添加：

```python
            expert_role=bundle.expert_role,
            expert_role_label=bundle.expert_role_label,
```

- [ ] **Step 6: Commit**

```bash
git add src/openharness/ui/backend_host.py src/openharness/ui/runtime.py
git commit -m "feat: BackendHostConfig + RuntimeBundle + build_runtime 透传 expert_role"
```

---

## Task 3: session_storage + session_backend 新增 expert_role 字段

**Files:**
- Modify: `src/openharness/services/session_storage.py:64-113`
- Modify: `src/openharness/services/session_backend.py:20-77`

- [ ] **Step 1: save_session_snapshot() 新增两参数并写入 payload**

在 `save_session_snapshot()` 签名（第 64 行）中添加：

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
    permission_mode: str | None = None,
    api_format: str | None = None,
    active_profile: str | None = None,
    expert_role: str | None = None,        # 新增
    expert_role_label: str | None = None,  # 新增
) -> Path:
```

在 payload 字典（`active_profile` 之后）添加：

```python
        "expert_role": expert_role,
        "expert_role_label": expert_role_label,
```

- [ ] **Step 2: SessionBackend Protocol 同步两参数**

在 `session_backend.py` 的 `SessionBackend.save_snapshot()` 方法定义中添加：

```python
        expert_role: str | None = None,
        expert_role_label: str | None = None,
```

- [ ] **Step 3: OpenHarnessSessionBackend.save_snapshot() 透传两参数**

在实现中添加接收和透传：

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
        expert_role: str | None = None,
        expert_role_label: str | None = None,
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
            expert_role=expert_role,
            expert_role_label=expert_role_label,
        )
```

- [ ] **Step 4: 运行现有测试确认不破坏**

```bash
cd e:/AI/OpenHarness && python -m pytest tests/test_services/test_session_storage.py -v 2>&1 | tail -15
```

Expected: 所有现有测试 PASS

- [ ] **Step 5: Commit**

```bash
git add src/openharness/services/session_storage.py src/openharness/services/session_backend.py
git commit -m "feat: save_session_snapshot + SessionBackend 新增 expert_role/expert_role_label"
```

---

## Task 4: sessions.py 透传 expert_role 给 AgentSessionConfig + 磁盘路径读取

**Files:**
- Modify: `HLAgent/gateway/routers/sessions.py:207-231`（create_session）
- Modify: `HLAgent/gateway/routers/sessions.py`（list_sessions 磁盘路径）

- [ ] **Step 1: create_session 将 expert_role 写入 AgentSessionConfig**

将第 209-218 行的 `AgentSessionConfig(...)` 调用改为：

```python
    config = AgentSessionConfig(
        model=req.model,
        cwd=actual_cwd,
        permission_mode=req.permission_mode,
        system_prompt=full_sp,
        max_turns=req.max_turns,
        api_key=req.api_key,
        api_format=req.api_format,
        active_profile=req.active_profile,
        expert_role=req.expert_role,              # 新增
        expert_role_label=req.expert_role_label,  # 新增
    )
```

- [ ] **Step 2: list_sessions 磁盘路径从 snap 读取 expert_role**

在 `list_sessions()` 的磁盘历史路径（`SessionSummary(session_id=sid, ...)` 处），添加两个字段：

```python
        results.append(SessionSummary(
            session_id=sid,
            model=snap.get("model", ""),
            cwd=snap.get("cwd", ""),
            is_managed=_is_managed(snap.get("cwd")),
            ready=False,
            created_at=snap.get("created_at", 0.0),
            title=summary,
            expert_role=snap.get("expert_role"),              # 新增
            expert_role_label=snap.get("expert_role_label"),  # 新增
        ))
```

- [ ] **Step 3: Commit**

```bash
git add HLAgent/gateway/routers/sessions.py
git commit -m "feat: sessions.py expert_role 透传 AgentSessionConfig + 磁盘路径读取"
```

---

## Task 5: list_all_sessions 过滤 member session

**Files:**
- Modify: `src/openharness/services/session_storage.py`（新增辅助函数 + 过滤逻辑）

- [ ] **Step 1: 新增 _get_member_session_prefixes()**

在 `list_all_sessions()` 函数之前（约第 244 行之前）添加：

```python
def _get_member_session_prefixes() -> set[str]:
    """扫描 teams-tasks/*/team.json，收集所有 member 的 gateway UUID。"""
    from openharness.config.paths import get_config_dir
    prefixes: set[str] = set()
    teams_tasks_dir = get_config_dir() / "teams-tasks"
    if not teams_tasks_dir.exists():
        return prefixes
    for team_json in teams_tasks_dir.rglob("team.json"):
        try:
            data = json.loads(team_json.read_text(encoding="utf-8"))
            for member in data.get("members", {}).values():
                if isinstance(member, dict):
                    sid = member.get("session_id", "")
                    if sid:
                        prefixes.add(sid)
        except Exception:
            log.warning("Skipping unreadable team.json: %s", team_json)
    return prefixes
```

- [ ] **Step 2: list_all_sessions() 过滤 member 目录**

在 `list_all_sessions()` 中，在 `for project_dir in sessions_dir.iterdir():` 循环开头添加过滤：

```python
def list_all_sessions() -> list[dict[str, Any]]:
    """扫描所有项目目录下的 session-*.json，返回轻量摘要列表，按 created_at 倒序。"""
    sessions_dir = get_sessions_dir()
    results: list[dict[str, Any]] = []
    if not sessions_dir.exists():
        return results
    member_prefixes = _get_member_session_prefixes()
    for project_dir in sessions_dir.iterdir():
        if not project_dir.is_dir():
            continue
        # 跳过 Swarm member session 目录（目录名以 member gateway UUID 开头）
        if member_prefixes and any(project_dir.name.startswith(p) for p in member_prefixes):
            continue
        for path in project_dir.glob("session-*.json"):
            ...（保持原有逻辑不变）
```

- [ ] **Step 3: 运行测试**

```bash
cd e:/AI/OpenHarness && python -m pytest tests/test_services/test_session_storage.py -v 2>&1 | tail -15
```

Expected: 所有现有测试 PASS

- [ ] **Step 4: 新增过滤 member session 的单元测试**

在 `tests/test_services/test_session_storage.py` 末尾追加：

```python
def test_list_all_sessions_filters_member_sessions(tmp_path, monkeypatch):
    from openharness.services import session_storage
    from openharness.config import paths as config_paths
    monkeypatch.setattr(session_storage, "get_sessions_dir", lambda: tmp_path)

    # 写一个 member UUID
    member_uuid = "abcdef1234567890abcdef1234567890"
    # 模拟 teams-tasks 目录
    teams_tasks = tmp_path.parent / "teams-tasks-test"
    teams_tasks.mkdir()
    run_dir = teams_tasks / "team1" / "run1"
    run_dir.mkdir(parents=True)
    (run_dir / "team.json").write_text(
        f'{{"lead_session_id": "aaa000000001", "members": {{"agent@team": {{"session_id": "{member_uuid}"}}}}}}'
        , encoding="utf-8"
    )
    # 模拟 get_config_dir 返回 tmp_path.parent
    fake_config = tmp_path.parent
    (fake_config / "teams-tasks").mkdir(exist_ok=True)
    # 复制 team.json 到正确位置
    import shutil
    shutil.copytree(str(teams_tasks), str(fake_config / "teams-tasks"), dirs_exist_ok=True)
    monkeypatch.setattr(config_paths, "get_config_dir", lambda: fake_config)

    # 创建 leader session 目录（正常名称）
    leader_dir = tmp_path / "myproject-aaa111"
    leader_dir.mkdir()
    (leader_dir / "session-aaa000000001.json").write_text(
        '{"session_id": "aaa000000001", "cwd": "/tmp/proj", "model": "claude", '
        '"messages": [], "summary": "leader", "message_count": 0, "created_at": 2000.0}',
        encoding="utf-8",
    )

    # 创建 member session 目录（名称以 member UUID 开头）
    member_dir = tmp_path / f"{member_uuid}-bbb222333444"
    member_dir.mkdir()
    (member_dir / "session-bbb000000002.json").write_text(
        '{"session_id": "bbb000000002", "cwd": "/tmp/workspace", "model": "claude", '
        '"messages": [], "summary": "member", "message_count": 0, "created_at": 1000.0}',
        encoding="utf-8",
    )

    results = session_storage.list_all_sessions()
    sids = [r["session_id"] for r in results]
    assert "aaa000000001" in sids
    assert "bbb000000002" not in sids
```

- [ ] **Step 5: 运行新测试确认通过**

```bash
cd e:/AI/OpenHarness && python -m pytest tests/test_services/test_session_storage.py::test_list_all_sessions_filters_member_sessions -v 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/openharness/services/session_storage.py tests/test_services/test_session_storage.py
git commit -m "feat: list_all_sessions 过滤 Swarm member session"
```

---

## 自检

**Spec 覆盖：**
- [x] expert_role 写入 snapshot → Task 1-3
- [x] 磁盘恢复时读取 expert_role → Task 4
- [x] 旧 snapshot 向后兼容（`.get()` 默认 None）→ Task 3 Step 1
- [x] list_all_sessions 过滤 member session → Task 5
- [x] teams-tasks 不存在时返回空集合 → Task 5 Step 1
- [x] team.json 损坏跳过 → Task 5 Step 1

**类型一致性：**
- `expert_role: str | None = None` 贯穿所有文件
- `snap.get("expert_role")` 返回 `str | None`，与 `SessionSummary.expert_role: str | None` 一致
- `_get_member_session_prefixes()` 返回 `set[str]`，`startswith()` 接受 `str`，类型匹配
