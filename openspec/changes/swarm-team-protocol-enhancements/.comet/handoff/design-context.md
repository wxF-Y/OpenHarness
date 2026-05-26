# Comet Design Handoff

- Change: swarm-team-protocol-enhancements
- Phase: design
- Mode: compact
- Context hash: b4c504f91c099ad4ab0fcf5bc03af0a66f175767162ff60777e178b88f2a1791

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/swarm-team-protocol-enhancements/proposal.md

- Source: openspec/changes/swarm-team-protocol-enhancements/proposal.md
- Lines: 1-37
- SHA256: 7a96cbe41caa8948cb9d58502510b4c18795398c045d6d1c5a570f4115317d7d

```md
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
```

## openspec/changes/swarm-team-protocol-enhancements/design.md

- Source: openspec/changes/swarm-team-protocol-enhancements/design.md
- Lines: 1-106
- SHA256: 4a688d900cf332cb7db6e67b1059cfdf1b13eb2ddd34465a343074b3e9f5a456

[TRUNCATED]

```md
## Context

OpenHarness Swarm 系统当前有 6 个以 `swarm_` 为前缀的工具（`swarm_create_run`、`swarm_list_members` 等）和 1 个游离的 `read_mailbox` 工具，加上已有的 `team_create` / `team_delete`，命名体系混乱。同时系统缺失 learn-claude-code s15/s16 中已验证的三个协作模式：

- **s15**：任务依赖链（`blockedBy`）
- **s16**：请求-响应协议状态机（`request_id` + `ProtocolState`）
- **s16**：计划审批流程（`submit_plan` / `review_plan`）

现有工具均注册在 `src/openharness/tools/__init__.py` 的 `create_default_tool_registry()` 中，通过 `tool.name` 字段暴露给 LLM。Leader 的系统提示词 `_LEADER_SYSTEM_PROMPT_TEMPLATE` 硬编码了工具名列表。

## Goals / Non-Goals

**Goals:**
- 统一所有 Team/Swarm 工具命名为 `team_` 前缀
- 引入 `ProtocolRequestState`，为 Leader-Teammate 消息带 `request_id` 追踪
- 实现计划审批工作流（`team_request_plan` + `team_review_plan`）
- `team_spawn_member` 支持 `blocked_by` 依赖参数
- 更新 Leader 系统提示词

**Non-Goals:**
- 不修改 WebSocket/REST API 路由的 URL 路径（不影响前端）
- 不修改 `swarm-chatpage-member-view` 进行中的前端 change
- 不重写 `InProcessBackend` 或 `subprocess_backend`
- 不实现代码级别的工具调用 gate（计划审批依赖模型遵从，不做硬拦截）

## Decisions

### D1：工具命名映射方案

选择 `team_` 前缀而不是保留 `swarm_` 或混用。

| 旧名称 | 新名称 |
|--------|--------|
| `swarm_create_run` | `team_create_run` |
| `swarm_list_members` | `team_list_members` |
| `swarm_send_message` | `team_send_message` |
| `swarm_shutdown_member` | `team_shutdown_member` |
| `swarm_spawn_member` | `team_spawn_member` |
| `swarm_wait` | `team_wait` |
| `read_mailbox` | `team_read_mailbox` |
| `team_create` | 不变 |
| `team_delete` | 不变 |

文件名同步重命名：`swarm_create_run_tool.py` → `team_create_run_tool.py` 等。

**理由**：`team_` 是已有的方向（`team_create`、`team_delete`），保持一致性；`swarm` 是内部实现词，对 LLM 无语义价值。

### D2：ProtocolRequestState 存储位置

新建 `src/openharness/swarm/protocol.py`，而不是扩展 `mailbox.py`。

```python
@dataclass
class ProtocolRequestState:
    request_id: str
    type: Literal["plan_approval", "shutdown"]
    sender: str
    target: str
    status: Literal["pending", "approved", "rejected"]
    payload: str
    created_at: float = field(default_factory=time.time)
```

`pending_requests: dict[str, ProtocolRequestState]` 作为进程内 dict（不持久化）。

**理由**：协议状态是会话级别的（Leader 重启后重建），不需要磁盘持久化。将其放在独立文件保持 `mailbox.py` 职责单一。

### D3：plan_approval 消息类型扩展

在 `mailbox.py` 的 `MessageType` Literal 中新增：
- `"plan_approval_request"`：Teammate → Leader，含 plan 文本
- `"plan_approval_response"`：Leader → Teammate，含 approve/feedback

**理由**：与现有消息类型体系一致，类型可区分路由，对前端透明（前端已在渲染所有 mailbox 消息）。

### D4：blocked_by 依赖调度策略

`team_spawn_member` 新增 `blocked_by: list[str] | None` 参数（成员名列表）。执行逻辑：在 spawn 前轮询 task manager，等待所有 blocked_by 成员的 task 完成（`completed` 状态）或通过 mailbox `idle_notification` 确认。超时时返回错误，不阻塞 asyncio 事件循环（使用 `asyncio.sleep` 轮询）。

**理由**：s15 的 `can_start()` 是同步检查，OpenHarness 是异步环境，需要非阻塞等待。简单的 poll + sleep 足够，不引入额外的事件系统复杂度。
```

