---
change: swarm-team-protocol-enhancements
design-doc: docs/superpowers/specs/2026-05-26-swarm-team-protocol-design.md
base-ref: 05150847150bbede50b2cb3fb78058f6f4d13360
---

# Swarm Team Protocol Enhancements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 Swarm 工具命名为 `team_*` 前缀，并新增 Protocol State Machine、计划审批流程、asyncio.Event 完成注册表和 blocked_by 依赖调度。

**Architecture:** 新建 `completion_events.py`（asyncio.Event 完成注册表）和 `protocol.py`（ProtocolRequestState + pending_requests + match_response），所有现有 `swarm_*_tool.py` 重命名为 `team_*_tool.py` 并更新内部标识符，再新增三个工具文件。`in_process.py` 在发送 `idle_notification` 后 hook `signal_completion`；`team_wait_tool.py` 作为兜底也 hook `signal`。

**Tech Stack:** Python 3.12+, asyncio, dataclasses, pydantic, openharness.tools.base.BaseTool

---

## Task 1: 新建 completion_events.py

**Files:**
- Create: `src/openharness/swarm/completion_events.py`
- Modify: `src/openharness/swarm/in_process.py` (lines 368–376 之后插入)

- [ ] **Step 1.1: 创建 completion_events.py**

```python
# src/openharness/swarm/completion_events.py
"""asyncio.Event-based completion registry for blocked_by dependency scheduling."""

from __future__ import annotations

import asyncio
import logging
from typing import Dict

logger = logging.getLogger(__name__)

_events: Dict[str, asyncio.Event] = {}


def _key(run_id: str, agent_id: str) -> str:
    return f"{run_id}:{agent_id}"


def signal(run_id: str, agent_id: str) -> None:
    """Signal that agent_id in run_id has completed. Idempotent."""
    k = _key(run_id, agent_id)
    ev = _events.get(k)
    if ev:
        ev.set()
        logger.debug("completion_events: signalled %s", k)


async def wait_for_completion(run_id: str, agent_id: str, timeout: float) -> bool:
    """Wait for agent_id to complete. Returns True=done, False=timeout."""
    k = _key(run_id, agent_id)
    ev = _events.setdefault(k, asyncio.Event())
    try:
        await asyncio.wait_for(asyncio.shield(ev.wait()), timeout=timeout)
        return True
    except asyncio.TimeoutError:
        return False


def reset(run_id: str, agent_id: str) -> None:
    """Remove event entry. Call after run completes to prevent memory leak."""
    _events.pop(_key(run_id, agent_id), None)
```

- [ ] **Step 1.2: 在 in_process.py 的 idle_notification 发送后 hook signal**

在 `src/openharness/swarm/in_process.py` 的 line 376（`await leader_mailbox.write(idle_msg)`）之后，紧接着第 377 行的 `logger.debug` 前，插入：

```python
            # Signal completion for blocked_by dependency scheduling
            if config.mailbox_team_path:
                try:
                    from openharness.swarm.completion_events import signal as _signal_completion
                    _signal_completion(config.mailbox_team_path, _agent_id)
                except Exception as _sig_exc:
                    logger.debug("[in_process] %s: completion signal failed: %s", _agent_id, _sig_exc)
```

- [ ] **Step 1.3: 验证导入不报错**

```bash
cd /e/AI/OpenHarness && python -c "from openharness.swarm.completion_events import signal, wait_for_completion, reset; print('OK')"
```
Expected: `OK`

- [ ] **Step 1.4: Commit**

```bash
git add src/openharness/swarm/completion_events.py src/openharness/swarm/in_process.py
git commit -m "feat: add completion_events asyncio.Event registry + hook in_process idle_notification"
```

---

## Task 2: 新建 protocol.py

**Files:**
- Create: `src/openharness/swarm/protocol.py`

- [ ] **Step 2.1: 创建 protocol.py**

