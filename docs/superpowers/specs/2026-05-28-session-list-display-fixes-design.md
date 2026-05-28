---
comet_change: session-list-display-fixes
role: technical-design
canonical_spec: openspec
---

## 问题

网关重启后从磁盘恢复历史 session 时出现两个显示缺陷：
1. **expert_role 不显示**：`AgentSessionConfig` / `BackendHostConfig` 无 `expert_role` 字段，snapshot 从未存储，恢复后永远 None
2. **member session 混入列表**：`list_all_sessions()` 扫全量 session 目录，Swarm member session 与 leader session 结构相同，无过滤手段

---

## Bug 1 设计：expert_role 透传链

### 现有透传模式（参照 permission_mode）

项目已有类似字段的完整透传链：

```
AgentSessionConfig.permission_mode
  → create_host() → BackendHostConfig.permission_mode
    → bundle.config.permission_mode
      → save_snapshot(permission_mode=...) × 4处
        → save_session_snapshot(permission_mode=...) → payload
```

### 本次改动：复用同一模式

```
AgentSessionConfig                     新增 expert_role / expert_role_label
  ↓ create_host()
BackendHostConfig                      新增 expert_role / expert_role_label
  ↓ build_runtime()
bundle.config.expert_role              runtime 访问点
  ↓ save_snapshot() × 4处             runtime.py 第659/690/727/738行
SessionBackend.save_snapshot()         Protocol + 实现同步新增
  ↓
save_session_snapshot() payload        session_storage.py
```

**gateway 侧**：`sessions.py` 的 `create_session` 构建 `AgentSessionConfig` 时传入 `expert_role` / `expert_role_label`。

**`list_sessions()` 磁盘路径**：从 snap 读取 `expert_role` / `expert_role_label` 填入 `SessionSummary`。

---

## Bug 2 设计：member session 过滤

### 数据来源

`~/.hlagent/teams-tasks/{team}/{run}/team.json` 结构：

```json
{
  "lead_session_id": "94423082f5f8",       // 12-char OpenHarness 内部 ID（leader）
  "members": {
    "agent-id@team": {
      "session_id": "26332ae6a2a24ef0ae8985f7d5a4a911",  // 32-char 网关 UUID（member）
      "cwd": "C:\\Users\\...\\workspaces\\26332ae6a2a24ef0..."
    }
  }
}
```

### 过滤策略

Member session 的 managed workspace 目录命名规律：`{gateway_uuid}-{sha1_12char}`，其中 `gateway_uuid` = `members[].session_id`（32-char）。

```python
def _get_member_session_prefixes() -> set[str]:
    """收集所有 member 的 gateway UUID，用于目录名前缀过滤。"""
    prefixes: set[str] = set()
    teams_tasks_dir = get_config_dir() / "teams-tasks"
    if not teams_tasks_dir.exists():
        return prefixes
    for team_json in teams_tasks_dir.rglob("team.json"):
        try:
            data = json.loads(team_json.read_text(encoding="utf-8"))
            for member in data.get("members", {}).values():
                sid = member.get("session_id", "") if isinstance(member, dict) else ""
                if sid:
                    prefixes.add(sid)
        except Exception:
            log.warning("Skipping unreadable team.json: %s", team_json)
    return prefixes

# 在 list_all_sessions() 中：
member_prefixes = _get_member_session_prefixes()
for project_dir in sessions_dir.iterdir():
    if any(project_dir.name.startswith(p) for p in member_prefixes):
        continue  # 跳过 member session 目录
    ...
```

### config_dir 获取

`get_config_dir()` 已在 `openharness.config.paths` 中定义，返回 `~/.hlagent`（等同 `OPENHARNESS_CONFIG_DIR`）。

---

## 文件改动范围

| 文件 | 改动 |
|------|------|
| `src/openharness/ui/backend_host.py` | `BackendHostConfig` 新增两字段 |
| `src/openharness/services/session_storage.py` | `save_session_snapshot()` 新增两参数；新增 `_get_member_session_prefixes()`；`list_all_sessions()` 过滤 |
| `src/openharness/services/session_backend.py` | Protocol + 实现同步两参数 |
| `src/openharness/ui/runtime.py` | 4 处 `save_snapshot()` 传入 `expert_role` |
| `HLAgent/sdk/hlagent_sdk/web_host.py` | `AgentSessionConfig` + `create_host()` 透传 |
| `HLAgent/gateway/routers/sessions.py` | `create_session` 传入；`list_sessions` 磁盘路径读取 |

---

## 风险

| 风险 | 缓解 |
|------|------|
| team.json 损坏 | try/except 跳过，member 过滤失败时不影响返回结果 |
| teams-tasks 目录不存在 | 检查存在性，返回空集合 |
| runtime.py 4 处遗漏 | 逐一查找所有 `save_snapshot` 调用点确认 |
| 旧 snapshot 无 expert_role | `.get()` 默认 None，向后兼容 |