Full source: openspec/changes/swarm-team-protocol-enhancements/design.md

## openspec/changes/swarm-team-protocol-enhancements/tasks.md

- Source: openspec/changes/swarm-team-protocol-enhancements/tasks.md
- Lines: 1-64
- SHA256: cf272b29d07364e00d41d210f8c7c1a70e56601b7ec6df9a37266a042ff8b06a

```md
## 1. 工具重命名（Breaking Change 准备）

- [ ] 1.1 将 `swarm_create_run_tool.py` 重命名为 `team_create_run_tool.py`，更新类名为 `TeamCreateRunTool`，`name = "team_create_run"`
- [ ] 1.2 将 `swarm_list_members_tool.py` 重命名为 `team_list_members_tool.py`，更新类名和 `name` 字段
- [ ] 1.3 将 `swarm_send_message_tool.py` 重命名为 `team_send_message_tool.py`，更新类名和 `name` 字段
- [ ] 1.4 将 `swarm_shutdown_member_tool.py` 重命名为 `team_shutdown_member_tool.py`，更新类名和 `name` 字段
- [ ] 1.5 将 `swarm_spawn_member_tool.py` 重命名为 `team_spawn_member_tool.py`，更新类名和 `name` 字段
- [ ] 1.6 将 `swarm_wait_tool.py` 重命名为 `team_wait_tool.py`，更新类名和 `name` 字段
- [ ] 1.7 将 `read_mailbox_tool.py` 重命名为 `team_read_mailbox_tool.py`，更新类名为 `TeamReadMailboxTool`，`name = "team_read_mailbox"`

## 2. __init__.py 注册更新

- [ ] 2.1 更新 `tools/__init__.py` 中所有 `swarm_*` 和 `read_mailbox` 的 import 路径为新文件名
- [ ] 2.2 更新 `create_default_tool_registry()` 中的注册列表，使用新类名

## 3. Leader 系统提示词更新

- [ ] 3.1 更新 `swarm_service.py` 中 `_LEADER_SYSTEM_PROMPT_TEMPLATE` 的工具表格，将所有 `swarm_*` 替换为对应 `team_*` 名称，将 `read_mailbox` 替换为 `team_read_mailbox`
- [ ] 3.2 在提示词工具表格中新增 `team_request_plan`、`team_review_plan`、`team_request_shutdown` 三行说明

## 4. ProtocolRequestState 数据模型

- [ ] 4.1 新建 `src/openharness/swarm/protocol.py`，定义 `ProtocolRequestState` dataclass（字段：`request_id`、`type`、`sender`、`target`、`status`、`payload`、`created_at`）
- [ ] 4.2 在 `protocol.py` 中定义进程内 `pending_requests: dict[str, ProtocolRequestState]` 和 `new_request_id()` 工厂函数
- [ ] 4.3 在 `protocol.py` 中实现 `match_response(response_type, request_id, approve)` 函数，含类型校验和重复响应防护
- [ ] 4.4 在 `mailbox.py` 的 `MessageType` Literal 中新增 `"plan_approval_request"` 和 `"plan_approval_response"`
- [ ] 4.5 在 `mailbox.py` 中新增 `create_plan_approval_request_message` 和 `create_plan_approval_response_message` 工厂函数

## 5. team_request_plan 工具

- [ ] 5.1 新建 `tools/team_request_plan_tool.py`，定义 `TeamRequestPlanInput`（字段：`team`、`member`、`task`、`run_id`）
- [ ] 5.2 实现 `TeamRequestPlanTool.execute`：生成 `request_id`，写入 `plan_approval_request` 消息到 member mailbox，在 `pending_requests` 中创建 `pending` 条目，返回 `request_id`
- [ ] 5.3 在 `tools/__init__.py` 中注册 `TeamRequestPlanTool`

## 6. team_review_plan 工具

- [ ] 6.1 新建 `tools/team_review_plan_tool.py`，定义 `TeamReviewPlanInput`（字段：`team`、`run_id`、`request_id`、`approve`、`feedback`）
- [ ] 6.2 实现 `TeamReviewPlanTool.execute`：查找 `pending_requests[request_id]`，写入 `plan_approval_response` 消息到 sender mailbox，更新 status 为 `approved`/`rejected`
- [ ] 6.3 在 `tools/__init__.py` 中注册 `TeamReviewPlanTool`

## 7. team_request_shutdown 工具

- [ ] 7.1 新建 `tools/team_request_shutdown_tool.py`，定义 `TeamRequestShutdownInput`（字段：`team`、`member`、`run_id`）
- [ ] 7.2 实现 `TeamRequestShutdownTool.execute`：生成 `request_id`，写入带 `request_id` 元数据的 `shutdown` 消息，在 `pending_requests` 中创建 `shutdown` 类型条目
- [ ] 7.3 在 `tools/__init__.py` 中注册 `TeamRequestShutdownTool`

## 8. team_spawn_member blocked_by 支持

- [ ] 8.1 在 `TeamSpawnMemberInput` 中新增 `blocked_by: list[str] | None` 和 `dependency_timeout: int = 120` 字段
- [ ] 8.2 在 `TeamSpawnMemberTool.execute` 中，当 `blocked_by` 非空时，启动等待循环：以 3 秒间隔轮询 task manager（`completed` 状态）和 run mailbox（`idle_notification`），超时或依赖失败时返回错误
- [ ] 8.3 更新工具 `description` 字段，说明 `blocked_by` 参数用法

## 9. Leader 提示词中新增工具说明

- [ ] 9.1 在 `_LEADER_SYSTEM_PROMPT_TEMPLATE` 工具表格中添加 `team_request_plan`（请求成员提交计划）、`team_review_plan`（审批/拒绝计划）、`team_request_shutdown`（带确认的优雅关闭）
- [ ] 9.2 在"标准工作流程"部分添加计划审批可选步骤说明

## 10. 验证

- [ ] 10.1 运行 `python -c "from openharness.tools import create_default_tool_registry; r = create_default_tool_registry(); print([t.name for t in r._tools.values()])"` 确认新工具名注册正确，无旧 `swarm_*` 名称
- [ ] 10.2 验证 `swarm_service.py` 中的系统提示词不含 `swarm_` 前缀工具名
- [ ] 10.3 验证 `protocol.py` 中 `match_response` 对类型不匹配的请求返回警告不崩溃
- [ ] 10.4 验证 `team_spawn_member` 在 `blocked_by` 指定已完成成员时立即 spawn
- [ ] 10.5 运行现有测试套件，确认无回归
```