```python
# src/openharness/swarm/protocol.py
"""Protocol state machine for Leader-Teammate request/response tracking."""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Literal

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


# In-process dict: session-level, not persisted.
# asyncio single-thread: no Lock needed.
pending_requests: Dict[str, ProtocolRequestState] = {}


def new_request_id() -> str:
    return f"req_{uuid.uuid4().hex[:12]}"


def match_response(response_type: str, request_id: str, approve: bool) -> None:
    """Correlate a response to its original request via request_id.

    Validates type match and guards against duplicate responses.
    """
    state = pending_requests.get(request_id)
    if not state:
        log.warning("match_response: unknown request_id %s", request_id)
        return
    expected = {
        "plan_approval": "plan_approval_response",
        "shutdown": "shutdown_response",
    }.get(state.type)
    if expected and response_type != expected:
        log.warning(
            "match_response: type mismatch for %s (expected %s, got %s)",
            request_id, expected, response_type,
        )
        return
    if state.status != "pending":
        log.debug("match_response: %s already %s, ignoring duplicate", request_id, state.status)
        return
    state.status = "approved" if approve else "rejected"
    log.info("match_response: %s → %s", request_id, state.status)
```

- [ ] **Step 2.2: 验证导入**

```bash
python -c "from openharness.swarm.protocol import ProtocolRequestState, pending_requests, new_request_id, match_response; print('OK')"
```
Expected: `OK`

- [ ] **Step 2.3: Commit**

```bash
git add src/openharness/swarm/protocol.py
git commit -m "feat: add ProtocolRequestState + pending_requests + match_response"
```

---

## Task 3: mailbox.py 新增消息类型和工厂函数

**Files:**
- Modify: `src/openharness/swarm/mailbox.py`

- [ ] **Step 3.1: 扩展 MessageType Literal**

在 `mailbox.py` 找到 `MessageType = Literal[` 定义，在最后一个类型之后（`"idle_notification"` 后）加入两个新类型：

```python
MessageType = Literal[
    "user_message",
    "permission_request",
    "permission_response",
    "sandbox_permission_request",
    "sandbox_permission_response",
    "shutdown",
    "idle_notification",
    "plan_approval_request",
    "plan_approval_response",
]
```

- [ ] **Step 3.2: 在 create_idle_notification 之后添加两个工厂函数**

```python
def create_plan_approval_request_message(
    sender: str,
    recipient: str,
    task: str,
    request_id: str,
) -> MailboxMessage:
    """Create a plan_approval_request message from Leader to Teammate."""
    return _make_message(
        "plan_approval_request", sender, recipient,
        {"task": task, "request_id": request_id},
    )


def create_plan_approval_response_message(
    sender: str,
    recipient: str,
    request_id: str,
    approve: bool,
    feedback: str = "",
) -> MailboxMessage:
    """Create a plan_approval_response message from Leader to Teammate."""
    return _make_message(
        "plan_approval_response", sender, recipient,
        {"request_id": request_id, "approve": approve, "feedback": feedback},
    )


def create_shutdown_request_with_tracking(
    sender: str,
    recipient: str,
    request_id: str,
) -> MailboxMessage:
    """Create a shutdown request message with request_id for confirmation tracking."""
    return _make_message("shutdown", sender, recipient, {"request_id": request_id})
```

- [ ] **Step 3.3: 验证**

```bash
python -c "from openharness.swarm.mailbox import create_plan_approval_request_message, create_plan_approval_response_message; m = create_plan_approval_request_message('leader','worker@team','do X','req_abc'); print(m.type, m.payload)"
```
Expected: `plan_approval_request {'task': 'do X', 'request_id': 'req_abc'}`

- [ ] **Step 3.4: Commit**

```bash
git add src/openharness/swarm/mailbox.py
git commit -m "feat: add plan_approval_request/response message types and factory functions"
```

---

## Task 4: 工具重命名 (swarm_* → team_*)

**Files:**
- Rename: 7 个工具文件（git mv）
- Modify: 每个文件内部的 class name 和 `name =` 字段

- [ ] **Step 4.1: git mv 重命名所有文件**

```bash
cd /e/AI/OpenHarness
git mv src/openharness/tools/swarm_create_run_tool.py src/openharness/tools/team_create_run_tool.py
git mv src/openharness/tools/swarm_list_members_tool.py src/openharness/tools/team_list_members_tool.py
git mv src/openharness/tools/swarm_send_message_tool.py src/openharness/tools/team_send_message_tool.py
git mv src/openharness/tools/swarm_shutdown_member_tool.py src/openharness/tools/team_shutdown_member_tool.py
git mv src/openharness/tools/swarm_spawn_member_tool.py src/openharness/tools/team_spawn_member_tool.py
git mv src/openharness/tools/swarm_wait_tool.py src/openharness/tools/team_wait_tool.py
git mv src/openharness/tools/read_mailbox_tool.py src/openharness/tools/team_read_mailbox_tool.py
```

