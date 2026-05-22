## ADDED Requirements

### Requirement: session_storage 提供删除快照的接口
`session_storage` 模块 SHALL 提供 `delete_session_snapshot(cwd, session_id)` 函数，用于删除指定 CWD 对应的 session 快照文件，并在 `latest.json` 指向同一 session 时一并清理。

#### Scenario: 删除存在的 session 快照
- **WHEN** 调用 `delete_session_snapshot(cwd="/project", session_id="abc123")` 且 `session-abc123.json` 存在
- **THEN** `session-abc123.json` 被删除，函数正常返回

#### Scenario: 同步删除 latest.json（当其指向同一 session）
- **WHEN** `latest.json` 中 `session_id` 字段值为 `abc123`，且调用 `delete_session_snapshot(cwd, "abc123")`
- **THEN** `latest.json` 也被删除

#### Scenario: latest.json 指向其他 session 时不删除
- **WHEN** `latest.json` 中 `session_id` 字段为 `xyz789`（与被删除 session 不同），调用 `delete_session_snapshot(cwd, "abc123")`
- **THEN** `session-abc123.json` 被删除，`latest.json` 保留不变

#### Scenario: session 快照不存在时静默跳过
- **WHEN** 调用 `delete_session_snapshot(cwd, "nonexistent")` 且对应文件不存在
- **THEN** 函数正常返回，无异常，不影响其他文件

#### Scenario: CWD 为 None 时安全跳过
- **WHEN** 调用 `delete_session_snapshot(None, "abc123")`
- **THEN** 函数立即返回，不做任何文件操作
