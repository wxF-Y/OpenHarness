## 1. 后端 team_lifecycle 拆分

- [x] 1.1 从 `team_lifecycle.py` 提取数据模型：将 `TeamMember`、`TeamFile`、`AllowedPath` dataclass 和 `TeamRunState` Enum 迁移到新文件 `src/openharness/swarm/models.py`
- [x] 1.2 从 `team_lifecycle.py` 提取文件 I/O：将 `team.json` 读写、`.tmp` 原子写入逻辑迁移到 `src/openharness/swarm/persistence.py`
- [x] 1.3 更新 `team_lifecycle.py` 改为 import `models.py` 和 `persistence.py`，确保 `TeamLifecycleManager` 行为不变
- [x] 1.4 更新 `src/openharness/swarm/__init__.py` 重导出所有公开符号，确保外部 import 路径不变
- [x] 1.5 验证 `team_lifecycle.py` 行数降至 600 行以下

## 2. 后端 in_process 拆分

- [x] 2.1 从 `in_process.py` 提取中止控制：将 `TeammateAbortController` 迁移到 `src/openharness/swarm/abort.py`
- [x] 2.2 从 `in_process.py` 提取上下文管理：将 `TeammateContext` dataclass 和 ContextVar 单例迁移到 `src/openharness/swarm/context.py`
- [x] 2.3 更新 `in_process.py` 改为 import `abort.py` 和 `context.py`，`InProcessBackend` 行为不变
- [x] 2.4 验证 `in_process.py` 行数降至 500 行以下

## 3. 显式状态机引入

- [x] 3.1 在 `models.py` 添加 `TeamRunState` Enum（`TEMPLATE/RUNNING/IDLE/ARCHIVED`）
- [x] 3.2 在 `TeamFile` 添加可选 `state: Optional[TeamRunState] = TeamRunState.TEMPLATE` 字段，向后兼容旧 `team.json`（缺失时默认 `TEMPLATE`）
- [x] 3.3 在 `persistence.py` 确保 `TeamRunState` 以字符串序列化到 JSON
- [x] 3.4 定义 `InvalidStateTransitionError` 异常类，添加合法转换矩阵
- [x] 3.5 实现 `transition_state(team_name, from_state, to_state)` 函数，通过原子写入更新状态

## 4. SwarmService 服务层

- [x] 4.1 创建 `src/openharness/swarm/swarm_service.py`，定义 `SwarmService` 类，构造函数接收 `TeamLifecycleManager` 和 `BackendRegistry`
- [x] 4.2 将 `swarm.py` 中 `start_team` 业务逻辑（行 644-705）迁移到 `SwarmService.start_team()`
- [x] 4.3 将 `swarm.py` 中成员管理业务逻辑（添加/移除/获取成员）迁移到 `SwarmService` 对应方法
- [x] 4.4 在 `HLAgent/gateway/app.py` 或 `lifespan` 中初始化 `SwarmService` 单例，存入 `app.state.swarm_service`
- [x] 4.5 将 `swarm.py` 路由处理函数改为通过 `Depends` 获取 `SwarmService`，调用其方法
- [x] 4.6 验证 `swarm.py` 行数降至 300 行以下

## 5. API 重命名（BREAKING）

- [x] 5.1 在 `swarm.py` 将 `GET /api/swarm/teams/{team}/tasks` 路由重命名为 `GET /api/swarm/teams/{team}/runs`
- [x] 5.2 添加新端点 `GET /api/swarm/teams/{team}/runs/{run_slug}/status` 返回 `TeamRunState`
- [x] 5.3 在 `HLAgent/web/src/utils/swarmApi.ts` 将 `/tasks` 调用更新为 `/runs`

## 6. 前端 hook 提取

- [x] 6.1 创建 `HLAgent/web/src/hooks/useSwarmTeam.ts`，封装成员列表获取、`swarmStore` WebSocket 订阅逻辑
- [x] 6.2 hook 返回 `{ members, teamState, teamFile, isLoading, error, refresh }`
- [x] 6.3 将 `SwarmPage.tsx` 中 `members`、`teamState` 相关 `useState`/`useEffect` 替换为 `useSwarmTeam` hook 调用
- [x] 6.4 删除 `SwarmPage.tsx` 中的 15s `setInterval` 轮询（running 状态下的定时刷新）
- [x] 6.5 验证 WebSocket `swarm_status` 事件仍能正确触发成员状态更新
- [x] 6.6 验证 `SwarmPage.tsx` 行数降至 250 行以下

## 7. 前端状态展示更新

- [x] 7.1 更新 `SwarmPage.tsx` 的团队状态 banner，从后端 `TeamRunState` 读取状态而非前端推断
- [x] 7.2 在 IDLE 状态下展示"重新启动"操作入口

## 8. 测试与验证

- [x] 8.1 为 `SwarmService.start_team()` 添加单元测试（注入 mock `TeamLifecycleManager` 和 `BackendRegistry`）
- [x] 8.2 为 `transition_state()` 添加单元测试（覆盖合法和非法转换）
- [x] 8.3 为 `GET /api/swarm/teams/{team}/runs/{run_slug}/status` 添加集成测试
- [x] 8.4 运行现有 swarm 相关测试，确保全部通过
- [x] 8.5 手动验证前端：选中团队 → 启动 → RUNNING 状态显示 → 成员状态 WebSocket 更新 → IDLE 状态展示
