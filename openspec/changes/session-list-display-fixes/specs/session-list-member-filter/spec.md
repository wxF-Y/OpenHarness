## ADDED Requirements

### Requirement: list_all_sessions 过滤 Swarm member session
`list_all_sessions()` SHALL 只返回 leader session，过滤掉 Swarm 团队运行中产生的 member session。

#### Scenario: 有团队任务运行时，member session 不出现在列表
- **WHEN** 存在 `~/.hlagent/teams-tasks/*/team.json`，其中 `members[].session_id` 为 member 的 gateway UUID
- **THEN** `list_all_sessions()` 不包含这些 member session，只返回 leader session 和普通独立 session

#### Scenario: 无团队任务时，行为不变
- **WHEN** `~/.hlagent/teams-tasks/` 目录不存在或为空
- **THEN** `list_all_sessions()` 行为与原来完全一致，返回全量扫描结果

#### Scenario: team.json 损坏时安全降级
- **WHEN** `~/.hlagent/teams-tasks/*/team.json` 存在但内容无法解析（JSON 损坏）
- **THEN** 系统跳过该文件，记录 WARNING，继续处理其他 team.json，不影响 `list_all_sessions()` 返回结果
