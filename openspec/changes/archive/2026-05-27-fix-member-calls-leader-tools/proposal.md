## Why

测试中发现：Member（investment-researcher）调用了只属于 Leader 的协调工具：
- `team_read_mailbox team=111`（读取了 Leader 的收件箱，而非自己的任务收件箱）
- `team_wait team=111`（无 `run_id` 导致报错）

这导致 Leader 在 member 未完成时就已经汇总（因 `team_wait` 超时或 member 发送了错误的消息），而 member 仍在后台运行。

**根因：** `team_spawn_member_tool.py` 的 `member_system` 提示词没有明确禁止 member 调用协调工具（`team_wait`、`team_read_mailbox`、`team_create_run` 等）。Member 持有全部工具的访问权，LLM 会错误地调用这些工具。

## What Changes

- 更新 `team_spawn_member_tool.py` 的 `member_system` 提示词，明确禁止 member 调用协调工具列表
- 在提示词中传入 `run_id`，供 member 在必要时正确引用（但不建议调用协调工具）

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
（`swarm-task-dependency` 的 member spawn behavior 有行为变化，但 spec 层面无新验收场景需要补充）

## Impact

- `src/openharness/tools/team_spawn_member_tool.py`（1 个文件，仅修改 `member_system` 字符串）