- [ ] **Step 4.2: 更新 team_create_run_tool.py 内部标识符**

在 `src/openharness/tools/team_create_run_tool.py`：
- 将 `class SwarmCreateRunInput` → `class TeamCreateRunInput`
- 将 `class SwarmCreateRunTool(BaseTool)` → `class TeamCreateRunTool(BaseTool)`
- 将 `name = "swarm_create_run"` → `name = "team_create_run"`
- 将 `input_model = SwarmCreateRunInput` → `input_model = TeamCreateRunInput`
- 更新所有内部对 `SwarmCreateRunInput` 的引用

- [ ] **Step 4.3: 更新 team_list_members_tool.py 内部标识符**

- `SwarmListMembersInput` → `TeamListMembersInput`
- `SwarmListMembersTool` → `TeamListMembersTool`
- `name = "swarm_list_members"` → `name = "team_list_members"`
- `input_model = SwarmListMembersInput` → `input_model = TeamListMembersInput`

- [ ] **Step 4.4: 更新 team_send_message_tool.py 内部标识符**

- `SwarmSendMessageInput` → `TeamSendMessageInput`
- `SwarmSendMessageTool` → `TeamSendMessageTool`
- `name = "swarm_send_message"` → `name = "team_send_message"`
- `input_model = SwarmSendMessageInput` → `input_model = TeamSendMessageInput`

- [ ] **Step 4.5: 更新 team_shutdown_member_tool.py 内部标识符**

- `SwarmShutdownMemberInput` → `TeamShutdownMemberInput`
- `SwarmShutdownMemberTool` → `TeamShutdownMemberTool`
- `name = "swarm_shutdown_member"` → `name = "team_shutdown_member"`
- `input_model = SwarmShutdownMemberInput` → `input_model = TeamShutdownMemberInput`

- [ ] **Step 4.6: 更新 team_spawn_member_tool.py 内部标识符**

- `SwarmSpawnMemberInput` → `TeamSpawnMemberInput`
- `SwarmSpawnMemberTool` → `TeamSpawnMemberTool`
- `name = "swarm_spawn_member"` → `name = "team_spawn_member"`
- `input_model = SwarmSpawnMemberInput` → `input_model = TeamSpawnMemberInput`

- [ ] **Step 4.7: 更新 team_wait_tool.py 内部标识符 + 添加 signal_completion hook**

- `SwarmWaitInput` → `TeamWaitInput`
- `SwarmWaitTool` → `TeamWaitTool`
- `name = "swarm_wait"` → `name = "team_wait"`
- `input_model = SwarmWaitInput` → `input_model = TeamWaitInput`

在 `team_wait_tool.py` 中，找到检测 `t.status == "completed"` 的 block（约 line 679），在 `completed[agent_id] = summary` 之后插入 signal 作为兜底：

```python
                    completed[agent_id] = summary
                    # Signal completion event (兜底：subprocess 成员无 in_process hook)
                    if arguments.run_id:
                        from openharness.swarm.completion_events import signal as _sig
                        _sig(arguments.run_id, agent_id)
```

- [ ] **Step 4.8: 更新 team_read_mailbox_tool.py 内部标识符**

- `ReadMailboxToolInput` → `TeamReadMailboxToolInput`
- `ReadMailboxTool` → `TeamReadMailboxTool`
- `name = "read_mailbox"` → `name = "team_read_mailbox"`
- `input_model = ReadMailboxToolInput` → `input_model = TeamReadMailboxToolInput`

- [ ] **Step 4.9: 更新 tools/__init__.py**

将 `__init__.py` 中所有导入和注册更新为新名称：

```python
# 替换以下旧导入：
from openharness.tools.read_mailbox_tool import ReadMailboxTool
from openharness.tools.swarm_create_run_tool import SwarmCreateRunTool
from openharness.tools.swarm_spawn_member_tool import SwarmSpawnMemberTool
from openharness.tools.swarm_list_members_tool import SwarmListMembersTool
from openharness.tools.swarm_wait_tool import SwarmWaitTool
from openharness.tools.swarm_shutdown_member_tool import SwarmShutdownMemberTool
from openharness.tools.swarm_send_message_tool import SwarmSendMessageTool

# 替换为新导入：
from openharness.tools.team_read_mailbox_tool import TeamReadMailboxTool
from openharness.tools.team_create_run_tool import TeamCreateRunTool
from openharness.tools.team_spawn_member_tool import TeamSpawnMemberTool
from openharness.tools.team_list_members_tool import TeamListMembersTool
from openharness.tools.team_wait_tool import TeamWaitTool
from openharness.tools.team_shutdown_member_tool import TeamShutdownMemberTool
from openharness.tools.team_send_message_tool import TeamSendMessageTool
```

