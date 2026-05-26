## Why

当前 Swarm 工具命名不统一（`swarm_*` 和 `read_mailbox` 混用），且缺失 s15/s16 中已验证的三个核心协作模式：**带 request_id 的请求-响应协议**、**Task 依赖链**和**计划审批流程**，导致 Leader 无法追踪 Teammate 是否按计划执行，并发任务缺乏顺序保证。

## What Changes

- **BREAKING** 将所有 `swarm_*` 工具及 `read_mailbox` 统一重命名为 `team_*` 前缀（8 个工具重命名）
- 新增 `ProtocolRequestState` 数据模型，为 Leader-Teammate 消息引入 `request_id` 追踪
- 新增 `team_request_plan` 工具：Leader 请求 Teammate 提交执行计划
- 新增 `team_review_plan` 工具：Leader 审批或拒绝计划（支持附反馈文本）
- 新增 `team_request_shutdown` 工具：带确认机制的优雅关闭（替换单向 shutdown）
- 为 `team_spawn_member` 增加 `blocked_by` 参数，支持任务依赖链
- 更新 Leader 系统提示词，反映新工具集和工作流程
- 新增 `plan_approval_request` / `plan_approval_response` 消息类型到 `MailboxMessage.type`

## Capabilities

### New Capabilities

- `swarm-tool-naming`: 统一 `team_*` 前缀，覆盖所有 Swarm/团队工具的重命名及注册
- `swarm-protocol-state`: 请求-响应协议状态机，含 request_id 追踪和 pending_requests 管理
- `swarm-plan-approval`: Teammate 提交计划、Leader 审批/拒绝的完整流程
- `swarm-task-dependency`: `team_spawn_member` 的 `blocked_by` 参数与依赖调度逻辑

### Modified Capabilities

（无 spec 级别的需求变更，均为新增能力）

## Impact

- `src/openharness/tools/` — 8 个文件重命名（`swarm_*` → `team_*`），新增 3 个工具文件
- `src/openharness/tools/__init__.py` — import 路径及注册列表更新
- `src/openharness/swarm/mailbox.py` — 新增消息类型 `plan_approval_request` / `plan_approval_response`
- `src/openharness/swarm/protocol.py` — 新文件，`ProtocolRequestState` 数据类
- `src/openharness/swarm/swarm_service.py` — Leader 系统提示词中工具名全量替换
- `HLAgent/gateway/routers/swarm.py` — REST API 文档字符串中工具名更新（非功能性）
- 不影响 `swarm-chatpage-member-view` 的前端逻辑（消息类型向后兼容）