## openspec/changes/swarm-team-protocol-enhancements/specs/swarm-plan-approval/spec.md

- Source: openspec/changes/swarm-team-protocol-enhancements/specs/swarm-plan-approval/spec.md
- Lines: 1-48
- SHA256: 606ffa075a6c398e8515e573a703b7c13e7230f6bdfdfbc56fd0fad861016cc2

```md
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
```

## openspec/changes/swarm-team-protocol-enhancements/specs/swarm-protocol-state/spec.md

- Source: openspec/changes/swarm-team-protocol-enhancements/specs/swarm-protocol-state/spec.md
- Lines: 1-34
- SHA256: 3897d5a35c5e2abae11aaba5de5d5a6487cff1968df571386f62baa30f115170

```md
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
```

## openspec/changes/swarm-team-protocol-enhancements/specs/swarm-task-dependency/spec.md

- Source: openspec/changes/swarm-team-protocol-enhancements/specs/swarm-task-dependency/spec.md
- Lines: 1-30
- SHA256: 0554867a09431f7195603f558e4d6a9e54691bcd6c9d44079eaccf6ae63ecb75

```md
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
```

## openspec/changes/swarm-team-protocol-enhancements/specs/swarm-tool-naming/spec.md

- Source: openspec/changes/swarm-team-protocol-enhancements/specs/swarm-tool-naming/spec.md
- Lines: 1-38
- SHA256: 1caf03e3ecf0af13d05428c56ada7a1f725a126fb42645cc24193d968a502602

```md
## ADDED Requirements

### Requirement: 所有团队工具使用 team_ 前缀

系统 SHALL 将所有与 Swarm/Team 相关的 Agent 工具以 `team_` 为前缀命名，包括：`team_create_run`、`team_list_members`、`team_send_message`、`team_shutdown_member`、`team_spawn_member`、`team_wait`、`team_read_mailbox`。原有的 `team_create` 和 `team_delete` 保持不变。

#### Scenario: Agent 调用团队工具

- **WHEN** Agent 通过工具名 `team_create_run` 创建任务运行
- **THEN** 系统成功执行，返回 `run_id`，功能与原 `swarm_create_run` 完全相同

#### Scenario: 旧工具名不再注册

- **WHEN** Agent 尝试调用 `swarm_create_run`（旧名）
- **THEN** 系统返回"未知工具"错误，因为该工具名不再注册

#### Scenario: read_mailbox 迁移到 team_read_mailbox

- **WHEN** Agent 通过 `team_read_mailbox` 读取 Leader 收件箱
- **THEN** 系统返回该 run 的未读消息列表，功能与原 `read_mailbox` 完全相同

### Requirement: 工具文件命名与 tool.name 字段同步

系统 SHALL 保持工具文件名（`team_*_tool.py`）与工具类中 `name` 字段（`team_*`）一致。

#### Scenario: 工具文件名与注册名匹配

- **WHEN** 开发者查看 `src/openharness/tools/` 目录
- **THEN** 每个 `team_*_tool.py` 文件中的 `BaseTool.name` 字段以 `team_` 开头，无 `swarm_` 前缀文件

### Requirement: Leader 系统提示词反映新工具名

系统 SHALL 在 `swarm_service.py` 的 `_LEADER_SYSTEM_PROMPT_TEMPLATE` 中使用 `team_*` 工具名。

#### Scenario: Leader 使用正确工具名编排任务

- **WHEN** Leader Agent 初始化并读取系统提示词
- **THEN** 提示词中的工具表格列出 `team_create_run`、`team_spawn_member` 等 `team_*` 名称，不含 `swarm_*`
```

