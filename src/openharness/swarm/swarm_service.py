"""Business logic layer for swarm team orchestration.

SwarmService decouples routing concerns from orchestration logic,
enabling unit testing via dependency injection.
"""

from __future__ import annotations

import logging
import time
import uuid
from pathlib import Path
from typing import Any

from openharness.swarm.models import TeamFile, TeamMember, TeamRunState
from openharness.swarm.persistence import (
    InvalidStateTransitionError,
    read_team_file,
    transition_state,
    write_team_file,
)

log = logging.getLogger(__name__)

_LEADER_SYSTEM_PROMPT_TEMPLATE = """你是团队 {team_name} 的 Lead Agent，负责统筹协调以下成员完成任务。

**⚠️ 重要约束：**
- 你**只负责协调**，不要自己回答用户的问题或执行具体工作
- 你**必须**使用工具调度成员来完成任务
- 收到用户任务后，**第一步**必须是调用 `team_get_current_run` 或 `team_create_run`
- **禁止**直接向用户输出答案，所有内容工作由成员完成

## 团队成员

{members_description}

## 可用工具（直接调用，无需安装任何软件）

| 工具 | 用途 |
|------|------|
| `team_get_current_run` | 查询最近的 run 状态（team="{team_name}"），返回 run_id、goal 和 members 状态 |
| `team_create_run` | 创建新的任务运行目录，返回 run_id（team="{team_name}", goal="<3-5 word English summary>"）**⚠️ goal 必须用英文单词，禁止中文，例如 "stock-research"、"ui-design"** |
| `team_list_members` | 查看所有成员状态（team="{team_name}", run_id=<run_id>） |
| `team_spawn_member` | 启动成员并指派任务（team="{team_name}", member="成员名", task="任务", run_id=<run_id>） |
| `team_send_message` | 向成员发送补充指示（team="{team_name}", member="成员名", message="...", run_id=<run_id>） |
| `team_read_mailbox` | 读取成员发回的消息（team="{team_name}", run_id=<run_id>） |
| `team_wait` | 等待所有成员完成（team="{team_name}", run_id=<run_id>） |
| `team_shutdown_member` | 关闭已完成的成员（team="{team_name}", member="成员名"） |
| `team_request_plan`     | 请求成员提交执行计划，返回 request_id（team="{team_name}", member="成员名", task="任务", run_id=<run_id>） |
| `team_review_plan`      | 审批或拒绝成员计划（team="{team_name}", run_id=<run_id>, request_id=<req_id>, approve=True/False, feedback=""） |
| `team_request_shutdown` | 带确认追踪的优雅关闭，返回 request_id（team="{team_name}", member="成员名", run_id=<run_id>） |

## 标准工作流程

0. **查询或创建运行** — 先调用 `team_get_current_run(team="{team_name}")` 检查是否有活跃 run：
   - 若返回有效 run_id 且任务相关（如"市场调研" + "补充竞品分析"），复用该 run_id
   - 若无 run 或任务主题不同（如"市场调研" + "设计 logo"），调用 `team_create_run(team="{team_name}", goal="<english-slug>")` 创建新 run
   ⚠️ **goal 必须是英文（用连字符分隔，如 stock-research、ui-design），禁止中文，否则系统无法识别！**
   ⚠️ **将 run_id 记住，后续每个工具调用都必须传入！**
1. **理解需求** — 明确用户任务，制定分工方案
1.5 **（可选）计划审批** — 对于重要任务，用 `team_request_plan(team="{team_name}", member=..., task=..., run_id=<run_id>)` 请求成员先提交计划，审阅后用 `team_review_plan(...)` 批准或拒绝
2. **启动成员** — 用 `team_spawn_member(team="{team_name}", member=..., task=..., run_id=<run_id>)` 指派子任务（可并行）
3. **等待完成** — 用 `team_wait(team="{team_name}", run_id=<run_id>)` 等待所有成员完成
4. **补充指示** — 如需要，用 `team_send_message(team="{team_name}", member=..., message=..., run_id=<run_id>)` 向成员发送追加说明
5. **汇总结果** — 整合各成员的完成通知内容，向用户输出最终结果
6. **（可选）关闭** — 用 `team_shutdown_member` 关闭已完成的成员

**任务相关性判断示例：**
- 相关任务（复用 run）："市场调研" + "补充竞品分析" = 复用同一 run
- 不相关任务（新建 run）："市场调研" + "设计 logo" = 创建新 run

## 注意

- **不要安装任何工具**（clawteam、oh 等），成员已就绪
- ⚠️ **run_id 必须在所有 team_spawn_member、team_wait、team_list_members 调用中传入**
- 成员通过 `idle_notification` 通知你完成，`payload.summary` 包含摘要
- 你只负责协调，具体内容工作由成员完成
- 用户可能发送追加说明，请相应调整任务分配"""


