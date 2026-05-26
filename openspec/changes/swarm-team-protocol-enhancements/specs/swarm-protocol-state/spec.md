## ADDED Requirements

### Requirement: ProtocolRequestState 追踪请求生命周期

系统 SHALL 提供 `ProtocolRequestState` 数据类，在进程内 `pending_requests` 字典中追踪每个 Leader 发起的协议请求（plan_approval、shutdown）的状态（pending/approved/rejected）。每个请求由唯一 `request_id` 标识。

#### Scenario: Leader 发起请求后状态为 pending

- **WHEN** Leader 调用 `team_request_plan` 或 `team_request_shutdown`
- **THEN** 系统在 `pending_requests` 中创建状态为 `pending` 的 `ProtocolRequestState` 条目，包含 `request_id`、`type`、`sender`、`target`

#### Scenario: Teammate 响应后状态更新

- **WHEN** Teammate 向 Leader mailbox 发送含 `request_id` 的响应消息
- **THEN** `pending_requests[request_id].status` 更新为 `approved` 或 `rejected`

#### Scenario: 响应类型不匹配时拒绝

- **WHEN** 收到响应消息的 `type` 与原始请求的 `type` 不符
- **THEN** 系统记录警告日志，不更新 `ProtocolRequestState`

### Requirement: mailbox 支持 plan_approval 消息类型

系统 SHALL 在 `MailboxMessage.type` 的 Literal 中包含 `"plan_approval_request"` 和 `"plan_approval_response"` 两种类型。

#### Scenario: Teammate 发送计划申请消息

- **WHEN** Teammate mailbox 收到 `type="plan_approval_request"` 的消息
- **THEN** 消息被正确反序列化，`payload` 包含 `plan` 文本和 `request_id`

#### Scenario: Leader 发送计划审批响应消息

- **WHEN** Leader mailbox 发出 `type="plan_approval_response"` 的消息
- **THEN** 消息 `payload` 包含 `request_id`、`approve: bool`、`feedback: str`
