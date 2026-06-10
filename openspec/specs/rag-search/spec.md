## ADDED Requirements

### Requirement: 混合检索 Pipeline

系统 SHALL 对每个 query 执行 BM25 检索（FTS5，top-50）与向量检索（sqlite-vec cosine，top-50）并行召回，然后使用 RRF（Reciprocal Rank Fusion, k=60）融合两路结果，按融合分数排序后返回 top-K（默认 K=8）。

#### Scenario: 两路并行召回

- **WHEN** 用户对一个已索引语料执行 `search_codebase("用户登录校验密码")`
- **THEN** 系统并行执行 BM25 与向量检索，各取 top-50 候选

#### Scenario: RRF 融合排序

- **WHEN** BM25 与向量返回的候选有重叠和差异
- **THEN** 同时被两路命中的 chunk 排名更高（rank 加权）；最终输出按 RRF 分数排序

#### Scenario: 返回 top-K 默认为 8

- **WHEN** 未指定 `top_k` 参数调用 search
- **THEN** 返回 8 条结果

### Requirement: 检索结果结构

系统 SHALL 返回检索结果为 JSON 数组，每条 SHALL 包含 `file`、`lang`、`kind`、`symbol`、`start_line`、`end_line`、`score`（融合后 0-1 归一化）、`content` 字段。`content` SHALL 包含已写入索引时的上下文前缀。

#### Scenario: 结果含完整上下文字段

- **WHEN** 检索返回一条命中
- **THEN** 该结果对象有完整的 8 个字段且 `score` ∈ [0, 1]

#### Scenario: 行号可定位源文件

- **WHEN** Agent 拿到检索结果
- **THEN** 通过 `file + start_line + end_line` 可在 cwd 中唯一定位原文

### Requirement: 检索 Playground API

系统 SHALL 提供 `POST /api/rag/search` 端点，接受 `{query: str, top_k?: int}` 请求体，返回 top-K 结果数组，供 UI playground 调试与测试使用。

#### Scenario: Playground 显示检索结果

- **WHEN** 用户在 `/rag` 页面 playground 输入 query 并提交
- **THEN** UI 显示返回的 top-K 命中，每条可展开查看 content 与得分

#### Scenario: 无索引时返回友好错误

- **WHEN** 当前 cwd 尚未建立索引就调用 search
- **THEN** API 返回 409 Conflict 与提示"索引未建立，请先重建"

### Requirement: 检索性能预算

系统 SHALL 在 1 万 chunk 规模下：
- **检索环节**（BM25 + 向量召回 + RRF 融合 + 结果组装，不含 query embedding）P95 < 300ms。
- **Query embedding**：远程 provider P95 < 500ms；本地 provider（Ollama / Local）P95 < 100ms。
- 系统 SHALL 提供 query 向量的 LRU(2048, TTL 24h) 缓存。

#### Scenario: 检索环节延迟达标

- **WHEN** index 中有约 10000 chunks，连续执行 100 次不同 query，仅计 BM25 + 向量召回 + RRF + 组装阶段
- **THEN** 第 95 百分位延迟小于 300ms

#### Scenario: Query 向量缓存命中

- **WHEN** 同一 query 字符串在 24 小时内被检索两次，且 provider/dimensions 未变
- **THEN** 第二次 query embedding 直接命中缓存（小于 1ms），不发起远程或本地嵌入调用

#### Scenario: Query embedding 远程预算

- **WHEN** 使用远程 provider（OpenAI / OpenAI-Compatible）执行 100 次未命中缓存的 query
- **THEN** 第 95 百分位 query embedding 时延小于 500ms

#### Scenario: Query embedding 本地预算

- **WHEN** 使用本地 provider（Ollama / Local）执行 100 次未命中缓存的 query
- **THEN** 第 95 百分位 query embedding 时延小于 100ms

### Requirement: 维度不一致拦截

系统 SHALL 在加载 DB 时检查 `file_meta` 中记录的 `dimensions` 与当前 active embed provider 的 `dimensions` 是否一致；不一致时 SHALL 拒绝执行检索并返回明确错误，要求用户重建索引。

#### Scenario: provider 切换后检索被拦截

- **WHEN** 用户从 1536 维 provider 切到 1024 维 provider 但未重建索引
- **THEN** `search_codebase` 工具调用与 `/api/rag/search` 均返回 "INDEX_DIM_MISMATCH" 错误
