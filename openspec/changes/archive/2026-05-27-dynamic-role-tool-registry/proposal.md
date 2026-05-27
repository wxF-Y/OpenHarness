## Why

当前 swarm 团队中，leader 和 member 的工具集区分完全依赖系统提示词中的文字约束（"禁止调用 team_wait、team_spawn_member..."），这是软约束，LLM 在特定场景下会忽略它。根本修复是在 session 创建时就将工具集固化——member 根本无法"看见" leader 专属工具，从而从 API 层消除越权调用的可能性。

## What Changes

- 在 `tools/__init__.py` 新增 `LEADER_EXCLUSIVE_TOOLS` 常量集合，定义 leader 专属的 `team_*` 协调工具列表
- 新增 `create_member_tool_registry()` 工厂函数，返回排除 leader 专属工具后的注册表
- 修改 `swarm/in_process.py` 的 `_build_member_query_context()`，改用 `create_member_tool_registry()` 替代 `create_default_tool_registry()`
- 修改 `swarm/subprocess_backend.py`（如存在），spawn 子进程时通过 CLI flag 传递 `--disallowed-tools`
- 可选：将 member 系统提示词中关于"禁止调用"的文字说明简化（因为工具已从 schema 层消失）

## Capabilities

### New Capabilities

- `role-scoped-tool-registry`：按角色动态生成工具注册表——leader 获得完整工具集，member 获得仅含基础工具的受限集合，约束从提示词层提升至 API schema 层

### Modified Capabilities

（无现有 spec 的行为改变）

## Impact

- **直接修改**：`src/openharness/tools/__init__.py`、`src/openharness/swarm/in_process.py`
- **次要修改**：`src/openharness/swarm/subprocess_backend.py`（子进程 spawn 路径）
- **可选简化**：`src/openharness/swarm/swarm_service.py` 中的 leader 系统提示词、`src/openharness/tools/team_spawn_member_tool.py` 中的 member 系统提示词
- **不影响**：现有 team_* 工具实现、协议状态机、mailbox 机制、API 接口
