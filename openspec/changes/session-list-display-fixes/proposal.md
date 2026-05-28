## Why

网关重启后从磁盘恢复历史 session 时，出现两个显示缺陷：
1. 专家标识（expert_role / expert_role_label）未显示——这两个字段从未写入 session snapshot 文件，恢复后永远为 None；
2. Swarm 团队 member session 混入 session 列表——`list_all_sessions()` 扫描全部 session 文件时没有过滤 member session，应只列出 leader session。

## What Changes

- **expert_role 写入 snapshot**：将 `expert_role` / `expert_role_label` 添加到 `AgentSessionConfig`、`BackendHostConfig`、`save_session_snapshot()` 签名及 runtime 保存调用链，使这两个字段随对话持久化到磁盘，恢复后可正常显示专家标识。
- **过滤 member session**：`list_all_sessions()` 扫描 `~/.hlagent/teams-tasks/*/team.json`，收集所有 member 的 gateway UUID，进而排除对应的 session 目录（目录名以 member UUID 开头的 managed workspace session）。

## Capabilities

### New Capabilities

- `session-expert-role-persistence`：expert_role / expert_role_label 持久化到 session snapshot，网关重启后恢复时保留专家标识。
- `session-list-member-filter`：`list_all_sessions()` 过滤 Swarm member session，只向前端展示 leader session。

### Modified Capabilities

（无现有规格变更）

## Impact

- `src/openharness/ui/backend_host.py`：`BackendHostConfig` 新增 `expert_role` / `expert_role_label`
- `src/openharness/services/session_storage.py`：`save_session_snapshot()` 新增两字段 + `list_all_sessions()` 增加 member 过滤
- `src/openharness/services/session_backend.py`：`SessionBackend.save_snapshot()` 签名同步
- `src/openharness/ui/runtime.py`：保存 snapshot 时传入 expert_role
- `HLAgent/sdk/hlagent_sdk/web_host.py`：`AgentSessionConfig` 新增两字段，`create_host()` 透传
- `HLAgent/gateway/routers/sessions.py`：`create_session` 将 expert_role 传给 `create_host()`
