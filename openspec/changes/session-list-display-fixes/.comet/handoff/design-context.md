# Comet Design Handoff

- Change: session-list-display-fixes
- Phase: design
- Mode: compact
- Context hash: 35d14e424e113ede84b8009daf669029da594313e8a2bc2312ffcd3c0bc31bbd

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/session-list-display-fixes/proposal.md

- Source: openspec/changes/session-list-display-fixes/proposal.md
- Lines: 1-30
- SHA256: 99dede5b55715894e38c461cf5ab4b4b9aeba31b6f6d91b8bccfdb0bbf26594e

```md
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
```

## openspec/changes/session-list-display-fixes/design.md

- Source: openspec/changes/session-list-display-fixes/design.md
- Lines: 1-67
- SHA256: f102ac6d256dac7b7dbcd0ba3bcd74e48b2b775472e01555b7c1ee91a604e9ba

```md
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
```

## openspec/changes/session-list-display-fixes/tasks.md

- Source: openspec/changes/session-list-display-fixes/tasks.md
- Lines: 1-33
- SHA256: 039c6fc4bee525a988447e8c07681f5944322576004532a4dc916db5b05bf377

```md
## 1. BackendHostConfig 和 AgentSessionConfig 新增 expert_role 字段

- [ ] 1.1 在 `BackendHostConfig`（`src/openharness/ui/backend_host.py`）添加 `expert_role: str | None = None` 和 `expert_role_label: str | None = None`
- [ ] 1.2 在 `AgentSessionConfig`（`HLAgent/sdk/hlagent_sdk/web_host.py`）添加同样两个字段
- [ ] 1.3 修改 `create_host()` 将 `config.expert_role` / `config.expert_role_label` 传入 `BackendHostConfig`

## 2. save_session_snapshot 新增 expert_role 字段

- [ ] 2.1 `save_session_snapshot()`（`src/openharness/services/session_storage.py`）新增 `expert_role: str | None = None` 和 `expert_role_label: str | None = None` 参数，写入 payload
- [ ] 2.2 `SessionBackend.save_snapshot()` Protocol（`src/openharness/services/session_backend.py`）同步新增两个参数
- [ ] 2.3 `OpenHarnessSessionBackend.save_snapshot()` 实现透传两个参数

## 3. runtime.py 保存 snapshot 时传入 expert_role

- [ ] 3.1 确认 `bundle.config` 可访问 `expert_role` / `expert_role_label`（来自 `BackendHostConfig`）
- [ ] 3.2 修改 `runtime.py` 中所有 4 处 `bundle.session_backend.save_snapshot()` 调用，添加 `expert_role=bundle.config.expert_role, expert_role_label=bundle.config.expert_role_label`

## 4. create_session 传入 expert_role 到 create_host

- [ ] 4.1 在 `sessions.py` 的 `create_session` 中，构建 `AgentSessionConfig` 时加入 `expert_role=req.expert_role, expert_role_label=req.expert_role_label`
- [ ] 4.2 在 `list_sessions()` 磁盘历史部分，从 snap 读取 `expert_role` / `expert_role_label` 填入 `SessionSummary`

## 5. list_all_sessions 过滤 member session

- [ ] 5.1 在 `session_storage.py` 新增辅助函数 `_get_member_session_prefixes() -> set[str]`：扫描 `~/.hlagent/teams-tasks/*/team.json`，收集所有 `members[].session_id`（32-char gateway UUID），返回 UUID 集合
- [ ] 5.2 在 `list_all_sessions()` 中调用该函数，对每个 `project_dir`：若 `project_dir.name` 以任意 member UUID 开头则跳过

## 6. 测试

- [ ] 6.1 单元测试：`_get_member_session_prefixes()` 正确读取 / 损坏文件跳过 / 目录不存在时返回空集合
- [ ] 6.2 单元测试：`list_all_sessions()` 不返回 member session 目录中的 session
- [ ] 6.3 手动验收：创建带 expert_role 的 session → 对话 → 重启网关 → 前端列表中该 session 显示专家标识
- [ ] 6.4 手动验收：团队任务运行后重启网关 → 前端列表只显示 leader session，不显示 member session
```

## openspec/changes/session-list-display-fixes/specs/session-expert-role-persistence/spec.md

- Source: openspec/changes/session-list-display-fixes/specs/session-expert-role-persistence/spec.md
- Lines: 1-16
- SHA256: cd3c71025a75cee2f701c26d6b480d5203f61a16eee9e651c50c4cb5af8059c1

```md
## ADDED Requirements

### Requirement: expert_role 持久化到 session snapshot
系统 SHALL 将 `expert_role` 和 `expert_role_label` 写入 session snapshot 文件，使网关重启后从磁盘恢复的 session 能保留专家标识。

#### Scenario: 新建带专家角色的 session 后对话，重启网关，专家标识可见
- **WHEN** 用户以带 `expert_role` 的配置创建 session，进行对话后网关重启，前端调用 `GET /sessions`
- **THEN** 该历史 session 在列表中展示 `expert_role` 和 `expert_role_label`，与重启前一致

#### Scenario: 无专家角色的 session 不受影响
- **WHEN** 创建 session 时未传 `expert_role`
- **THEN** snapshot 中 `expert_role` 为 null，恢复后正常显示（无专家标识），不报错

#### Scenario: 旧 snapshot 文件无 expert_role 字段时向后兼容
- **WHEN** 读取不含 `expert_role` 字段的旧 snapshot 文件
- **THEN** 系统返回 `expert_role: null`，不抛异常，session 正常展示
```

## openspec/changes/session-list-display-fixes/specs/session-list-member-filter/spec.md

- Source: openspec/changes/session-list-display-fixes/specs/session-list-member-filter/spec.md
- Lines: 1-16
- SHA256: 2b9740551263a46518960e40d5f90fdf8a3c9db8ef4927f9b60bc2373972522a

```md
## ADDED Requirements

### Requirement: list_all_sessions 过滤 Swarm member session
`list_all_sessions()` SHALL 只返回 leader session，过滤掉 Swarm 团队运行中产生的 member session。

#### Scenario: 有团队任务运行时，member session 不出现在列表
- **WHEN** 存在 `~/.hlagent/teams-tasks/*/team.json`，其中 `members[].session_id` 为 member 的 gateway UUID
- **THEN** `list_all_sessions()` 不包含这些 member session，只返回 leader session 和普通独立 session

#### Scenario: 无团队任务时，行为不变
- **WHEN** `~/.hlagent/teams-tasks/` 目录不存在或为空
- **THEN** `list_all_sessions()` 行为与原来完全一致，返回全量扫描结果

#### Scenario: team.json 损坏时安全降级
- **WHEN** `~/.hlagent/teams-tasks/*/team.json` 存在但内容无法解析（JSON 损坏）
- **THEN** 系统跳过该文件，记录 WARNING，继续处理其他 team.json，不影响 `list_all_sessions()` 返回结果
```

