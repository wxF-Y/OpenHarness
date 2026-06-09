## Context

HLAgent 是 FastAPI Gateway + React Web + Python SDK 的 AI Agent 平台。当前没有任何 RAG 设施；Memory、Skills、对话历史都靠"用户手动复制"或"全文塞进 prompt"。

本次变更基于 2026 年业界对 code+doc RAG 的现状调研收敛：纯向量已被淘汰，AST 切片+混合检索+插拔嵌入是当前 SOTA 组合；Cursor 自建远端 vector DB、Cline 完全靠 grep 各占一极，Continue 走中间路（pluggable）。本设计采取"中间偏右"的姿势：本地 sqlite-vec 嵌入式存储 + tree-sitter AST 切片 + 混合检索 + 同时暴露 grep_code 工具，让 Agent 自己挑路。

本变更是 RAG 路线图的 **v1**，目标是建立索引/检索基础设施 + Tool-Call 集成，不做 @-Mention（v2）与 Agentic 多轮检索（v3）。

**约束**：
- 不引入新外部服务（无 Docker、无独立向量库进程）—— sqlite-vec 嵌入式
- 不提供 CLI —— 一切通过 Web UI 触发
- 国内网络环境 —— HuggingFace 默认走镜像
- 费用可控 —— 后台 watcher 自动嵌入必须可熔断
- 不破坏现有功能 —— 工具按 session 配置注入

## Goals / Non-Goals

**Goals:**

1. Agent 通过 `search_codebase` 工具能检索到 Memory + cwd 项目代码 + 项目文档中语义相关的片段
2. 同时提供 `grep_code` 与 `read_file` 工具，让 Agent 在精确匹配场景下走 grep 路径
3. 用户可在 UI 一键重建/增量更新索引，并看到实时进度
4. 默认开启文件变更 watcher，文件修改后自动增量重索引，无需用户介入
5. 嵌入提供方插拔，内置 OpenAI / Ollama / 本地 sentence-transformers / OpenAI-Compatible 四种
6. 全局日费用预算 + 超额熔断
7. v1 完成后，v2/v3 可在不破坏 v1 的前提下增量加上

**Non-Goals:**

- v1 不做 @-Mention 前端补全（v2）
- v1 不做 query rewrite / 多轮检索 / reranker（v3）
- v1 不做跨 cwd 全局检索（每个 cwd 独立 DB）
- v1 不做 watcher 后端定时增量（仅文件事件触发）
- v1 不做 int8 量化、ColBERT 多向量、GraphRAG
- v1 不做团队共享索引（Cursor 2026 那种特性）
- v1 不做 PDF/Word/Excel 解析（只读文本类文件）
- v1 不修改任何现有 spec 的需求

## Decisions

### D1. 向量存储：sqlite-vec + FTS5（单文件）

**选择**：sqlite-vec 0.1.x + SQLite FTS5 在同一个 `.db` 文件里。
**备选**：Chroma、LanceDB、Qdrant、pgvector。
**理由**：
- 跟 HLAgent "零运维 / 嵌入式" 调性一致（已有 sqlite 数据目录）
- FTS5 提供 BM25，无需引入 Elasticsearch
- 单文件易备份、易迁移、易删除
- 调研数据：sqlite-vec 在百万级以下向量场景延迟与 LanceDB 持平
- 缺点：FTS5 中文分词弱，但 v1 主要语料是代码/英文文档，影响小（v3 可换 `jieba` 自定义 tokenize）

### D2. 切片策略：tree-sitter AST（代码）+ heading 切片（Markdown）

**选择**：代码走 tree-sitter，Markdown 走 heading + 滑窗，其他文本走递归字符切分。
**备选**：固定大小切分、句子级切分、late chunking。
**理由**：
- 调研数据：AST 切片 Recall@5 = 70%，固定切分 = 42%
- chunk 目标 512 token（业界共识 400-512 最优，>2500 急剧下滑）
- 大函数：先尝试逻辑块二切（顶层 if/for），仍超就 512 滑窗 + 64 overlap，每片加 "# from class X" 面包屑
- v1 支持语言：py / ts / tsx / js / go / java / cpp / h / rust（其它扩展回退到 TextChunker）

### D3. 检索 pipeline：BM25 + 向量 → RRF 融合

**选择**：BM25 与向量并行取 top-50，RRF（k=60）融合，最终返回 top-K=8。
**备选**：纯向量、纯 BM25、加权融合（normalize 后相加）。
**理由**：
- 调研数据：混合相比纯一方提升 15-30% recall
- RRF 不需 score normalize，BM25 / cosine 量纲不同的工程问题直接规避
- 默认 α=β=0.5；future flag 允许"含标识符的 query"提高 BM25 权重（v3 再做）
- v1 **不做 reranker**：500ms 延迟成本太高，BGE/Cohere 都得引入新依赖。留接口在 v3 启用。

### D4. 嵌入提供方：插件化 + 4 内置

**选择**：`EmbedProvider` Protocol + 4 个实现（OpenAI / Ollama / Local / OpenAI-Compatible）。
**理由**：
- 用户场景多样：有 OpenAI key / 装了 Ollama / 想全本地离线 / 用国内 API（DeepSeek、智谱、硅基流动）
- OpenAI-Compatible 一个 provider 覆盖大多数国产服务（它们都兼容 OpenAI 协议）
- 复用 HLAgent 现有 `settings.profiles[]` 机制，新增并列的 `embed_profiles[]`，API key 复用 `auth/storage.py` 加密
- Profile ID **系统生成** `emb_<provider>_<6位随机>`（用户只看可读 display name）
- 维度不一致时 sqlite-vec 列定义不允许混存 → 切 provider 必须全量重建（UI 弹确认）

### D5. 文件变更 watcher：默认开 + 4 层防护