在 `create_default_tool_registry()` 中同样替换实例化：
```python
# 旧：
ReadMailboxTool(), SwarmCreateRunTool(), SwarmSpawnMemberTool(),
SwarmListMembersTool(), SwarmWaitTool(), SwarmShutdownMemberTool(), SwarmSendMessageTool(),
# 新：
TeamReadMailboxTool(), TeamCreateRunTool(), TeamSpawnMemberTool(),
TeamListMembersTool(), TeamWaitTool(), TeamShutdownMemberTool(), TeamSendMessageTool(),
```

- [ ] **Step 4.10: 验证注册表无旧名称**

```bash
python -c "
from openharness.tools import create_default_tool_registry
r = create_default_tool_registry()
names = sorted(t.name for t in r._tools.values())
old = [n for n in names if n.startswith('swarm_') or n == 'read_mailbox']
print('OLD NAMES (should be empty):', old)
new_team = [n for n in names if n.startswith('team_')]
print('TEAM NAMES:', new_team)
"
```
Expected: `OLD NAMES (should be empty): []` 并列出所有 `team_*` 名称。

- [ ] **Step 4.11: Commit**

```bash
git add src/openharness/tools/
git commit -m "feat: rename swarm_* tools to team_* prefix (breaking change)"
```

---

## Task 5: team_spawn_member — blocked_by 支持

**Files:**
- Modify: `src/openharness/tools/team_spawn_member_tool.py`

- [ ] **Step 5.1: 在 TeamSpawnMemberInput 中新增字段**

在 `TeamSpawnMemberInput` pydantic model 中，在 `run_id` 字段之后添加：

```python
    blocked_by: list[str] | None = Field(
        default=None,
        description=(
            "Optional list of member names that must complete before this member is spawned. "
            "e.g. ['researcher', 'analyst']. Waits up to dependency_timeout seconds total."
        ),
    )
    dependency_timeout: int = Field(
        default=120,
        description="Total seconds to wait for blocked_by dependencies to complete (default 120).",
    )
```

- [ ] **Step 5.2: 在 execute() 中添加依赖等待逻辑**

在 `TeamSpawnMemberTool.execute()` 内，找到 `agent_id = f"{arguments.member}@{arguments.team}"` 这一行之后、`member = tf.members.get(agent_id)` 之前，插入：

```python
        # Dependency scheduling: wait for blocked_by members to complete
        if arguments.blocked_by:
            from openharness.swarm.completion_events import wait_for_completion
            from openharness.tasks.manager import get_task_manager as _gtm

            def _find_dep_task(dep_agent_id: str):
                all_tasks = _gtm().list_tasks()
                for t in reversed(all_tasks):
                    if f"Teammate: {dep_agent_id}" in (t.description or ""):
                        return t
                return None

            timeout_per_dep = float(arguments.dependency_timeout) / len(arguments.blocked_by)
            for dep_name in arguments.blocked_by:
                dep_agent_id = f"{dep_name}@{arguments.team}"
                done = await wait_for_completion(
                    run_id=arguments.run_id,
                    agent_id=dep_agent_id,
                    timeout=timeout_per_dep,
                )
                if not done:
                    dep_task = _find_dep_task(dep_agent_id)
                    if dep_task and dep_task.status in ("failed", "killed"):
                        return ToolResult(
                            output=f"Dependency '{dep_name}' failed (status={dep_task.status}). Cannot spawn '{arguments.member}'.",
                            is_error=True,
                        )
                    return ToolResult(
                        output=f"Dependency '{dep_name}' did not complete within {timeout_per_dep:.0f}s. Cannot spawn '{arguments.member}'.",
                        is_error=True,
                    )
```

- [ ] **Step 5.3: 更新工具 description**

将 `TeamSpawnMemberTool.description` 更新为：

