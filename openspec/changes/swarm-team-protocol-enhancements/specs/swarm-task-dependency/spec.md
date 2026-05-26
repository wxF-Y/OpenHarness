## ADDED Requirements

### Requirement: team_spawn_member 支持 blocked_by 依赖参数

系统 SHALL 在 `team_spawn_member` 工具中支持可选的 `blocked_by` 参数（成员名列表），当指定时，工具等待所有被依赖的成员完成后才 spawn 目标成员。

#### Scenario: 无依赖时立即 spawn

- **WHEN** Leader 调用 `team_spawn_member(... blocked_by=None)` 或不传 `blocked_by`
- **THEN** 系统立即 spawn 目标成员，行为与之前相同

#### Scenario: 依赖成员已完成时立即 spawn

- **WHEN** Leader 调用 `team_spawn_member(... blocked_by=["researcher"])` 且 `researcher@team` 已处于 `completed` 状态
- **THEN** 系统立即 spawn 目标成员，不等待

#### Scenario: 依赖成员未完成时轮询等待

- **WHEN** Leader 调用 `team_spawn_member(... blocked_by=["researcher"])` 且 `researcher@team` 仍在运行
- **THEN** 系统以 3 秒间隔轮询 task manager 和 Leader mailbox（检查 `idle_notification`），等待 `researcher` 完成后再 spawn 目标成员

#### Scenario: 等待超时时返回错误

- **WHEN** Leader 调用含 `blocked_by` 的 `team_spawn_member`，等待超过 `timeout`（默认 120 秒）
- **THEN** 工具返回 `is_error=True`，内容说明哪些依赖成员未在超时内完成

#### Scenario: 被依赖成员失败时返回错误

- **WHEN** 被依赖的成员任务以 `failed` 或 `killed` 状态结束
- **THEN** 工具返回 `is_error=True`，内容说明依赖成员失败，目标成员未被 spawn
