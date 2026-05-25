## Context

OpenHarness swarm（团队模式）目前有三个核心文件超过 700 行，每个文件承担多重职责：`team_lifecycle.py`（1022行）混合了数据模型、持久化和生命周期管理；`in_process.py`（929行）混合了信号控制、上下文管理、执行循环和流输出；`swarm.py` 路由（705行）直接内嵌业务逻辑。前端 `SwarmPage.tsx`（655行）是状态机 + 数据获取 + 渲染的单体组件，采用轮询+WebSocket 双机制同步状态。

当前约束：
- 所有公开 API 端点必须保持向后兼容（除明确标记 BREAKING 的）
- `mailbox.py` 文件系统 + 原子写入机制保留不变
- `registry.py` 后端检测逻辑保留不变
- 测试在拆分后必须继续通过

## Goals / Non-Goals

**Goals:**
- 将每个文件降至 400 行以内（或明确分层的 600 行以内）
- 将路由层降为薄适配层（≤200 行），业务逻辑迁至 `swarm_service.py`
- 提取显式的团队运行状态机，替代隐式的 `teamState` 枚举
- 前端提取 `useSwarmTeam` hook，使 SwarmPage 降至纯视图（≤200 行）
- 消除 SwarmPage 中的 15s 轮询，统一为 WebSocket 驱动
- 重命名 `/api/swarm/teams/{team}/tasks` → `/runs`（对齐 run_slug 概念）

**Non-Goals:**
- 不改变任何公开 API 行为（除 BREAKING 重命名）
- 不引入新的外部依赖
- 不修改邮箱文件格式或路径结构
- 不重写 tmux/iTerm2 窗格后端
- 不重构权限同步（`permission_sync.py`）
- 不变更 `registry.py` 后端检测逻辑

## Decisions

### 1. 后端拆分策略：垂直按职责分层，不按后端类型分文件

**选择**：将 `team_lifecycle.py` 按职责拆分为 `models.py`（数据类）、`persistence.py`（文件 I/O）、`lifecycle.py`（业务操作）。`in_process.py` 拆分为 `abort.py`（信号控制）、`context.py`（ContextVar 管理）、`executor.py`（查询循环 + SSE）。

**原因**：按类型分文件（每个后端一个文件）会造成 in_process 过大的问题再次出现；按职责分层符合当前代码的内聚边界，且不改变公开接口。

**备选**：将所有后端逻辑统一到 `backends/` 子包 → 需要移动文件、更新所有 import，风险更高。

### 2. 服务层引入：SwarmService 类 vs 模块级函数

**选择**：引入 `SwarmService` 类，持有 `TeamLifecycleManager` 和 `BackendRegistry` 引用，提供 `start_team`、`spawn_member`、`send_message` 等方法。

**原因**：当前路由直接实例化 `TeamLifecycleManager` 并调用，导致测试需要 mock FastAPI 全局状态。`SwarmService` 可通过依赖注入传入，便于单元测试。

**备选**：模块级函数 + 全局单例 → 与现状差异过小，测试改善有限。

### 3. 状态机：显式 Enum vs 隐式字符串枚举

**选择**：在后端定义 `TeamRunState` Enum（`TEMPLATE / RUNNING / IDLE / ARCHIVED`），在前端对应 `swarm-state-machine` spec 中定义相同的字面量类型。状态转换通过 `SwarmService.transition_state()` 方法，转换结果写入 `team.json`。

**原因**：当前 `TeamFile` 没有显式的 `state` 字段，`teamState` 由前端从 `members` 状态推断，导致后端/前端状态不一致。显式状态机使生命周期透明，并为未来 `ARCHIVED` 状态的批量清理提供入口。

**备选**：继续从 members 推断 → 前端和 Gateway 都需要推断逻辑，容易分叉。

### 4. 前端重构：自定义 Hook vs React Query / SWR

