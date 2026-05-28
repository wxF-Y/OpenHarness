## Context

两个 bug 均源于 session 列表显示逻辑缺陷：

**Bug 1（expert_role 丢失）**：
- `AgentSessionConfig` / `BackendHostConfig` 中无 `expert_role` / `expert_role_label` 字段
- `runtime.py` 的 4 处 `save_snapshot()` 调用不传这两个字段
- 磁盘 snapshot 中无 expert_role 数据，恢复后显示为空

**Bug 2（member session 混入）**：
- `list_all_sessions()` 扫全量 session 目录，不区分 leader / member
- Swarm 团队运行后，member session 与 leader session 存储结构相同，无自然过滤手段
- `~/.hlagent/teams-tasks/{team}/{run}/team.json` 中 `members[agent_id].session_id` 记录 member 的 **gateway UUID（32-char）**
- member managed workspace 目录名以其 gateway UUID 开头，形如 `{uuid32}-{hash12}`

## Goals / Non-Goals

**Goals:**
- expert_role / expert_role_label 写入 snapshot，磁盘恢复后专家标识正常显示
- `list_all_sessions()` 只返回 leader session，过滤全部 member session

**Non-Goals:**
- 修改前端展示逻辑
- 修改 member session 的存储结构
- 处理 expert_role 以外的其他 gateway 级别元数据

## Decisions

### D1：expert_role 透传路径

将 `expert_role` / `expert_role_label` 加入已有的参数透传链（与 `permission_mode` 等字段同等对待）：

```
AgentSessionConfig（web_host.py）
  → BackendHostConfig（backend_host.py）
  → bundle.config.expert_role（runtime 访问点）
  → save_snapshot(expert_role=...) 的 4 处调用（runtime.py）
  → save_session_snapshot() payload（session_storage.py）
```

同时更新 `SessionBackend` Protocol 和 `OpenHarnessSessionBackend` 实现（session_backend.py）。

gateway 侧在 `create_session` 中将 `req.expert_role` / `req.expert_role_label` 传入 `create_host()`。

### D2：member session 过滤策略

在 `list_all_sessions()` 内构建 member UUID 集合：

```
扫描 ~/.hlagent/teams-tasks/*/team.json
  → 收集所有 members[].session_id（32-char 网关 UUID）
  → 对每个 project_dir：
      若 dir.name 以任意 member UUID 开头 → 跳过整个目录
```

member managed session 的目录命名规律：`{gateway_uuid}-{sha1_hash12}`，其中 `gateway_uuid` 是 32-char hex，匹配 `members[].session_id`。

不扫描 `~/.hlagent/teams/`（静态 team 定义），只扫描 `teams-tasks/`（实际运行记录）。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| team.json 损坏导致 list_all_sessions 抛异常 | try/except 跳过，member 过滤失败时宁可多展示不漏数据 |
| runtime.py 4 处 save_snapshot 遗漏 | 逐一检查所有调用点，若 bundle.config 无 expert_role 字段则传 None |
| 旧 snapshot 无 expert_role 字段 | `.get("expert_role")` 默认 None，向后兼容 |
| teams-tasks 目录不存在 | 检查存在性，不存在时跳过过滤，返回全量结果 |