**选择**：watchdog 库；防抖 500ms / 聚合 3s / 并发限 8 / 日预算熔断；默认 enabled。
**备选**：禁用 watcher（用户手动）、定时全扫描、git hook。
**理由**：
- 用户明确要求"自动+隐形后台"
- 防抖应对编辑器存盘风暴
- SHA 短路 → 编辑器 touch 不重嵌
- 日预算 + 超额暂停：解决"后台默默花钱"风险
- 离线/无 key/health_check 失败时 → 自动暂停 + UI 红点；不静默失败

### D6. Agent 工具集：3 个工具同时暴露

**选择**：`search_codebase`（混合）+ `grep_code`（regex）+ `read_file`（精读）。
**理由**：
- 调研：Cline/Claude Code 实证：grep 在精确匹配场景比 vector 更准更便宜
- 三工具语义清晰、不重叠：模糊语义→search_codebase；已知字符串→grep_code；已知路径→read_file
- 让 LLM 自己选，比"系统硬塞 context"可控
- session 创建时按 RAG config.enabled 决定是否注入（默认开）

### D7. HF 下载默认走国内镜像

**选择**：Gateway 启动时 `os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")`。
**理由**：
- 项目用户主要在国内
- `setdefault` 不覆盖外部已设值（运维/翻墙用户依旧能用官方）
- UI 提供下拉切换（mirror / 官方 / 自定义）

### D8. UI 触发模式：手动按钮 + 自动 watcher 共存

**选择**：UI 提供 [重建] [增量] 按钮 + watcher 开关；三入口共用同一索引 pipeline，progress 走同一 SSE。
**理由**：
- 用户要求"既要手动+进度，也要自动+隐形"
- 共用 pipeline 避免逻辑分叉
- 手动重建时 watcher 入队暂停，防双写

### D9. 每 cwd 独立 DB

**选择**：`.openharness/rag/<sha256(cwd)前12位>/index.db`。
**理由**：
- 跟现有 Memory 目录命名一致
- 切项目时不污染、不冲突
- 删项目目录可一键清理

### D10. SSE 作为统一进度通道

**选择**：`GET /api/rag/stream` 一条 SSE 连接，所有 indexer / watcher / download 事件统一推。
**理由**：
- 前端只维护一个连接，状态管理简单
- 与 HLAgent 已有 WS pattern 风格一致（ws 给 chat，sse 给单向通知）

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| **Watcher 失控烧钱** | 日预算硬熔断 + UI 实时显示已花 + 默认 $1 上限 |
| **大仓首次索引慢** | UI 流式进度 + 可取消；OpenAI batch 并发 8；增量改文件后秒级 |
| **tree-sitter 解析失败** | 单文件 fallback 到 TextChunker，记录跳过，不挂全场 |
| **sqlite-vec 维度强约束** | 切 provider 强制重建 + UI 二次确认；config 校验启动时跑 |
| **Local provider 拖慢启动** | lazy 加载（首次 embed 时）+ idle 60min 卸载 |
| **OpenAI API key 泄漏** | 复用现有 `auth/storage.py` 加密；不写日志、UI 蒙星 |
| **Windows watchdog 漏事件** | 提供 [手动增量] 按钮兜底；mtime 全扫描入口（定时器 v3 再加） |
| **FTS5 中文分词弱** | v1 语料偏代码/英文，影响小；记入 v3 TODO 换 jieba tokenize |
| **embed 服务挂掉** | health_check 失败 watcher 自动暂停；UI 红点；retry 上限 5 次 |
| **多次写库竞态** | indexer + watcher 共用单 worker（asyncio queue）；DB 写以事务包裹 |
| **PostgreSQL 用户混淆** | sqlite-vec 是文件，不依赖任何外部 DB；文档明确 |
| **`.openharness/rag/` 目录膨胀** | UI 显示总大小 + [清理] 按钮（删整库重建） |

## Migration Plan

**前向迁移**：

1. 用户升级 HLAgent → 启动 Gateway → `embed_profiles` 为空 → `/rag` 页面引导配置首个 provider（默认推荐 OpenAI，复用已有 LLM profile）
2. 用户进入 `/rag` → 点 [保存并重建] → 全量首次索引（进度条）
3. 完成后 watcher 自动启动；后续修改文件触发增量
4. session 创建时检查 RAG config，若 ready 自动注入 3 个工具

**回滚**：

- 关 watcher 开关 → 不影响其他功能
- 删 `.openharness/rag/` 目录 → 索引归零，工具仍可注入但搜不到东西
- 卸 `sqlite-vec` 依赖 → 工具注入失败，前端给红点；其它功能不受影响
- 完全回退：从 `settings.json` 删 `embed_profiles`、从 `pyproject.toml` 移除依赖、删 router/services/rag、删前端 `/rag` 路由

**数据兼容**：

- 维度/模型/provider 变更 → 全量重建（schema 强制约束）
- HLAgent 升级 schema 变更 → 在 `file_meta` 加 `schema_version` 列，启动时 migrate

## Open Questions

- 是否在 v1 提供"导出/导入索引"功能（便于切机器）？ — **暂不**，v3 再说
- Local provider 是否支持自定义微调过的 HF 模型？ — **支持**，UI 有"自定义 HF model id"选项；但不验证适配性
- session 工具注入是否要按 role/skill 区分？ — **不**，v1 全 session 一视同仁；role 维度的工具开关属 role-scoped-tool-registry 范围
- `.ragignore` 跟 `.gitignore` 是合并还是替代？ — **合并**：先 `.gitignore` 再 `.ragignore`，后者可白名单（`!path`）
- 索引 DB 是否需要加密？ — **v1 不加密**，跟 Memory 文件一致；用户敏感数据要避免索引应写入 `.ragignore`
