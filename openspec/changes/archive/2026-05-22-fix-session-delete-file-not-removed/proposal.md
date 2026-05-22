## Why

当用户在 HLAgent Web UI 中点击删除 session 时，Gateway 的 `DELETE /api/sessions/{session_id}` 接口只停止了内存中的 `WebBackendHost` 实例并清理了 managed workspace 目录，但未删除 OpenHarness 持久化到 `~/.openharness/data/sessions/` 下的 session 快照文件（`session-<id>.json`、`latest.json`）。这导致历史 session 文件不断积累，且无法通过 UI 清理。

## What Changes

- 在 `session_storage.py` 中新增 `delete_session_snapshot` 辅助函数，用于删除指定 CWD 下的某个 session 快照文件，并在该文件是最新快照时同步更新 `latest.json`。
- 在 `sessions.py` 的 `delete_session` handler 中，在停止 host 之前先获取 OpenHarness 内部 session_id，然后调用上述函数删除对应的快照文件。

## Capabilities

### New Capabilities

- `session-file-deletion`: 删除 session 时同步清理 `~/.openharness/data/sessions/` 下的持久化快照文件。

### Modified Capabilities

- `hlagent-gateway`: `DELETE /api/sessions/{session_id}` 接口的行为扩展，新增删除持久化文件的步骤。

## Impact

- 影响文件：
  - `HLAgent/gateway/routers/sessions.py`（`delete_session` handler）
  - `src/openharness/services/session_storage.py`（新增 `delete_session_snapshot`）
- 不影响 Web UI 前端（前端已正确调用 DELETE API）
- 不影响 `session-cwd-cleanup` 逻辑（managed workspace 目录清理逻辑独立）
