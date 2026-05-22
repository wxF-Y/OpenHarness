## ADDED Requirements

### Requirement: 专家目录默认从同仓库 catalog.json 动态获取，支持 CDN 和 GitHub 双源 fallback
后端 `/api/swarm/role-library/catalog` 端点 SHALL 通过 `_fetch_content("catalog.json")` 从 `jnMetaCode/agency-agents-zh` 仓库获取目录 JSON，使用与角色内容相同的双源 fallback 链（jsDelivr CDN 优先，`raw.githubusercontent.com` 备用）；当两源均不可达或 JSON 解析失败时，SHALL 回退到内置硬编码列表并记录警告日志。企业私有部署可通过 `HLAGENT_EXPERT_CATALOG_URL` 环境变量覆盖目录来源。

#### Scenario: 默认从 CDN 获取目录（无需配置）
- **WHEN** `HLAGENT_EXPERT_CATALOG_URL` 未设置，jsDelivr CDN（`cdn.jsdelivr.net/gh/jnMetaCode/agency-agents-zh@main/catalog.json`）可达
- **THEN** 服务端从 CDN 下载 `catalog.json` 并解析为目录数据；响应结构与内置 `AGENT_CATALOG` 相同（departments 数组）

#### Scenario: CDN 不可达时自动切换 GitHub 源
- **WHEN** `HLAGENT_EXPERT_CATALOG_URL` 未设置，CDN 请求超时或返回非 200，`raw.githubusercontent.com` 可达
- **THEN** 自动切换到 GitHub 原始地址拉取 `catalog.json`；服务端记录 DEBUG 日志；`/catalog` 端点仍返回 HTTP 200

#### Scenario: 网络完全不可达时回退内置列表
- **WHEN** `HLAGENT_EXPERT_CATALOG_URL` 未设置，CDN 和 GitHub 均不可达（如纯离线环境）
- **THEN** 使用内置硬编码 `AGENT_CATALOG`；服务端记录 WARNING 级别日志；`/catalog` 端点仍返回 HTTP 200

#### Scenario: 远端 catalog.json 格式不符合 schema
- **WHEN** 远端返回的 JSON 无法通过 Pydantic `CatalogOut` schema 解析
- **THEN** 使用内置列表；记录 WARNING 日志说明解析失败原因

#### Scenario: 企业私有部署使用自定义 URL
- **WHEN** `HLAGENT_EXPERT_CATALOG_URL` 已配置，服务端向该 URL 发 GET 请求并收到 200 响应
- **THEN** 优先使用该 URL 的响应 JSON；该 URL 同样支持 proxy 和 timeout；失败则 fallback 到内置列表

### Requirement: 目录数据支持 L1/L2 缓存
从远端拉取的目录数据 SHALL 被缓存到 L1（内存）和 L2（磁盘），复用 `_fetch_content` 的现有缓存机制（cache key 为 `"catalog.json"`）；`DELETE /api/swarm/role-library/cache` SHALL 同时失效目录缓存和角色内容缓存。

#### Scenario: 目录缓存命中（L1）
- **WHEN** L1 缓存中已存在 `"catalog.json"` 数据
- **THEN** 直接返回缓存数据，不发起远端请求

#### Scenario: 清除缓存包含目录数据
- **WHEN** 调用 `DELETE /api/swarm/role-library/cache`
- **THEN** `"catalog.json"` 对应的 L1 和 L2 缓存均被清除；`cleared_files` 计数包含目录缓存文件
