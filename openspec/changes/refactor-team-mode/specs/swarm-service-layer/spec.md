## ADDED Requirements

### Requirement: SwarmService 封装编排操作
`SwarmService` 类 SHALL 封装所有团队编排操作（`start_team`、`spawn_member`、`send_message`、`shutdown_member`、`get_transcript`），路由层 SHALL 仅负责 HTTP 适配（参数解析、响应序列化），不包含业务逻辑。

#### Scenario: 路由层调用 SwarmService
- **WHEN** `POST /api/swarm/teams/{team}/start` 被调用
- **THEN** 路由处理函数 SHALL 通过 FastAPI `Depends` 获取 `SwarmService` 实例，调用 `service.start_team(team_name, task)` 并返回其结果，路由函数体 SHALL 不超过 20 行

#### Scenario: SwarmService 单例生命周期
- **WHEN** FastAPI 应用启动（`lifespan` 事件）
- **THEN** `SwarmService` 单例 SHALL 被创建并存入 `app.state.swarm_service`，关闭时 SHALL 调用其 cleanup 方法

### Requirement: SwarmService 可单元测试
`SwarmService` SHALL 通过构造函数接收 `TeamLifecycleManager` 和 `BackendRegistry` 依赖，不依赖全局状态，从而可在测试中注入 mock 对象。

#### Scenario: 注入 mock 依赖测试
- **WHEN** 测试代码构造 `SwarmService(lifecycle_manager=MockLifecycle(), registry=MockRegistry())`
- **THEN** 测试 SHALL 能够独立验证 `start_team` 业务逻辑，无需启动 FastAPI 应用

### Requirement: 路由层行数约束
`HLAgent/gateway/routers/swarm.py` 的总行数 SHALL 不超过 300 行（当前 705 行）。超出部分 SHALL 迁移至 `SwarmService` 或独立工具函数。

#### Scenario: CI 行数检查
- **WHEN** PR 修改了 `swarm.py`
- **THEN** 文件行数 SHALL 不超过 300 行（可通过 `wc -l` 验证）