```python
    description = (
        "Spawn a named member of a swarm team and start their work. "
        "Requires run_id from team_create_run for proper mailbox isolation. "
        "Use blocked_by=['member1','member2'] to wait for dependencies to complete before spawning. "
        "The member's agent_id is 'member@team'. "
        "Use team_send_message(task_id='member@team', run_id=run_id, message='...') to send follow-up instructions. "
        "Use team_read_mailbox(team='...') to receive their completion notifications."
    )
```

- [ ] **Step 5.4: 验证导入**

```bash
python -c "from openharness.tools.team_spawn_member_tool import TeamSpawnMemberTool; t = TeamSpawnMemberTool(); print(t.name, 'blocked_by' in t.input_model.model_fields)"
```
Expected: `team_spawn_member True`

- [ ] **Step 5.5: Commit**

```bash
git add src/openharness/tools/team_spawn_member_tool.py
git commit -m "feat: add blocked_by dependency scheduling to team_spawn_member"
```

---

## Task 6: 新增 team_request_plan_tool.py

**Files:**
- Create: `src/openharness/tools/team_request_plan_tool.py`
- Modify: `src/openharness/tools/__init__.py`

- [ ] **Step 6.1: 创建 team_request_plan_tool.py**

```python
"""Tool for requesting a teammate to submit an execution plan."""

from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from openharness.swarm.mailbox import TeammateMailbox, create_plan_approval_request_message
from openharness.swarm.protocol import ProtocolRequestState, new_request_id, pending_requests
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

logger = logging.getLogger(__name__)


class TeamRequestPlanInput(BaseModel):
    team: str = Field(description="Template team name")
    member: str = Field(description="Member name to request plan from (e.g. 'researcher')")
    task: str = Field(description="Task description to include in the plan request")
    run_id: str = Field(description="run_id from team_create_run (format: '{team}/{goal_slug}')")


class TeamRequestPlanTool(BaseTool):
    """Request a teammate to submit an execution plan for review before proceeding.

    Sends a plan_approval_request message to the member's run-specific mailbox.
    Returns request_id to pass to team_review_plan for approval/rejection.
    """

    name = "team_request_plan"
    description = (
        "Request a swarm team member to submit an execution plan for Leader review. "
        "Returns request_id to use with team_review_plan. "
        "The member will receive the request in their inbox and should respond with a plan."
    )
    input_model = TeamRequestPlanInput

    async def execute(self, arguments: TeamRequestPlanInput, context: ToolExecutionContext) -> ToolResult:
        del context
        agent_id = f"{arguments.member}@{arguments.team}"

        req_id = new_request_id()
        pending_requests[req_id] = ProtocolRequestState(
            request_id=req_id,
            type="plan_approval",
            sender="leader",
            target=agent_id,
            status="pending",
            payload=arguments.task,
        )

        try:
            from openharness.swarm.mailbox import get_team_task_mailbox_dir
            _t, _s = arguments.run_id.split("/", 1)
            member_inbox = get_team_task_mailbox_dir(_t, _s, agent_id)
            mailbox = TeammateMailbox(arguments.team, agent_id, inbox_dir=member_inbox)
            msg = create_plan_approval_request_message(
                sender="leader",
                recipient=agent_id,
                task=arguments.task,
                request_id=req_id,
            )
            await mailbox.write(msg)
        except Exception as exc:
            pending_requests.pop(req_id, None)
            logger.error("team_request_plan: failed to send to %s: %s", agent_id, exc)
            return ToolResult(output=str(exc), is_error=True)

        return ToolResult(
            output=f"Plan request sent to {agent_id}. request_id={req_id}",
            metadata={"request_id": req_id, "agent_id": agent_id},
        )
```

- [ ] **Step 6.2: 在 __init__.py 中添加导入和注册**

添加导入：
```python
from openharness.tools.team_request_plan_tool import TeamRequestPlanTool
```

在 `create_default_tool_registry()` 中，在 `TeamSendMessageTool()` 之后添加：
```python
        TeamRequestPlanTool(),
```

- [ ] **Step 6.3: 验证**

```bash
python -c "from openharness.tools import create_default_tool_registry; r = create_default_tool_registry(); print('team_request_plan' in r._tools)"
```
Expected: `True`

- [ ] **Step 6.4: Commit**

```bash
git add src/openharness/tools/team_request_plan_tool.py src/openharness/tools/__init__.py
git commit -m "feat: add team_request_plan tool"
```

---

## Task 7: 新增 team_review_plan_tool.py

**Files:**
- Create: `src/openharness/tools/team_review_plan_tool.py`
- Modify: `src/openharness/tools/__init__.py`