**选择**：提取 `useSwarmTeam(teamName)` 自定义 hook，内部使用现有 `swarmApi.ts` 工具函数 + `swarmStore` WebSocket 订阅，不引入新状态管理库。

**原因**：项目已有 `zustand` 的 `swarmStore`，引入 React Query 会导致状态管理双轨。自定义 hook 只移动代码，不新增依赖。

**备选**：React Query → 更强的缓存和失效机制，但引入新依赖且与 zustand 集成复杂。

### 5. 轮询消除：纯 WebSocket vs 长轮询降级

**选择**：删除 SwarmPage 中 `running` 状态下的 15s `setInterval` 轮询，改为 WebSocket `swarm_status` 事件驱动刷新。WebSocket 断连时，`useWebSocket` hook 已有 reconnect 逻辑，无需额外降级。

**原因**：15s 轮询与 WebSocket 事件并存导致重复刷新和竞态（两个地方都可能更新 `members`），消除轮询简化数据流。

**备选**：保留轮询作为 WebSocket 降级 → 当前项目已是本地部署，WebSocket 不可靠的场景极少。

### 6. API 重命名实施：双路由共存 vs 直接重命名

**选择**：同步更新后端路由和前端调用，不保留旧路径别名。因为 HLAgent 前后端为同一仓库，可原子提交。

**原因**：共存路由需要额外维护周期；单仓库允许原子变更，不存在跨版本部署问题。

**备选**：保留 `/tasks` 别名 → 无必要，增加路由复杂度。

## Risks / Trade-offs

- **拆分引入循环 import** → 通过依赖方向规则（models ← persistence ← lifecycle）避免；`__init__.py` 统一重导出
- **`in_process.py` ContextVar 跨文件可见性** → `context.py` 导出单例 ContextVar，executor.py import 它，维持单一实例
- **SwarmService 依赖注入与 FastAPI 全局状态冲突** → 使用 FastAPI `Depends` 模式，在 `lifespan` 中初始化单例并存入 `app.state`
- **前端 hook 提取后 re-render 增加** → `useSwarmTeam` 使用 `useMemo`/`useCallback` 缓存派生值，避免子组件不必要渲染
- **BREAKING `/tasks` → `/runs` 重命名** → 同一 PR 内原子更新前后端，无跨版本兼容问题；但若有外部工具脚本直接调用旧路径，需手动迁移

## Migration Plan

1. **后端拆分**（不改变公开接口）：
   - 从 `team_lifecycle.py` 提取 `models.py`、`persistence.py`，更新 `__init__.py` 重导出
   - 从 `in_process.py` 提取 `abort.py`、`context.py`，更新导入
   - 创建 `swarm_service.py`，将 `swarm.py` 路由业务逻辑迁入
   - 路由层改为调用 `SwarmService`，行为不变

2. **状态机引入**：
   - 在 `models.py` 添加 `TeamRunState` Enum
   - 在 `TeamFile` 添加可选 `state` 字段（默认向后兼容）
   - `SwarmService` 写入和读取状态字段

3. **API 重命名**（BREAKING）：
   - 后端路由 `/tasks` → `/runs`
   - 前端 `swarmApi.ts` 同步更新
   - 一次提交，无过渡期

4. **前端重构**：
   - 提取 `useSwarmTeam.ts` hook
   - SwarmPage 改为消费 hook
   - 删除 15s 轮询
   - 验证 WebSocket 驱动路径覆盖所有状态转换

**回滚策略**：每个步骤独立提交，后端和前端拆分互不依赖，可单独回滚。状态机引入向后兼容（`state` 字段可选），不影响现有 `team.json` 文件读取。

## Open Questions

- `permission_sync.py`（1168行）是否在本次 scope 内？→ 明确排除，留给下一个变更
- `TeamRunState.ARCHIVED` 是否需要在本次实现自动归档触发？→ 建议只定义状态，归档触发逻辑延后
- `swarm_service.py` 是否应该覆盖 worktree 管理（`worktree.py`）？→ 暂不纳入，worktree 逻辑独立