class SwarmService:
    """Encapsulates swarm team orchestration operations.

    Accepts TeamLifecycleManager and BackendRegistry via constructor for
    testability. In production, a singleton is stored in app.state.swarm_service.
    """

    def __init__(self, lifecycle_manager=None, registry=None) -> None:
        self._lifecycle = lifecycle_manager
        self._registry = registry

    def _get_lifecycle(self):
        if self._lifecycle is not None:
            return self._lifecycle
        from openharness.swarm.team_lifecycle import TeamLifecycleManager
        return TeamLifecycleManager()

    def _get_registry(self):
        if self._registry is not None:
            return self._registry
        from openharness.swarm.registry import get_backend_registry
        return get_backend_registry()

    # ------------------------------------------------------------------
    # Team read operations (thin wrappers for route layer)
    # ------------------------------------------------------------------

    def list_teams(self, template_only: bool = True) -> list[TeamFile]:
        import re
        mgr = self._get_lifecycle()
        teams = mgr.list_teams()
        if template_only:
            pattern = re.compile(r'-\d{8}-\d{6}$')
            teams = [t for t in teams if not pattern.search(t.name)]
        return teams

    def get_team(self, team_name: str) -> TeamFile | None:
        return read_team_file(team_name)

    def list_runs(self, team_name: str) -> list[dict]:
        """Return all run records: teams-tasks/ (7-ARCH) + timestamp clones (compat)."""
        import re
        mgr = self._get_lifecycle()
        runs = list(mgr.list_tasks(team_name))

        prefix = f"{team_name}-"
        ts_pattern = re.compile(r'-\d{8}-\d{6}$')
        for t in mgr.list_teams():
            if t.name.startswith(prefix) and ts_pattern.search(t.name):
                runs.append({
                    "run_slug": t.name,
                    "goal": "",
                    "started_at": t.created_at,
                    "member_count": len(t.members),
                    "source": "7-NEW",
                })

        runs.sort(key=lambda r: r.get("started_at") or 0, reverse=True)
        return runs

    def get_run_state(self, team_name: str, run_slug: str) -> TeamRunState | None:
        """Return the TeamRunState for a specific run, or None if not found."""
        from openharness.config.paths import get_config_dir
        run_path = get_config_dir() / "teams-tasks" / team_name / run_slug / "team.json"
        if not run_path.exists():
            return None
        try:
            tf = TeamFile.load(run_path)
            return tf.state
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Member management
    # ------------------------------------------------------------------

    def add_member(self, team_name: str, member: TeamMember) -> TeamMember:
        mgr = self._get_lifecycle()
        updated = mgr.add_member(team_name, member)
        return updated.members[member.agent_id]

    def remove_member(self, team_name: str, agent_id: str) -> None:
        mgr = self._get_lifecycle()
        mgr.remove_member(team_name, agent_id)

    # ------------------------------------------------------------------
    # Team start (Leader session bootstrap)
    # ------------------------------------------------------------------

    async def start_team(self, team_name: str, task: str = "", model: str | None = None) -> dict[str, Any]:
        tf = read_team_file(team_name)
        if tf is None:
            raise ValueError(f"Team {team_name!r} not found")
        if not tf.members:
            raise ValueError("团队无成员，请先添加成员")

        members_lines = []
        for m in tf.members.values():
            raw_desc = m.prompt.split("\n")[0][:80] if m.prompt else "通用助手"
            desc = raw_desc.encode("utf-8", errors="replace").decode("utf-8")
            members_lines.append(f"- {m.name}: {desc}")
        members_description = "\n".join(members_lines)
        leader_system_prompt = (
            _LEADER_SYSTEM_PROMPT_TEMPLATE
            .replace("{team_name}", team_name)
            .replace("{members_description}", members_description)
        )

        from services.session_manager import session_mgr
        from hlagent_sdk.web_host import AgentSessionConfig
        from openharness.ui.protocol import FrontendRequest

        orchestrator_session_id = uuid.uuid4().hex
        workspaces_root = Path.home() / ".hlagent" / "workspaces"
        managed_path = workspaces_root / orchestrator_session_id
        managed_path.mkdir(parents=True, exist_ok=True)

        config = AgentSessionConfig(
            model=model,
            cwd=str(managed_path),
            system_prompt=leader_system_prompt,
            expert_role_label=f"🤝 {team_name}",
        )
        _, host = session_mgr.create_with_id(
            orchestrator_session_id,
            config,
            expert_role_label=f"🤝 {team_name}",
        )
        if host is None:
            raise RuntimeError("无法创建 Orchestrator session")

        if task.strip():
            await host.push_request(FrontendRequest(type="submit_line", line=task))

        return {
            "session_id": orchestrator_session_id,
            "task_team": team_name,
        }

    # ------------------------------------------------------------------
    # Transcript lookup
    # ------------------------------------------------------------------

    @staticmethod
    def format_snapshot_transcript(snapshot: dict) -> str:
        """Format a session snapshot as readable markdown."""
        msgs = snapshot.get("messages", [])
        parts: list[str] = []
        for msg in msgs:
            role = str(msg.get("role", "")).capitalize()
            content = msg.get("content", "")
            if isinstance(content, list):
                text_parts: list[str] = []
                for b in content:
                    if not isinstance(b, dict):
                        continue
                    btype = b.get("type", "")
                    if btype == "text":
                        t = b.get("text", "").strip()
                        if t:
                            text_parts.append(t)
                    elif btype == "tool_use":
                        import json as _j
                        nm = b.get("name", "")
                        inp = b.get("input", {})
                        text_parts.append(f"`{nm}({_j.dumps(inp, ensure_ascii=False)[:120]})`")
                text = "\n".join(text_parts)
            else:
                text = str(content).strip()
            if text:
                parts.append(f"## {role}\n\n{text}")
        return "\n\n".join(parts)

    async def get_transcript(
        self, agent_id: str, run_id: str | None, safe_segment_re, safe_run_slug_re
    ) -> dict[str, Any]:
        """Resolve and return transcript for *agent_id*, with run_id fallback chain."""
        import os
        from openharness.services.session_backend import DEFAULT_SESSION_BACKEND

        parts = agent_id.split("@", 1)
        if len(parts) != 2:
            raise ValueError("agent_id must be in 'name@team' format")
        name, team = parts

        if run_id:
            try:
                run_team_part, run_slug = run_id.split("/", 1)
                if safe_segment_re.match(run_team_part) and safe_run_slug_re.match(run_slug):
                    from openharness.config.paths import get_config_dir
                    from openharness.swarm.models import TeamFile
                    base = get_config_dir() / "teams-tasks"
                    run_path = (base / run_team_part / run_slug / "team.json").resolve()
                    if str(run_path).startswith(str(base.resolve())) and run_path.exists():
                        run_tf = TeamFile.load(run_path)
                        run_member = run_tf.members.get(agent_id)
                        if run_member and run_member.session_id:
                            cwd = run_member.cwd or os.getcwd()
                            snapshot = DEFAULT_SESSION_BACKEND.load_by_id(cwd, run_member.session_id)
                            if snapshot:
                                return {
                                    "session_id": run_member.session_id,
                                    "transcript": self.format_snapshot_transcript(snapshot),
                                    "messages": snapshot.get("messages", []),
                                }
                        if run_member and run_member.task_id:
                            from openharness.tasks.manager import get_task_manager
                            task_mgr = get_task_manager()
                            task = task_mgr.get_task(run_member.task_id)
                            if task and task.output_file and task.output_file.exists():
                                raw = task.output_file.read_text(encoding="utf-8", errors="replace")
                                return {"session_id": None, "task_id": run_member.task_id, "transcript": raw, "source": "task_output"}
            except Exception as exc:
                log.debug("run_id transcript lookup failed: %s", exc)

        tf = read_team_file(team)
        if tf is None:
            raise LookupError(f"Team {team!r} not found")
        member = tf.members.get(agent_id)
        if member is None:
            raise LookupError(f"Agent {agent_id!r} not found")

        if member.session_id:
            cwd = member.cwd or os.getcwd()
            snapshot = DEFAULT_SESSION_BACKEND.load_by_id(cwd, member.session_id)
            if snapshot:
                return {
                    "session_id": member.session_id,
                    "transcript": self.format_snapshot_transcript(snapshot),
                    "messages": snapshot.get("messages", []),
                }

        if member.task_id:
            from openharness.tasks.manager import get_task_manager
            task_mgr = get_task_manager()
            task = task_mgr.get_task(member.task_id)
            if task and task.output_file and task.output_file.exists():
                try:
                    raw = task.output_file.read_text(encoding="utf-8", errors="replace")
                    return {"session_id": None, "task_id": member.task_id, "transcript": raw, "source": "task_output"}
                except Exception:
                    pass

        from openharness.tasks.manager import get_task_manager
        task_mgr = get_task_manager()
        for t in reversed(task_mgr.list_tasks()):
            if f"Teammate: {agent_id}" in (t.description or ""):
                if t.output_file and t.output_file.exists():
                    try:
                        raw = t.output_file.read_text(encoding="utf-8", errors="replace")
                        return {"session_id": None, "task_id": t.id, "transcript": raw, "source": "task_output"}
                    except Exception:
                        pass

        raise LookupError(f"Agent {agent_id!r} has no transcript yet")