- [ ] **Step 7.1: 创建 team_review_plan_tool.py**

```python
"""Tool for approving or rejecting a teammate's submitted plan."""

from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from openharness.swarm.mailbox import TeammateMailbox, create_plan_approval_response_message
from openharness.swarm.protocol import match_response, pending_requests
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

logger = logging.getLogger(__name__)


class TeamReviewPlanInput(BaseModel):
    team: str = Field(description="Template team name")
    run_id: str = Field(description="run_id from team_create_run (format: '{team}/{goal_slug}')")
    request_id: str = Field(description="request_id returned by team_request_plan")
    approve: bool = Field(description="True to approve the plan, False to reject")
    feedback: str = Field(default="", description="Optional feedback text (especially useful when rejecting)")


class TeamReviewPlanTool(BaseTool):
    """Approve or reject a teammate's execution plan by request_id.

    Sends plan_approval_response to the teammate's mailbox and updates
    the ProtocolRequestState from 'pending' to 'approved' or 'rejected'.
    """

    name = "team_review_plan"
    description = (
        "Approve or reject a swarm team member's execution plan. "
        "Use request_id from team_request_plan. "
        "Set approve=False and provide feedback to ask the member to revise their plan."
    )
    input_model = TeamReviewPlanInput

    async def execute(self, arguments: TeamReviewPlanInput, context: ToolExecutionContext) -> ToolResult:
        del context
        state = pending_requests.get(arguments.request_id)
        if state is None:
            return ToolResult(
                output=f"Request '{arguments.request_id}' not found. It may have already been resolved or the process restarted.",
                is_error=True,
            )
        if state.status != "pending":
            return ToolResult(
                output=f"Request '{arguments.request_id}' is already {state.status}.",
                is_error=True,
            )

        try:
            from openharness.swarm.mailbox import get_team_task_mailbox_dir
            _t, _s = arguments.run_id.split("/", 1)
            target_inbox = get_team_task_mailbox_dir(_t, _s, state.target)
            mailbox = TeammateMailbox(arguments.team, state.target, inbox_dir=target_inbox)
            msg = create_plan_approval_response_message(
                sender="leader",
                recipient=state.target,
                request_id=arguments.request_id,
                approve=arguments.approve,
                feedback=arguments.feedback,
            )
            await mailbox.write(msg)
        except Exception as exc:
            logger.error("team_review_plan: failed to send response for %s: %s", arguments.request_id, exc)
            return ToolResult(output=str(exc), is_error=True)

        match_response("plan_approval_response", arguments.request_id, arguments.approve)
        verdict = "approved" if arguments.approve else "rejected"
        return ToolResult(
            output=f"Plan {verdict} ({arguments.request_id})" + (f". Feedback: {arguments.feedback}" if arguments.feedback else ""),
            metadata={"request_id": arguments.request_id, "approve": arguments.approve},
        )
```

- [ ] **Step 7.2: 在 __init__.py 中添加导入和注册**

添加导入：
```python
from openharness.tools.team_review_plan_tool import TeamReviewPlanTool
```

在 `TeamRequestPlanTool()` 之后添加：
```python
        TeamReviewPlanTool(),
```

- [ ] **Step 7.3: 验证**

```bash
python -c "from openharness.tools import create_default_tool_registry; r = create_default_tool_registry(); print('team_review_plan' in r._tools)"
```
Expected: `True`

- [ ] **Step 7.4: Commit**

```bash
git add src/openharness/tools/team_review_plan_tool.py src/openharness/tools/__init__.py
git commit -m "feat: add team_review_plan tool"
```

---

## Task 8: 新增 team_request_shutdown_tool.py

**Files:**
- Create: `src/openharness/tools/team_request_shutdown_tool.py`
- Modify: `src/openharness/tools/__init__.py`

- [ ] **Step 8.1: 创建 team_request_shutdown_tool.py**

