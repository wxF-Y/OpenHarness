## ADDED Requirements

### Requirement: TeamRunState 枚举定义
`TeamRunState` 枚举 SHALL 定义团队运行的全部合法状态：`TEMPLATE`（仅配置，未运行）、`RUNNING`（Leader 正在执行）、`IDLE`（Leader 执行完成，成员可能仍存活）、`ARCHIVED`（已归档，不可恢复运行）。

#### Scenario: 读取不含 state 字段的旧 team.json
- **WHEN** 系统读取一个不含 `state` 字段的旧格式 `team.json`
- **THEN** 系统 SHALL 默认返回 `TeamRunState.TEMPLATE`，不抛出异常

#### Scenario: 状态字段序列化
- **WHEN** `TeamFile` 被持久化到磁盘
- **THEN** `state` 字段 SHALL 以字符串形式写入 JSON（如 `"RUNNING"`），而非整数

### Requirement: 状态转换合法性校验
`SwarmService.transition_state()` SHALL 仅允许以下合法转换路径：`TEMPLATE → RUNNING`、`RUNNING → IDLE`、`IDLE → RUNNING`（重新启动）、`IDLE → ARCHIVED`。非法转换 SHALL 抛出 `InvalidStateTransitionError`。

#### Scenario: 合法转换 TEMPLATE → RUNNING
- **WHEN** 调用 `transition_state(team, from_state=TEMPLATE, to_state=RUNNING)`
- **THEN** `team.json` 的 `state` 字段 SHALL 更新为 `"RUNNING"`，操作原子完成（先写 `.tmp` 再 replace）

#### Scenario: 非法转换 TEMPLATE → IDLE
- **WHEN** 调用 `transition_state(team, from_state=TEMPLATE, to_state=IDLE)`
- **THEN** 系统 SHALL 抛出 `InvalidStateTransitionError`，`team.json` 不变

#### Scenario: 并发写入安全性
- **WHEN** 两个并发 coroutine 同时尝试 `TEMPLATE → RUNNING` 转换
- **THEN** 恰好一个 SHALL 成功，另一个 SHALL 收到 `InvalidStateTransitionError` 或等待后读取到已更新的状态

### Requirement: 状态查询端点
Gateway SHALL 提供 `GET /api/swarm/teams/{team}/runs/{run_slug}/status` 端点，返回当前 `TeamRunState`。

#### Scenario: 查询运行中团队状态
- **WHEN** 客户端请求 `GET /api/swarm/teams/my-team/runs/run-001/status`
- **THEN** 响应 SHALL 包含 `{ "state": "RUNNING", "run_slug": "run-001" }`，HTTP 200
