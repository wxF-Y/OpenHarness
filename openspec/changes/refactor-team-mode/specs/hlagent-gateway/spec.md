## ADDED Requirements

### Requirement: 团队运行状态查询端点
Gateway SHALL 提供 `GET /api/swarm/teams/{team}/runs/{run_slug}/status` 端点，返回指定运行快照的 `TeamRunState`。

#### Scenario: 查询运行中团队状态
- **WHEN** 客户端请求 `GET /api/swarm/teams/my-team/runs/run-001/status`
- **THEN** 响应 SHALL 为 `{ "state": "RUNNING", "run_slug": "run-001" }`，HTTP 200

#### Scenario: 查询不存在的运行快照
- **WHEN** 客户端请求 `GET /api/swarm/teams/my-team/runs/nonexistent/status`
- **THEN** 响应 SHALL 为 HTTP 404，body 含 `{ "detail": "Run not found" }`

## RENAMED Requirements

### Requirement: 团队历史运行列表
FROM: `GET /api/swarm/teams/{team}/tasks`
TO: `GET /api/swarm/teams/{team}/runs`

## REMOVED Requirements

### Requirement: GET /api/swarm/teams/{team}/tasks 端点
**Reason**: 路径中 `tasks` 与内部 `run_slug` 概念不一致，造成认知负担
**Migration**: 使用 `GET /api/swarm/teams/{team}/runs` 替代，响应格式不变
