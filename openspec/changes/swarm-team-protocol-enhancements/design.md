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

### D5：Leader 系统提示词更新策略

`swarm_service.py` 的 `_LEADER_SYSTEM_PROMPT_TEMPLATE` 是一个硬编码的中文提示词字符串。直接原地替换工具名，同时在工具表格中增加三个新工具的条目和说明。

## Risks / Trade-offs

- **[风险] 工具重命名是 Breaking Change** → 已存档的历史对话中 LLM 调用旧工具名会报错。缓解：`team_shutdown_member` 等新工具保留原有功能，不影响在途任务。
- **[风险] pending_requests 不持久化** → Leader 进程重启后所有 pending plan approval 丢失。缓解：计划审批是会话级别交互，重启意味着新对话，影响可接受。
- **[风险] blocked_by 轮询可能超时** → 若依赖的 Teammate 长时间未完成，spawn 会超时。缓解：返回明确的超时错误信息，Leader 可以重试。
- **[取舍] 计划审批无代码级 Gate** → 参考 s16 的注释，"代码级 gate 需要阻塞 teammate 的 tool dispatch"——OpenHarness 架构下同样不做此保证，依赖模型遵从。

## Migration Plan

1. 重命名文件（`swarm_*_tool.py` → `team_*_tool.py`）
2. 更新 `__init__.py` 的导入和注册
3. 更新 `swarm_service.py` 系统提示词
4. 添加新文件（`protocol.py`、`team_request_plan_tool.py`、`team_review_plan_tool.py`、`team_request_shutdown_tool.py`）
5. 修改 `mailbox.py` 新增消息类型
6. 修改 `team_spawn_member_tool.py` 添加 `blocked_by`

无需数据迁移，所有变更向后兼容（不改变文件存储格式）。

## Open Questions

- `plan_approval_request` 消息是否需要显示在前端的 chat 视图中？（当前设计：不做前端展示适配，由 `swarm-chatpage-member-view` 未来处理）
