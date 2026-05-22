## Context

HLAgent 使用两套 ID 系统：
- **外部 HLAgent session_id**（32-char UUID hex）：由 Gateway 分配，用于 REST/WebSocket API。
- **内部 OpenHarness session_id**（12-char hex）：由 OpenHarness 引擎分配，存储在 `~/.openharness/data/sessions/<project-name-sha1>/session-<id>.json`。

`delete_session` handler 目前清理了：内存中的 `SessionEntry`、managed workspace 目录（仅限 CWD 在 workspaces root 下时）。但未清理持久化的 session 快照文件。

`WebBackendHost.get_session_id()` 方法可在 host 运行后返回 OpenHarness 内部 session_id（来自 `_bundle.session_id`）。

## Goals / Non-Goals

**Goals:**
- 删除 session 时，同步删除 `~/.openharness/data/sessions/` 下对应的 `session-<internal-id>.json`。
- 若 `latest.json` 指向同一 session，也一并删除。
- 在 `session_storage.py` 中封装删除逻辑，保持 router 层整洁。

**Non-Goals:**
- 不删除整个项目的 session 目录（`<project-name-sha1>/`），其他 session 快照应保留。
- 不修改 Web UI 前端。
- 不处理历史 Gateway 进程遗留的（孤立的）session 文件（超出本次修复范围）。

## Decisions

### D1：在哪里删除文件？

**决定**：在 `session_storage.py` 中新增 `delete_session_snapshot(cwd, session_id)` 函数，由 `sessions.py` 的 handler 调用。

**理由**：session_storage 已封装了所有对 `~/.openharness/data/sessions/` 的读写操作，新增删除函数符合单一职责原则。router 层不应直接操作底层文件路径。

**备选方案**：直接在 router 的 `delete_session` 中内联文件删除逻辑 — 拒绝，因为这会让 router 耦合底层存储细节。

### D2：何时获取 OpenHarness 内部 session_id？

**决定**：在 `await entry.host.stop()` **之前**，先通过 `entry.host.get_session_id()` 获取内部 session_id。

**理由**：`stop()` 会触发 shutdown 流程，`_bundle` 可能在 stop 后被清理，导致 `get_session_id()` 返回 `None`。

### D3：`latest.json` 的处理

**决定**：在 `delete_session_snapshot` 中，读取 `latest.json` 内容，若其 `session_id` 字段与被删除的 session 一致，则同时删除 `latest.json`。

**理由**：`latest.json` 是对最新快照的软引用，删除后不再保留悬空引用。

## Risks / Trade-offs

- **[风险] host 未就绪时 session_id 为 None**：若用户在 host 尚未完成 `build_runtime` 时删除 session，`get_session_id()` 返回 `None`，此时没有对应的 snapshot 文件可删（文件只在首次保存后才存在），可安全跳过。
- **[风险] CWD 为 None**：session 创建时若未设置 CWD，`session_storage` 无法定位 session 目录，需 guard。
- **[Trade-off] 仅删当前 session，不扫描所有孤立文件**：保守策略，避免误删。

## Migration Plan

无需数据迁移。此变更只影响新的删除操作，不改变现有文件结构。

## Open Questions

无。