```python
"""Tool for sending a graceful shutdown request with request_id tracking."""

from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from openharness.swarm.mailbox import TeammateMailbox, create_shutdown_request_with_tracking
from openharness.swarm.protocol import ProtocolRequestState, new_request_id, pending_requests
from openharness.tools.base import BaseTool, ToolExecutionContext, ToolResult

logger = logging.getLogger(__name__)


class TeamRequestShutdownInput(BaseModel):
    team: str = Field(description="Template team name")
    member: str = Field(description="Member name to shut down (e.g. 'researcher')")
    run_id: str = Field(description="run_id from team_create_run (format: '{team}/{goal_slug}')")


class TeamRequestShutdownTool(BaseTool):
    """Send a graceful shutdown request with request_id for confirmation tracking.

    Unlike team_shutdown_member (which sends a plain shutdown), this tool tracks
    whether the teammate acknowledged the shutdown via ProtocolRequestState.
    Check pending_requests[request_id].status to see if the teammate confirmed.
    """

    name = "team_request_shutdown"
    description = (
        "Send a graceful shutdown request to a swarm team member with request_id tracking. "
        "Returns request_id to check if the member acknowledged the shutdown. "
        "Use team_shutdown_member(force=True) if you need immediate termination."
    )
    input_model = TeamRequestShutdownInput

    async def execute(self, arguments: TeamRequestShutdownInput, context: ToolExecutionContext) -> ToolResult:
        del context
        agent_id = f"{arguments.member}@{arguments.team}"

        req_id = new_request_id()
        pending_requests[req_id] = ProtocolRequestState(
            request_id=req_id,
            type="shutdown",
            sender="leader",
            target=agent_id,
            status="pending",
            payload="",
        )

        try:
            from openharness.swarm.mailbox import get_team_task_mailbox_dir
            _t, _s = arguments.run_id.split("/", 1)
            member_inbox = get_team_task_mailbox_dir(_t, _s, agent_id)
            mailbox = TeammateMailbox(arguments.team, agent_id, inbox_dir=member_inbox)
            msg = create_shutdown_request_with_tracking(
                sender="leader",
                recipient=agent_id,
                request_id=req_id,
            )
            await mailbox.write(msg)
        except Exception as exc:
            pending_requests.pop(req_id, None)
            logger.error("team_request_shutdown: failed to send to %s: %s", agent_id, exc)
            return ToolResult(output=str(exc), is_error=True)

        return ToolResult(
            output=f"Shutdown request sent to {agent_id}. request_id={req_id} (check status with team_read_mailbox)",
            metadata={"request_id": req_id, "agent_id": agent_id},
        )
```

- [ ] **Step 8.2: 在 __init__.py 中添加导入和注册**

添加导入：
```python
from openharness.tools.team_request_shutdown_tool import TeamRequestShutdownTool
```

在 `TeamReviewPlanTool()` 之后添加：
```python
        TeamRequestShutdownTool(),
```

- [ ] **Step 8.3: 验证**

```bash
python -c "from openharness.tools import create_default_tool_registry; r = create_default_tool_registry(); print('team_request_shutdown' in r._tools)"
```
Expected: `True`

- [ ] **Step 8.4: Commit**

```bash
git add src/openharness/tools/team_request_shutdown_tool.py src/openharness/tools/__init__.py
git commit -m "feat: add team_request_shutdown tool with request_id tracking"
```

---

## Task 9: 更新 Leader 系统提示词

**Files:**
- Modify: `src/openharness/swarm/swarm_service.py`

- [ ] **Step 9.1: 替换工具表格中的旧名称**

在 `_LEADER_SYSTEM_PROMPT_TEMPLATE` 的工具表格中，将以下旧名称全量替换为新名称：

| 旧 | 新 |
|----|-----|
| `swarm_create_run` | `team_create_run` |
| `swarm_list_members` | `team_list_members` |
| `swarm_spawn_member` | `team_spawn_member` |
| `swarm_send_message` | `team_send_message` |
| `read_mailbox` | `team_read_mailbox` |
| `swarm_wait` | `team_wait` |
| `swarm_shutdown_member` | `team_shutdown_member` |

- [ ] **Step 9.2: 在工具表格末尾追加三个新工具条目**

在表格的 `team_shutdown_member` 行之后添加：

```
| `team_request_plan`     | 请求成员提交执行计划，返回 request_id（team="{team_name}", member="成员名", task="任务", run_id=<run_id>） |
| `team_review_plan`      | 审批或拒绝成员计划（team="{team_name}", run_id=<run_id>, request_id=<req_id>, approve=True/False, feedback=""） |
| `team_request_shutdown` | 带确认追踪的优雅关闭，返回 request_id（team="{team_name}", member="成员名", run_id=<run_id>） |
```

- [ ] **Step 9.3: 同步更新标准工作流程说明**

