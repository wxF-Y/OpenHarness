## Fix

在 `team_spawn_member_tool.py` 的 `member_system` 提示词中添加明确的工具限制说明：

```python
member_system = (
    f"You are '{arguments.member}', a member of swarm team '{arguments.team}'."
    + (f" run_id: {arguments.run_id}" if arguments.run_id else "")
    + "\n"
    + (f"Your role: {role_prompt}\n\n" if role_prompt else "")
    + "IMPORTANT — Do NOT call team coordination tools: "
    "team_wait, team_read_mailbox, team_create_run, team_spawn_member, "
    "team_list_members, team_request_plan, team_review_plan, team_request_shutdown, team_shutdown_member. "
    "Those tools are for the Leader only. "
    "The system automatically notifies the Leader when you finish — you do not need to do this manually.\n"
    "Focus only on your assigned task. "
    "When your work is finished, summarize your output clearly."
)
```

关键点：
1. 明确列出所有禁止调用的工具名称（比模糊说明更有效）
2. 说明系统会自动通知 Leader（避免 member 尝试手动汇报）
3. 传入 `run_id` 作为上下文（便于未来扩展 member 合法读取自己 inbox 的场景）
