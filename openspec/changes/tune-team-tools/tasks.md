## 1. 修复术语不一致 + 新工具描述优化

- [x] 1.1 将 `team_request_plan_tool.py`、`team_review_plan_tool.py`、`team_request_shutdown_tool.py` 中的 "swarm team member" 改为 "team member"，并补充使用时机说明
- [x] 1.2 将 `team_read_mailbox_tool.py` 描述补充"适合实时检查单条消息，与 team_wait 的区别"说明

## 2. 工作流顺序引导

- [x] 2.1 为 `team_create_run_tool.py`（入口标注）、`team_spawn_member_tool.py`（第二步）、`team_wait_tool.py`（等待汇总）、`team_send_message_tool.py`、`team_list_members_tool.py`、`team_shutdown_member_tool.py` 添加工作流位置提示

## 3. 区分 team_create / team_create_run 语义

- [x] 3.1 更新 `team_create_tool.py` 说明为"协调模式专用（Coordinator Mode）内存团队"，区分于 Swarm 文件型任务
- [x] 3.2 更新 `team_delete_tool.py` 保持与 team_create_tool 一致的语义标注