在"标准工作流程"中的步骤 1 之后，添加可选的计划审批步骤：

```
1.5 **（可选）计划审批** — 对于重要任务，用 `team_request_plan(team="{team_name}", member=..., task=..., run_id=<run_id>)` 请求成员先提交计划，审阅后用 `team_review_plan(...)` 批准或拒绝
```

- [ ] **Step 9.4: 验证提示词无旧名称**

```bash
python -c "
from openharness.swarm.swarm_service import _LEADER_SYSTEM_PROMPT_TEMPLATE
template = _LEADER_SYSTEM_PROMPT_TEMPLATE
old = ['swarm_create_run','swarm_list_members','swarm_spawn_member','swarm_send_message','read_mailbox\`','swarm_wait','swarm_shutdown_member']
found = [o for o in old if o in template]
print('OLD NAMES IN PROMPT (should be empty):', found)
"
```
Expected: `OLD NAMES IN PROMPT (should be empty): []`

- [ ] **Step 9.5: Commit**

```bash
git add src/openharness/swarm/swarm_service.py
git commit -m "feat: update Leader system prompt to team_* tool names and add protocol tools"
```

---

## Task 10: 最终验证

- [ ] **Step 10.1: 全量工具注册验证**

```bash
python -c "
from openharness.tools import create_default_tool_registry
r = create_default_tool_registry()
names = sorted(t.name for t in r._tools.values())
old = [n for n in names if n.startswith('swarm_') or n == 'read_mailbox']
team_tools = [n for n in names if n.startswith('team_')]
print('OLD (must be empty):', old)
print('TEAM TOOLS:', team_tools)
"
```
Expected: `OLD (must be empty): []` 且 `TEAM TOOLS` 包含 10 个 `team_*` 工具（含新增3个）。

- [ ] **Step 10.2: completion_events 基本逻辑验证**

```bash
python -c "
import asyncio
from openharness.swarm.completion_events import signal, wait_for_completion, reset

async def test():
    signal('team/run1', 'worker@team')  # signal before wait
    result = await wait_for_completion('team/run1', 'worker@team', timeout=1.0)
    assert result is True, 'should be True when already signalled'
    
    result2 = await wait_for_completion('team/run2', 'other@team', timeout=0.1)
    assert result2 is False, 'should be False on timeout'
    
    reset('team/run1', 'worker@team')
    reset('team/run2', 'other@team')
    print('completion_events: OK')

asyncio.run(test())
"
```
Expected: `completion_events: OK`

- [ ] **Step 10.3: protocol match_response 验证**

```bash
python -c "
from openharness.swarm.protocol import ProtocolRequestState, pending_requests, new_request_id, match_response

req_id = new_request_id()
pending_requests[req_id] = ProtocolRequestState(
    request_id=req_id, type='plan_approval',
    sender='leader', target='worker@team',
    status='pending', payload='do X',
)

# 类型不匹配应被忽略
match_response('shutdown_response', req_id, True)
assert pending_requests[req_id].status == 'pending', 'should still be pending'

# 正确类型应更新状态
match_response('plan_approval_response', req_id, True)
assert pending_requests[req_id].status == 'approved', 'should be approved'

# 重复响应应被忽略
match_response('plan_approval_response', req_id, False)
assert pending_requests[req_id].status == 'approved', 'should still be approved'

print('protocol match_response: OK')
"
```
Expected: `protocol match_response: OK`

- [ ] **Step 10.4: Leader 提示词无旧工具名**

```bash
python -c "
from openharness.swarm.swarm_service import _LEADER_SYSTEM_PROMPT_TEMPLATE as T
old = [n for n in ['swarm_create_run','swarm_list_members','swarm_spawn_member',
                   'swarm_send_message','read_mailbox\`','swarm_wait','swarm_shutdown_member']
       if n in T]
assert old == [], f'Found old names: {old}'
print('Leader prompt: OK')
"
```
Expected: `Leader prompt: OK`

- [ ] **Step 10.5: 运行现有测试套件**

```bash
cd /e/AI/OpenHarness && python -m pytest tests/ -x -q 2>&1 | tail -20
```
Expected: 全部通过或无新增失败。

- [ ] **Step 10.6: 最终 Commit（如有剩余变更）**

```bash
git add -A
git status  # 确认无意外文件
git commit -m "chore: final cleanup and verification for swarm-team-protocol-enhancements" --allow-empty
```
