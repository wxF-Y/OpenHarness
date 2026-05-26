## Why

12 个 `team_*` 工具的描述不够清晰：部分仍残留 "swarm" 术语、缺乏工作流顺序引导、`team_create` 与 `team_create_run` 语义混淆，导致 Leader LLM 难以正确选择和组合工具完成团队协作任务。

## What Changes

- 统一工具描述中的术语，将所有 "swarm team member" 替换为 "team member"
- 为核心工作流工具添加顺序标注（Step 1/2/3…），明确调用链
- 区分 `team_create`（内存协调团队）与 `team_create_run`（文件型任务运行，Swarm 主流程）
- 优化 `team_wait` 与 `team_read_mailbox` 的使用场景说明，避免混淆
- 改善新增工具（`team_request_plan`、`team_review_plan`、`team_request_shutdown`）的实用性描述，增加使用时机说明

## Capabilities

### New Capabilities
（无新能力）

### Modified Capabilities
（无 spec 级别变更，均为工具描述调优）

## Impact

- `src/openharness/tools/team_*.py`（12 个文件，仅修改 `description` 字段和 input field `description`）
- `src/openharness/swarm/swarm_service.py`（Leader 系统提示词与工具描述联动更新）
