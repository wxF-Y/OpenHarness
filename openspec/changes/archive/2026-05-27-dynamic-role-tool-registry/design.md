## Context

OpenHarness swarm 团队由一个 leader session 和若干 member session 组成。当前所有 session 均通过 `create_default_tool_registry()` 创建完全相同的工具注册表（约 40 个工具），包含所有 `team_*` 协调工具。

leader/member 的行为差异完全依赖系统提示词中的文字约束：
- leader 系统提示词（`_LEADER_SYSTEM_PROMPT_TEMPLATE`）列出可用的协调工具
- member 系统提示词（`team_spawn_member_tool.py` 中内联）明确写"IMPORTANT — Do NOT call team_wait, team_read_mailbox..."

此机制的缺陷在于工具仍然出现在 API schema 中，LLM 在某些场景下会无视文字禁令直接调用，导致协调混乱（commit `fix: prohibit member from calling leader coordination tools in system prompt` 已记录一次真实发生的越权调用）。

**关键代码位置：**
- `src/openharness/tools/__init__.py:58` — `create_default_tool_registry()`，全量注册表
- `src/openharness/swarm/in_process.py:453` — member session 创建时调用全量注册表
- `src/openharness/ui/runtime.py:361` — 主 session（leader）创建时调用全量注册表

## Goals / Non-Goals

**Goals:**
- leader 工具集 = 所有工具（含全部 `team_*` 协调工具）
- member 工具集 = 基础工具（不含 leader 专属 `team_*` 协调工具）
- 工具集在 session 创建时固化，从 API schema 层消除 member 对 leader 工具的访问
- 不改变任何工具的实现逻辑、协议状态机、或 mailbox 机制

**Non-Goals:**
- 不引入新的 `team_*` 工具
- 不修改 subprocess 子进程 spawn 路径（其工具约束已通过子进程独立注册表隔离）
- 不实现细粒度的动态权限叠加（如"leader 可给 member 临时授权某工具"）

## Decisions

### 决策 1：在 `tools/__init__.py` 定义工具集边界，而非在 swarm 模块内

**选择**：将 `LEADER_EXCLUSIVE_TOOLS` 常量和 `create_member_tool_registry()` 函数定义在 `tools/__init__.py` 中。

**理由**：工具注册表的职责属于 `tools` 模块；swarm 模块消费工具注册表但不应承担工具集划分的决策。将边界定义在源头，避免各消费方各自维护一份"哪些工具归 leader"的列表。

**备选方案**：在 `swarm/in_process.py` 内硬编码排除列表 → 被否：散布到各后端，难以同步。

---

### 决策 2：member 注册表用排除法（黑名单），而非包含法（白名单）

**选择**：`create_member_tool_registry()` 从全量工具集中排除 `LEADER_EXCLUSIVE_TOOLS`，而非显式列出 member 允许的工具。

**理由**：白名单会导致每次新增工具都需要手动决定是否加入 member 集合，容易遗漏；黑名单只需维护 leader 专属工具的边界，语义更清晰（"leader 独占什么"比"member 允许什么"更容易推理）。

---

### 决策 3：不修改 subprocess 后端路径

**选择**：本次变更仅修改 in-process 后端（`swarm/in_process.py`），不修改 subprocess/tmux 后端。

**理由**：subprocess/tmux 后端 spawn 独立进程，该进程有自己的 `create_default_tool_registry()` 调用，天然隔离。要限制其工具集需通过 `--disallowed-tools` CLI flag，是独立且更复杂的工作，不应与本次变更捆绑。

---

### LEADER_EXCLUSIVE_TOOLS 边界（完整清单）

以下工具仅限 leader 调用，member 工具注册表中将排除它们：

```python
LEADER_EXCLUSIVE_TOOLS: frozenset[str] = frozenset({
    "team_create_run",
    "team_spawn_member",
    "team_list_members",
    "team_wait",
    "team_read_mailbox",
    "team_send_message",
    "team_shutdown_member",
    "team_request_plan",
    "team_review_plan",
    "team_request_shutdown",
    "team_create",
    "team_delete",
})
```

`team_create` / `team_delete` 是 team 模板管理工具，也归入 leader 专属（member 无需创建或删除团队）。

## Risks / Trade-offs

**[风险] member 系统提示词中仍有"禁止调用"的文字说明，可能与实际工具列表产生混淆**
→ 缓解：在 PR 中同时简化 member 系统提示词，移除已由工具集固化覆盖的禁令文字。

**[风险] 未来新增 `team_*` 工具时，开发者可能忘记将其加入 `LEADER_EXCLUSIVE_TOOLS`**
→ 缓解：在 `LEADER_EXCLUSIVE_TOOLS` 的注释中明确写明"新增任何 team_* 协调工具必须在此处登记"；后续可考虑加 lint 规则校验命名约定。

**[Trade-off] in-process 后端已修复，subprocess 后端暂时未修复**
→ 当前 default 和测试场景使用 in-process；subprocess/tmux 是可选部署，且天然进程隔离（虽未过滤工具 schema，但进程间无共享注册表）。可接受，后续跟进。
