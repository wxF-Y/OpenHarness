## ADDED Requirements

### Requirement: Leader 可请求 Teammate 提交执行计划

系统 SHALL 提供 `team_request_plan` 工具，允许 Leader 向指定 Teammate 发送计划请求消息（`plan_approval_request`），并返回 `request_id` 供后续审批使用。

#### Scenario: 成功发起计划请求

- **WHEN** Leader 调用 `team_request_plan(team, member, task, run_id)`
- **THEN** 系统向该 member 的 run-specific mailbox 写入 `plan_approval_request` 消息，返回 `request_id`，并在 `pending_requests` 中创建 `pending` 状态条目

#### Scenario: 成员不存在时返回错误

- **WHEN** Leader 调用 `team_request_plan` 但 `member` 不在团队中
- **THEN** 工具返回 `is_error=True`，内容为 "Member not found"

### Requirement: Leader 可审批或拒绝 Teammate 计划

系统 SHALL 提供 `team_review_plan` 工具，允许 Leader 通过 `request_id` 审批或拒绝 Teammate 提交的计划，支持附加反馈文本。

#### Scenario: 批准计划

- **WHEN** Leader 调用 `team_review_plan(team, run_id, request_id, approve=True)`
- **THEN** 系统向 Teammate mailbox 写入 `plan_approval_response`（approve=True），更新 `pending_requests[request_id].status = "approved"`

#### Scenario: 拒绝计划并附反馈

- **WHEN** Leader 调用 `team_review_plan(request_id, approve=False, feedback="请简化步骤三")`
- **THEN** 系统向 Teammate mailbox 写入 `plan_approval_response`（approve=False，含 feedback），更新 status 为 `"rejected"`

#### Scenario: request_id 不存在时返回错误

- **WHEN** Leader 调用 `team_review_plan` 使用未知 `request_id`
- **THEN** 工具返回 `is_error=True`，内容为 "Request not found"

### Requirement: team_request_shutdown 支持带确认的优雅关闭

系统 SHALL 提供 `team_request_shutdown` 工具，向 Teammate 发送带 `request_id` 的 `shutdown` 消息。当 Teammate 响应 `shutdown_response` 后，`ProtocolRequestState` 更新为 `approved`。

#### Scenario: 发起优雅关闭请求

- **WHEN** Leader 调用 `team_request_shutdown(team, member, run_id)`
- **THEN** 系统向 Teammate mailbox 写入 shutdown 消息（含 `request_id`），返回 `request_id`

#### Scenario: Teammate 确认关闭

- **WHEN** Teammate 处理 shutdown 消息并发送 `shutdown_response`（含相同 `request_id`）
- **THEN** `pending_requests[request_id].status` 更新为 `"approved"`
