---
comet_change: swarm-team-protocol-enhancements
role: technical-design
canonical_spec: openspec
---

# Swarm Team Protocol Enhancements — Technical Design

## 模块结构

本次变更涉及以下文件：

```
src/openharness/
├── swarm/
│   ├── mailbox.py          ← 新增 MessageType + 工厂函数
│   ├── protocol.py         ← 新文件：ProtocolRequestState + pending_requests + match_response
│   └── completion_events.py← 新文件：asyncio.Event 完成注册表（blocked_by 依赖调度）
├── tools/
│   ├── team_create_run_tool.py      ← 重命名自 swarm_create_run_tool.py
│   ├── team_list_members_tool.py    ← 重命名自 swarm_list_members_tool.py
│   ├── team_send_message_tool.py    ← 重命名自 swarm_send_message_tool.py
│   ├── team_shutdown_member_tool.py ← 重命名自 swarm_shutdown_member_tool.py
│   ├── team_spawn_member_tool.py    ← 重命名自 swarm_spawn_member_tool.py（+blocked_by）
│   ├── team_wait_tool.py            ← 重命名自 swarm_wait_tool.py
│   ├── team_read_mailbox_tool.py    ← 重命名自 read_mailbox_tool.py
│   ├── team_request_plan_tool.py    ← 新文件
│   ├── team_review_plan_tool.py     ← 新文件
│   ├── team_request_shutdown_tool.py← 新文件
│   └── __init__.py                 ← import + 注册更新
```

## completion_events.py — asyncio.Event 完成注册表

这是 `blocked_by` 依赖调度的核心。

```python
# src/openharness/swarm/completion_events.py
import asyncio
from typing import Dict

_events: Dict[str, asyncio.Event] = {}

def _key(run_id: str, agent_id: str) -> str:
    return f"{run_id}:{agent_id}"

def signal(run_id: str, agent_id: str) -> None:
    """成员完成时调用。由 in_process.py 和 subprocess 完成路径 hook。"""
    k = _key(run_id, agent_id)
    ev = _events.get(k)
    if ev:
        ev.set()

async def wait_for_completion(run_id: str, agent_id: str, timeout: float) -> bool:
    """等待成员完成。返回 True=完成，False=超时。"""
    k = _key(run_id, agent_id)
    ev = _events.setdefault(k, asyncio.Event())
    try:
        await asyncio.wait_for(asyncio.shield(ev.wait()), timeout=timeout)
        return True
    except asyncio.TimeoutError:
        return False

def reset(run_id: str, agent_id: str) -> None:
    """清理 event（run 结束时调用，防止内存泄漏）。"""
    _events.pop(_key(run_id, agent_id), None)
```

**两处 hook 点：**

1. `in_process.py` — 在 `idle_notification` 发送后：
   ```python
   # 发送 idle_notification 之后立即 signal
   from openharness.swarm.completion_events import signal as signal_completion
   signal_completion(run_id=config.mailbox_team_path, agent_id=agent_id)
   ```

2. subprocess 完成路径 — 在 `subprocess_backend.py` 任务完成回调处（或 `team_wait_tool.py` 检测到 `completed` 时）调用 `signal_completion`。

> 注意：`team_wait_tool.py` 检测到完成时也可以补充调用 `signal()`，作为兜底（幂等操作）。

## protocol.py — ProtocolRequestState

```python
# src/openharness/swarm/protocol.py
import uuid, time, logging
from dataclasses import dataclass, field
from typing import Literal, Dict

log = logging.getLogger(__name__)

@dataclass
class ProtocolRequestState:
    request_id: str
    type: Literal["plan_approval", "shutdown"]
    sender: str
    target: str
    status: Literal["pending", "approved", "rejected"]
    payload: str
    created_at: float = field(default_factory=time.time)

pending_requests: Dict[str, ProtocolRequestState] = {}

def new_request_id() -> str:
    return f"req_{uuid.uuid4().hex[:12]}"

def match_response(response_type: str, request_id: str, approve: bool) -> None:
    """将响应关联到原始请求。含类型校验和重复防护。"""
    state = pending_requests.get(request_id)
    if not state:
        log.warning("match_response: unknown request_id %s", request_id)
        return
    # 类型校验
    expected = {
        "plan_approval": "plan_approval_response",
        "shutdown": "shutdown_response",
    }.get(state.type)
    if expected and response_type != expected:
        log.warning("match_response: type mismatch for %s (expected %s, got %s)",
                    request_id, expected, response_type)
        return
    # 重复防护
    if state.status != "pending":
        log.debug("match_response: %s already %s, ignoring duplicate", request_id, state.status)
        return
    state.status = "approved" if approve else "rejected"
    log.info("match_response: %s → %s", request_id, state.status)
```

**线程安全说明**：`pending_requests` 是进程内 dict，在 asyncio 单线程环境中无竞态。如果多个 asyncio.Task 并发写入，asyncio GIL 保证 dict 操作原子性。**不需要 Lock**。

## mailbox.py — 新增消息类型和工厂函数

