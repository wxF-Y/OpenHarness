## 1. 工具集边界定义（tools/__init__.py）

- [x] 1.1 在 `src/openharness/tools/__init__.py` 中添加 `LEADER_EXCLUSIVE_TOOLS: frozenset[str]` 常量，包含所有 leader 专属 `team_*` 工具名称（`team_create_run`、`team_spawn_member`、`team_list_members`、`team_wait`、`team_read_mailbox`、`team_send_message`、`team_shutdown_member`、`team_request_plan`、`team_review_plan`、`team_request_shutdown`、`team_create`、`team_delete`）
- [x] 1.2 在 `src/openharness/tools/__init__.py` 中添加 `create_member_tool_registry(mcp_manager=None) -> ToolRegistry` 函数，从全量注册表中排除 `LEADER_EXCLUSIVE_TOOLS`
- [x] 1.3 将 `create_member_tool_registry` 加入 `__all__` 导出列表

## 2. In-Process 后端接入（swarm/in_process.py）

- [x] 2.1 在 `src/openharness/swarm/in_process.py` 的 `_build_member_query_context()` 函数中，将 `create_default_tool_registry()` 替换为 `create_member_tool_registry()`
- [x] 2.2 更新对应的 import 语句，引入 `create_member_tool_registry`

## 3. 系统提示词简化（可选，降低提示词冗余）

- [x] 3.1 在 `src/openharness/tools/team_spawn_member_tool.py` 的 `member_system` 字符串中，移除或精简"IMPORTANT — Do NOT call team coordination tools..."段落（因工具已从 API schema 层消失，文字禁令变为多余）

## 4. 验证

- [x] 4.1 运行现有测试套件，确认无回归（`pytest tests/` 或项目对应的测试命令）
- [x] 4.2 手动验证：启动一个 swarm team，检查 member session 的工具列表中不含 `team_spawn_member` 等 leader 专属工具
- [x] 4.3 手动验证：确认 leader session 的工具列表完整，包含所有 `team_*` 协调工具
