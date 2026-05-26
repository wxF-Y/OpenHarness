## 1. 工具重命名（Breaking Change 准备）

- [x] 1.1 将 `swarm_create_run_tool.py` 重命名为 `team_create_run_tool.py`，更新类名为 `TeamCreateRunTool`，`name = "team_create_run"`
- [x] 1.2 将 `swarm_list_members_tool.py` 重命名为 `team_list_members_tool.py`，更新类名和 `name` 字段
- [x] 1.3 将 `swarm_send_message_tool.py` 重命名为 `team_send_message_tool.py`，更新类名和 `name` 字段
- [x] 1.4 将 `swarm_shutdown_member_tool.py` 重命名为 `team_shutdown_member_tool.py`，更新类名和 `name` 字段
- [x] 1.5 将 `swarm_spawn_member_tool.py` 重命名为 `team_spawn_member_tool.py`，更新类名和 `name` 字段
- [x] 1.6 将 `swarm_wait_tool.py` 重命名为 `team_wait_tool.py`，更新类名和 `name` 字段
- [x] 1.7 将 `read_mailbox_tool.py` 重命名为 `team_read_mailbox_tool.py`，更新类名为 `TeamReadMailboxTool`，`name = "team_read_mailbox"`

## 2. __init__.py 注册更新

- [x] 2.1 更新 `tools/__init__.py` 中所有 `swarm_*` 和 `read_mailbox` 的 import 路径为新文件名
- [x] 2.2 更新 `create_default_tool_registry()` 中的注册列表，使用新类名

## 3. Leader 系统提示词更新

- [x] 3.1 更新 `swarm_service.py` 中 `_LEADER_SYSTEM_PROMPT_TEMPLATE` 的工具表格，将所有 `swarm_*` 替换为对应 `team_*` 名称，将 `read_mailbox` 替换为 `team_read_mailbox`
- [x] 3.2 在提示词工具表格中新增 `team_request_plan`、`team_review_plan`、`team_request_shutdown` 三行说明

## 4. ProtocolRequestState 数据模型

- [x] 4.1 新建 `src/openharness/swarm/protocol.py`，定义 `ProtocolRequestState` dataclass（字段：`request_id`、`type`、`sender`、`target`、`status`、`payload`、`created_at`）
- [x] 4.2 在 `protocol.py` 中定义进程内 `pending_requests: dict[str, ProtocolRequestState]` 和 `new_request_id()` 工厂函数
- [x] 4.3 在 `protocol.py` 中实现 `match_response(response_type, request_id, approve)` 函数，含类型校验和重复响应防护
- [x] 4.4 在 `mailbox.py` 的 `MessageType` Literal 中新增 `"plan_approval_request"` 和 `"plan_approval_response"`
- [x] 4.5 在 `mailbox.py` 中新增 `create_plan_approval_request_message` 和 `create_plan_approval_response_message` 工厂函数

## 5. team_request_plan 工具

- [x] 5.1 新建 `tools/team_request_plan_tool.py`，定义 `TeamRequestPlanInput`（字段：`team`、`member`、`task`、`run_id`）
- [x] 5.2 实现 `TeamRequestPlanTool.execute`：生成 `request_id`，写入 `plan_approval_request` 消息到 member mailbox，在 `pending_requests` 中创建 `pending` 条目，返回 `request_id`
- [x] 5.3 在 `tools/__init__.py` 中注册 `TeamRequestPlanTool`

## 6. team_review_plan 工具

- [x] 6.1 新建 `tools/team_review_plan_tool.py`，定义 `TeamReviewPlanInput`（字段：`team`、`run_id`、`request_id`、`approve`、`feedback`）
- [x] 6.2 实现 `TeamReviewPlanTool.execute`：查找 `pending_requests[request_id]`，写入 `plan_approval_response` 消息到 sender mailbox，更新 status 为 `approved`/`rejected`
- [x] 6.3 在 `tools/__init__.py` 中注册 `TeamReviewPlanTool`

## 7. team_request_shutdown 工具

- [x] 7.1 新建 `tools/team_request_shutdown_tool.py`，定义 `TeamRequestShutdownInput`（字段：`team`、`member`、`run_id`）
- [x] 7.2 实现 `TeamRequestShutdownTool.execute`：生成 `request_id`，写入带 `request_id` 元数据的 `shutdown` 消息，在 `pending_requests` 中创建 `shutdown` 类型条目
- [x] 7.3 在 `tools/__init__.py` 中注册 `TeamRequestShutdownTool`

## 8. team_spawn_member blocked_by 支持

- [x] 8.1 在 `TeamSpawnMemberInput` 中新增 `blocked_by: list[str] | None` 和 `dependency_timeout: int = 120` 字段
- [x] 8.2 在 `TeamSpawnMemberTool.execute` 中，当 `blocked_by` 非空时，启动等待循环：以 3 秒间隔轮询 task manager（`completed` 状态）和 run mailbox（`idle_notification`），超时或依赖失败时返回错误
- [x] 8.3 更新工具 `description` 字段，说明 `blocked_by` 参数用法

## 9. Leader 提示词中新增工具说明

- [x] 9.1 在 `_LEADER_SYSTEM_PROMPT_TEMPLATE` 工具表格中添加 `team_request_plan`（请求成员提交计划）、`team_review_plan`（审批/拒绝计划）、`team_request_shutdown`（带确认的优雅关闭）
- [x] 9.2 在"标准工作流程"部分添加计划审批可选步骤说明

## 10. 验证

- [x] 10.1 运行 `python -c "from openharness.tools import create_default_tool_registry; r = create_default_tool_registry(); print([t.name for t in r._tools.values()])"` 确认新工具名注册正确，无旧 `swarm_*` 名称
- [x] 10.2 验证 `swarm_service.py` 中的系统提示词不含 `swarm_` 前缀工具名
- [x] 10.3 验证 `protocol.py` 中 `match_response` 对类型不匹配的请求返回警告不崩溃
- [x] 10.4 验证 `team_spawn_member` 在 `blocked_by` 指定已完成成员时立即 spawn
- [x] 10.5 运行现有测试套件，确认无回归
