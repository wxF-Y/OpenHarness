## 1. BackendHostConfig 和 AgentSessionConfig 新增 expert_role 字段

- [x] 1.1 在 `BackendHostConfig`（`src/openharness/ui/backend_host.py`）添加 `expert_role: str | None = None` 和 `expert_role_label: str | None = None`
- [x] 1.2 在 `AgentSessionConfig`（`HLAgent/sdk/hlagent_sdk/web_host.py`）添加同样两个字段
- [x] 1.3 修改 `create_host()` 将 `config.expert_role` / `config.expert_role_label` 传入 `BackendHostConfig`

## 2. save_session_snapshot 新增 expert_role 字段

- [x] 2.1 `save_session_snapshot()`（`src/openharness/services/session_storage.py`）新增两参数，写入 payload
- [x] 2.2 `SessionBackend.save_snapshot()` Protocol（`src/openharness/services/session_backend.py`）同步新增两个参数
- [x] 2.3 `OpenHarnessSessionBackend.save_snapshot()` 实现透传两个参数

## 3. runtime.py 保存 snapshot 时传入 expert_role

- [x] 3.1 `RuntimeBundle` 新增两字段；`build_runtime()` 签名 + 构建透传
- [x] 3.2 修改 `runtime.py` 中所有 4 处 `bundle.session_backend.save_snapshot()` 调用，添加 `expert_role`/`expert_role_label`
- [x] 3.3 修改 `backend_host.py` 中断路径 `save_snapshot()` 调用，补充两字段

## 4. create_session 传入 expert_role 到 AgentSessionConfig + 磁盘读取

- [x] 4.1 在 `sessions.py` 的 `create_session` 中，构建 `AgentSessionConfig` 时加入两字段
- [x] 4.2 在 `list_sessions()` 磁盘历史部分，从 snap 读取 `expert_role`/`expert_role_label` 填入 `SessionSummary`

## 5. list_all_sessions 过滤 member session

- [x] 5.1 新增 `_get_member_session_prefixes()`：扫描 `~/.hlagent/teams-tasks/**/team.json`，收集 member gateway UUID
- [x] 5.2 `list_all_sessions()` 循环内跳过以 member UUID 开头的目录
- [x] 5.3 单元测试：leader 保留、member 过滤、corrupt team.json 跳过（手动验收见 verify 阶段）
