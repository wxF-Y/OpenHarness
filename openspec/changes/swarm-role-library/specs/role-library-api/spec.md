## ADDED Requirements

### Requirement: 角色库目录接口
Gateway SHALL 提供 `GET /api/swarm/role-library/catalog` 端点，返回按部门分组的角色列表，无需网络请求（使用内置静态清单）。

#### Scenario: 获取角色目录
- **WHEN** 客户端请求 `GET /api/swarm/role-library/catalog`
- **THEN** 返回 JSON `{ departments: [{ name, label, agents: [{ name, path, description }] }] }` 且 HTTP 200

#### Scenario: 离线时目录仍可用
- **WHEN** 网络不可达，客户端请求目录
- **THEN** 仍返回完整目录（静态清单），HTTP 200

### Requirement: 角色内容拉取与缓存
Gateway SHALL 提供 `GET /api/swarm/role-library/content?path=<agent_path>` 端点，返回对应角色的 Markdown 原文。内容 SHALL 先查本地磁盘缓存（`~/.hlagent/role-library/`），缓存未命中时从 `raw.githubusercontent.com` 拉取并写入缓存。

#### Scenario: 缓存命中
- **WHEN** 请求某路径且本地缓存存在
- **THEN** 返回缓存内容，HTTP 200，响应头 `X-Cache: HIT`

#### Scenario: 缓存未命中
- **WHEN** 请求某路径且本地无缓存
- **THEN** 从 GitHub raw 拉取，写入 `~/.hlagent/role-library/<path>.md`，返回内容，HTTP 200，响应头 `X-Cache: MISS`

#### Scenario: GitHub 不可达
- **WHEN** 拉取 GitHub 内容超时或失败
- **THEN** 返回 HTTP 503，body `{ error: "无法拉取角色内容，请检查网络连接" }`

### Requirement: 缓存刷新
Gateway SHALL 提供 `DELETE /api/swarm/role-library/cache` 端点，清除本地磁盘缓存，下次请求重新拉取。

#### Scenario: 刷新缓存
- **WHEN** 客户端请求 `DELETE /api/swarm/role-library/cache`
- **THEN** 删除 `~/.hlagent/role-library/` 目录下所有文件，返回 `{ cleared_files: <count> }`，HTTP 200