```python
# MessageType 扩展
MessageType = Literal[
    "user_message",
    "permission_request",
    "permission_response",
    "sandbox_permission_request",
    "sandbox_permission_response",
    "shutdown",
    "idle_notification",
    "plan_approval_request",   # 新增：Teammate → Leader
    "plan_approval_response",  # 新增：Leader → Teammate
]

# 新增工厂函数
def create_plan_approval_request_message(
    sender: str, recipient: str, task: str, request_id: str
) -> MailboxMessage:
    return _make_message("plan_approval_request", sender, recipient, {
        "task": task, "request_id": request_id
    })

def create_plan_approval_response_message(
    sender: str, recipient: str, request_id: str,
    approve: bool, feedback: str = ""
) -> MailboxMessage:
    return _make_message("plan_approval_response", sender, recipient, {
        "request_id": request_id,
        "approve": approve,
        "feedback": feedback,
    })
```

## team_spawn_member — blocked_by 实现

```python
# 在 execute() 中，spawn 之前插入：
if arguments.blocked_by:
    from openharness.swarm.completion_events import wait_for_completion
    timeout_per_dep = arguments.dependency_timeout / len(arguments.blocked_by)
    for dep_name in arguments.blocked_by:
        dep_agent_id = f"{dep_name}@{arguments.team}"
        done = await wait_for_completion(
            run_id=arguments.run_id,
            agent_id=dep_agent_id,
            timeout=timeout_per_dep,
        )
        if not done:
            # 检查是否是失败退出
            dep_task = _find_task(dep_agent_id, task_mgr)
            if dep_task and dep_task.status in ("failed", "killed"):
                return ToolResult(
                    output=f"Dependency '{dep_name}' failed ({dep_task.status}), cannot spawn.",
                    is_error=True,
                )
            return ToolResult(
                output=f"Dependency '{dep_name}' did not complete within {timeout_per_dep:.0f}s.",
                is_error=True,
            )
```

**超时分配策略**：`dependency_timeout`（默认 120s）平均分配给每个依赖项。例如 `blocked_by=["a","b"]` 且 `timeout=120`，每个最多等 60s。

## team_request_plan / team_review_plan 工具

```
team_request_plan(team, member, task, run_id)
  → 生成 request_id
  → 写 plan_approval_request 到 member run mailbox
  → 创建 ProtocolRequestState(type="plan_approval", status="pending")
  → 返回: "Plan request sent to {member}. request_id={req_id}"

team_review_plan(team, run_id, request_id, approve, feedback="")
  → 查找 pending_requests[request_id]（不存在 → is_error）
  → 写 plan_approval_response 到 target member mailbox
  → 调用 match_response("plan_approval_response", request_id, approve)
  → 返回: "Plan {'approved' if approve else 'rejected'} ({request_id})"
```

## team_request_shutdown 工具

```
team_request_shutdown(team, member, run_id)
  → 生成 request_id
  → 写 shutdown 消息（payload 含 request_id）到 member mailbox
  → 创建 ProtocolRequestState(type="shutdown", status="pending")
  → 返回: "Shutdown request sent to {member}. request_id={req_id}"
```

Teammate 响应时（发送 shutdown_response 含 request_id），Leader 调用 `team_read_mailbox` 后系统自动调用 `match_response` 更新状态。

> 注：`team_shutdown_member` 保留不变（直接 force-kill 或单向 shutdown）。`team_request_shutdown` 是带确认的新工具，两者共存。

## Leader 系统提示词新工具表格条目

```
| `team_request_plan`     | 请求成员提交执行计划，返回 request_id（team, member, task, run_id） |
| `team_review_plan`      | 审批或拒绝成员计划（request_id, approve, feedback）|
| `team_request_shutdown` | 带确认的优雅关闭，追踪成员是否响应（team, member, run_id） |
```

## 测试策略

| 测试类型 | 覆盖点 |
|---------|--------|
| 单元测试 | `protocol.match_response` — 类型不匹配、重复响应、未知 request_id |
| 单元测试 | `completion_events.signal` + `wait_for_completion` — 正常完成、超时 |
| 单元测试 | `mailbox` 新消息类型序列化/反序列化 |
| 集成测试 | `team_request_plan` → `team_review_plan` 完整流程 |
| 集成测试 | `team_spawn_member(blocked_by=[...])` — 依赖已完成立即 spawn；依赖运行中等待后 spawn |
| 集成测试 | 工具注册验证：`create_default_tool_registry()` 无 `swarm_*` 名称 |

## 边界条件

- **`blocked_by` 中的成员不在团队中**：在等待前校验，立即返回错误
- **`run_id` 缺失时 `blocked_by`**：降级为只查 task manager（无 event 可等）
- **多次调用 `signal()` 同一成员**：Event.set() 幂等，无副作用
- **Leader 重启后 `pending_requests` 清空**：设计接受，会话级别状态
- **`completion_events` 内存泄漏**：`team_wait_tool` 所有成员完成后调用 `reset()`
