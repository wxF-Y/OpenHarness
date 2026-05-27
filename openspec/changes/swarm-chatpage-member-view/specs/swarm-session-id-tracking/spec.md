## ADDED Requirements

### Requirement: Agent spawn 后 session_id 回写 TeamMember
当 Swarm 团队通过新 API 启动时，每个 Agent spawn 后系统 SHALL 将其 `session_id` 回写到对应 `TeamMember` 并持久化，使 transcript API 可用。

#### Scenario: spawn 完成后 session_id 立即可查
- **WHEN** `POST /api/swarm/teams/{name}/start` 调用后 Agent spawn 成功
- **THEN** 对应 `TeamMember.session_id` SHALL 在 `team.json` 中被更新（非 null）
- **THEN** `GET /api/swarm/agents/{agent_id}/transcript` SHALL 返回 200（而非 404）

#### Scenario: 预生成 session_id 传入子进程
- **WHEN** SubprocessBackend spawn Agent
- **THEN** session_id SHALL 在 spawn 前预生成（UUID）并通过环境变量或 CLI 参数传给子进程
- **THEN** 子进程 SHALL 使用传入的 session_id 创建会话，而非自行生成

#### Scenario: InProcessBackend session_id 同步设置
- **WHEN** InProcessBackend 在同进程 asyncio Task 中启动 Agent
- **THEN** session_id SHALL 在 Task 创建时确定并同步回写 TeamMember

#### Scenario: spawn 失败时 session_id 保持为 null
- **WHEN** Agent spawn 失败（进程启动异常）
- **THEN** TeamMember.session_id SHALL 保持 null
- **THEN** `swarm_status` 事件 SHALL 包含失败通知
