## Why

当前 HLAgent Swarm 页面功能单薄：只能查看已存在的团队，无法直接从 UI 创建带成员的团队，更无法利用社区现有的角色定义库（如 agency-agents-zh 的 215 个专家角色）。用户若想组建一个专业 Swarm 团队，必须依赖 Chat Agent 通过命令触发，门槛高、体验差。

## What Changes

- 新增**角色库浏览面板**：在 Swarm 创建流程中，可按部门（Engineering、Marketing、Design 等）浏览 agency-agents-zh 仓库的 215 个专家角色
- 新增**成员选择与添加**：选中角色后自动将其 Markdown 内容作为成员的 `system_prompt`，填入团队成员配置
- 新增 **Gateway 角色库 API**：`/api/swarm/role-library` 系列端点，支持拉取 GitHub raw 内容并本地缓存
- 新增**本地缓存机制**：首次拉取后缓存到 `~/.hlagent/role-library/`，支持刷新
- 完善 **Swarm 页面**：补充"新建带成员的团队"完整流程，展示团队成员状态与启动指引

## Capabilities

### New Capabilities

- `role-library-api`: Gateway 端的角色库 API，从 GitHub 拉取并缓存 agency-agents-zh 的角色目录和 Markdown 内容
- `swarm-team-builder`: Swarm 页面的团队创建向导，支持从角色库选择成员并配置 system_prompt

### Modified Capabilities

- `swarm-page`: 现有 `/swarm` 页面增加角色库入口、团队创建向导、成员状态展示优化

## Impact

- **新文件**：`HLAgent/gateway/routers/role_library.py`
- **修改**：`HLAgent/gateway/main.py`（注册新路由）、`HLAgent/web/src/pages/SwarmPage.tsx`（团队创建向导 + 角色库面板）
- **外部依赖**：GitHub raw content API（`raw.githubusercontent.com`）用于拉取角色 Markdown 文件
- **本地存储**：`~/.hlagent/role-library/` 用于缓存角色库索引和内容
