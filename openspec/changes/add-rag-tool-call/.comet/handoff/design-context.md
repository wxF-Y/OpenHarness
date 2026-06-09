# Comet Design Handoff

- Change: add-rag-tool-call
- Phase: design
- Mode: compact
- Context hash: c158e22848bae54bdb3b4b6fd9595115a8e1fdf724c68281dd2e01756ff28b21

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/add-rag-tool-call/proposal.md

- Source: openspec/changes/add-rag-tool-call/proposal.md
- Lines: 1-53
- SHA256: a215f54e1c919c5fcdcccb565034096b44d67bcb69419f0566c6a56ddb941e78

```md
## Why

HLAgent 当前 Agent 只能基于上下文窗口里被显式塞入的内容回答问题；用户的 Memory 文件、项目代码、文档都无法被检索利用。用户每次问"上次记的 X""代码里 Y 在哪儿做的"等问题，Agent 没有手段去查，只能让用户手动复制粘贴。本变更引入检索增强（RAG）能力，让 Agent 通过工具调用主动检索项目语料，同时同步解决"业内 RAG 接入"中的几个关键问题：混合检索（vector + BM25）、AST 切片、嵌入提供方插拔、文件变更自动重索引、费用熔断。

这是路线图的第一期（v1：Tool-Call RAG）。后续 v2（@-Mention，仍走 tool 路径）和 v3（Agentic 多轮检索）将作为独立 change 推进，依赖 v1 建立的索引和检索基础。

## What Changes

- **新增** RAG 索引服务：tree-sitter AST 切片（代码）+ heading 切片（Markdown）+ 递归切片（文本），sqlite-vec + FTS5 单文件存储
- **新增** 混合检索 pipeline：BM25 + 向量并行召回 → RRF 融合（k=60）→ top-K
- **新增** 嵌入提供方插件化：OpenAI / Ollama / Local (sentence-transformers) / OpenAI-Compatible 四种内置，Profile ID 系统生成
- **新增** 文件变更 watcher：watchdog 防抖 + 限速 + SHA 短路 + 费用熔断；默认开启可关闭
- **新增** Agent 工具集：`search_codebase` / `grep_code` / `read_file`，session 创建时自动注册
- **新增** Gateway REST API：`/api/rag/rebuild` `/update` `/status` `/search` `/ignore` `/embed/test` `/embed/download` + SSE 进度通道
- **新增** Web `/rag` 页面：索引状态卡 + watcher 开关 + 进度条 + 嵌入 provider 动态表单 + .ragignore 编辑器 + 检索 playground
- **新增** HuggingFace 下载默认走 `hf-mirror.com`（国内镜像），可经环境变量或 UI 覆盖
- **新增** 全局 `embed_profiles` 配置 + per-project 引用机制（复用现有 settings/auth 加密存储）
- **新增** 日费用预算与熔断机制（超额暂停 watcher）

## Capabilities

### New Capabilities

- `rag-indexing`: 语料扫描、AST/Markdown/文本切片、SHA 短路、增量与全量索引、sqlite-vec + FTS5 存储、文件变更 watcher（防抖/限速/熔断）。
- `rag-search`: BM25 + 向量混合检索、RRF 融合、top-K 排序、检索 playground API。
- `rag-embedding-providers`: 嵌入提供方抽象与 4 个内置实现（OpenAI / Ollama / Local / OpenAI-Compatible）、Profile ID 自动生成、测试连接、维度变更检测与强制重建、HF 镜像默认配置。
- `rag-agent-tools`: Agent 工具 `search_codebase` / `grep_code` / `read_file`，session 创建时自动注册并暴露给 LLM。

### Modified Capabilities

（无 — 现有 spec 不修改）

## Impact

- **新增依赖**：
  - `sqlite-vec`（向量扩展，pip 装载）
  - `watchdog`（跨平台文件监听）
  - `tree-sitter` + 语言绑定（py/ts/js/go/java/cpp/rust）
  - `tiktoken`（token 计数）
  - `huggingface_hub`（HF 下载，所有 provider 共用）
  - `sentence-transformers` + `torch`（仅 `embed-local` 可选 extras）
- **新增模块**：`HLAgent/gateway/services/rag/`（indexer/watcher/search/store/budget/chunkers/providers）
- **修改文件**：
  - `HLAgent/gateway/routers/` 增加 `rag.py`
  - `HLAgent/gateway/routers/sessions.py` 或 `ws.py` 注入工具
  - `HLAgent/gateway/routers/settings.py` 增加 `embed_profiles` CRUD
  - `HLAgent/gateway/main.py` 启动注入 `HF_ENDPOINT` 默认值
  - `HLAgent/web/src/` 新增 `/rag` 路由 + 页面 + 设置组件
- **数据目录**：每个 cwd 项目在 `.openharness/rag/<project_hash>/` 下生成 `index.db` + `config.json`
- **全局 settings**：`~/.openharness/settings.json` 增加 `embed_profiles[]` 与 `hf_endpoint`
- **费用**：默认 OpenAI provider，需用户配置 API key；日预算默认 $1，超额熔断
- **API key 安全**：复用 `auth/storage.py` 现有加密机制
- **不破坏**：现有 Memory / Skills / Chat / Cron / Swarm 功能完全不受影响；RAG 工具只在 session 注册时按配置追加
```

## openspec/changes/add-rag-tool-call/design.md

- Source: openspec/changes/add-rag-tool-call/design.md
- Lines: 1-177
- SHA256: d8707497058c314acefa5c5154f4209533b6ab2258f968515242e12c234f55b5

[TRUNCATED]

```md
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
```

Full source: openspec/changes/add-rag-tool-call/design.md

## openspec/changes/add-rag-tool-call/tasks.md

- Source: openspec/changes/add-rag-tool-call/tasks.md
- Lines: 1-149
- SHA256: 7543c0efdd9a759429c25966a154dc7660ca2c338a8189fb64a96d28beca2cdf

[TRUNCATED]

```md
## 1. 项目骨架 & 依赖

- [ ] 1.1 在 `HLAgent/gateway/pyproject.toml` 加入核心依赖：`sqlite-vec>=0.1.6`、`watchdog>=4.0`、`tree-sitter>=0.21`、`tree-sitter-languages>=1.10`、`tiktoken>=0.7`、`huggingface_hub>=0.24`、`aiosqlite>=0.20`
- [ ] 1.2 在 `pyproject.toml` 加入可选 extras：`[embed-local]` = `sentence-transformers>=3.0` + `torch>=2.4`；`[embed-local-gpu]` = `torch>=2.4` (CUDA wheel index)
- [ ] 1.3 创建 `HLAgent/gateway/services/rag/` 目录骨架（含 `__init__.py`、`indexer.py`、`watcher.py`、`search.py`、`store.py`、`budget.py`、`chunkers/`、`providers/`）
- [ ] 1.4 创建 `HLAgent/gateway/routers/rag.py` 占位（仅 router 注册，不写端点）
- [ ] 1.5 在 `HLAgent/gateway/main.py` include `rag.py` router；启动早期执行 `os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")`
- [ ] 1.6 全局 settings 增加 `embed_profiles: list[dict]` 与 `hf_endpoint: str | None` 字段（修改 `routers/settings.py` 与底层数据模型）

## 2. 数据层（store.py + schema）

- [ ] 2.1 实现 `store.RagStore`：打开 `.openharness/rag/<project_hash>/index.db`，加载 sqlite-vec 扩展，建 4 张表（chunks FTS5 / vec_chunks vec0 / file_meta / embed_ledger）
- [ ] 2.2 `RagStore.upsert_chunks(chunks, vectors)`：事务包裹，写入 chunks + vec_chunks + chunks_fts；带 SHA 短路逻辑
- [ ] 2.3 `RagStore.delete_file(path)`：删除该 file 的所有 chunks/vec/fts 行 + file_meta 记录
- [ ] 2.4 `RagStore.purge_all()`：清空 4 张表（重建用）
- [ ] 2.5 `RagStore.get_file_sha(path)` / `get_chunk_hash_set(path)`：增量短路查询
- [ ] 2.6 `RagStore.bm25_search(query, limit)` 与 `RagStore.vector_search(vec, limit)`：返回 (rowid, score) 列表
- [ ] 2.7 `RagStore.stats()`：返回 chunks 数 / files 数 / 总字节 / 各 provider 维度
- [ ] 2.8 `RagStore.check_dim_consistency(dim)`：返回 bool；启动时调

## 3. 切片层（chunkers/）

- [ ] 3.1 实现 `chunkers/text.py`：递归字符切分 (`\n\n` → `\n` → `. ` → ` ` → 字符)，目标 512 token，overlap 64；使用 tiktoken 计 token
- [ ] 3.2 实现 `chunkers/markdown.py`：解析 ATX heading 切节；小节合并；大节按段落二切并加面包屑；代码块/表格视为原子
- [ ] 3.3 实现 `chunkers/code.py` 基础：tree-sitter 解析、节点遍历框架、上下文前缀生成（`# file:`、`# class X:`）
- [ ] 3.4 chunkers/code.py 支持 Python（function_definition / class_definition / 方法）
- [ ] 3.5 chunkers/code.py 支持 TypeScript / JavaScript（function_declaration / arrow_function 绑定到 const / class / interface）
- [ ] 3.6 chunkers/code.py 支持 Go（function_declaration / method_declaration / type_declaration）
- [ ] 3.7 chunkers/code.py 支持 Java（method_declaration / class_declaration / interface_declaration）
- [ ] 3.8 chunkers/code.py 支持 C/C++（function_definition / class_specifier / struct_specifier）
- [ ] 3.9 chunkers/code.py 支持 Rust（function_item / impl_item / struct_item / enum_item）
- [ ] 3.10 chunker dispatch：按扩展名选 chunker；二进制/超大/忽略文件返回空；任意 chunker 异常 fallback 到 text chunker

## 4. 嵌入 Provider 抽象与实现

- [ ] 4.1 `providers/base.py`：`EmbedProvider` Protocol；`ProviderConfig` Pydantic 模型；profile_id 生成器 `gen_profile_id(provider)`
- [ ] 4.2 `providers/__init__.py`：provider 注册表 + factory `make_provider(profile: dict) -> EmbedProvider`
- [ ] 4.3 `providers/openai_provider.py`：复用 `auth/storage.py` 取 key；batch 打包到 ~80k token；asyncio.Semaphore(8) 并发；tenacity 重试 5 次；`estimate_cost` 按 token 计 `text-embedding-3-small` 单价
- [ ] 4.4 `providers/ollama_provider.py`：调 `/api/embeddings`；实现 `list_models()` 拉 `/api/tags`；`pull_model(name)` 代理 `/api/pull`（流式进度透传到 SSE）
- [ ] 4.5 `providers/local_provider.py`：lazy load sentence-transformers；设备探测（cuda > mps > cpu）；fp16 默认；ThreadPoolExecutor(1) 包 model.encode；idle 60min 卸载（后台 asyncio task）
- [ ] 4.6 `providers/compat_provider.py`：参数化 OpenAI-compat 端点；继承 openai_provider 的 batch/重试逻辑
- [ ] 4.7 所有 provider 实现 `health_check() -> (bool, str)`，错误信息含具体原因（401/ECONNREFUSED 等）

## 5. 索引主流程（indexer.py + budget.py）

- [ ] 5.1 `budget.Budget`：从 settings 读 daily_usd / over_budget_action；`charge(tokens, cost, source)` 写 `embed_ledger`；`exceeded()` 判断；本地时区跨日重置
- [ ] 5.2 `indexer.Indexer`：构造时持有 store / provider / budget / config
- [ ] 5.3 `Indexer.iter_candidate_files(cwd)`：遍历 cwd、应用 `.gitignore` + `.ragignore`、过滤二进制/超大、yield path
- [ ] 5.4 `Indexer.update(paths: list[str])`：增量更新核心——读文件、算 sha、查 file_meta、若变 → chunk → SHA 短路 → 调 provider → 写库；按 batch 流式 emit 进度事件
- [ ] 5.5 `Indexer.rebuild()`：先 `store.purge_all()`，再对全部 candidate 文件调 update 等价逻辑
- [ ] 5.6 `Indexer.delete_files(paths)`：调 `store.delete_file` 清理
- [ ] 5.7 单一 asyncio worker 串行消化（indexer 与 watcher 共用），防 DB 竞态；提供 cancel token 支持取消
- [ ] 5.8 budget 超额时 emit 事件并按 `over_budget_action` 处理（pause: watcher 停 / warn: 仅记录 / hard_stop: 中止当前 job）

## 6. 文件监听（watcher.py）

- [ ] 6.1 `watcher.Watcher`：watchdog `Observer` + 自定义 `FileSystemEventHandler`；启动监听 cwd
- [ ] 6.2 事件过滤：`.gitignore` + `.ragignore` + 二进制 + 超大；过滤后入队
- [ ] 6.3 per-file 防抖：以 path 为 key，500ms 内重复事件合并为最后一个
- [ ] 6.4 聚合 flush：每 3s 收集队列内文件 → 调 `indexer.update(paths)` 或 `delete_files(paths)`
- [ ] 6.5 启停控制：`start()` / `stop()` / `pause(reason)` / `resume()`；状态可查
- [ ] 6.6 健康守护：每 5 分钟 provider `health_check`，连续 3 次失败 → `pause("provider unavailable: <err>")`
- [ ] 6.7 与 manual rebuild 互斥：rebuild 开始时 watcher 入队暂停，结束后恢复
- [ ] 6.8 状态 + 最近活动日志：环形 buffer（最近 50 条），供 UI 拉取

## 7. 检索（search.py）

- [ ] 7.1 `search.Searcher`：持有 store + provider；公开 `hybrid_search(query, top_k=8)`
- [ ] 7.2 维度一致性预检（不一致返回 `INDEX_DIM_MISMATCH` 错误）
- [ ] 7.3 并行执行 `store.bm25_search(query, 50)` 与 `provider.embed([query]) → store.vector_search(vec, 50)`（asyncio.gather）
- [ ] 7.4 RRF 融合 (k=60)，按融合分排序取 top_k；分数归一化到 [0,1]
- [ ] 7.5 结果组装：返回 `[{file, lang, kind, symbol, start_line, end_line, score, content}]`
- [ ] 7.6 性能验证：构造 10k chunks 数据集，确认 P95 < 300ms

## 8. Agent 工具集

- [ ] 8.1 `rag/tools/search_codebase.py`：包装 `Searcher.hybrid_search`；返回 JSON 字符串；错误情况返回 `{error, code, hint}` 结构
- [ ] 8.2 `rag/tools/grep_code.py`：调用 ripgrep（`subprocess` 或 `python-ripgrep`）；强制 cwd 边界；过滤规则复用 indexer；上限 500
- [ ] 8.3 `rag/tools/read_file.py`：复用现有 `routers/fs.py` 的安全边界；支持 start/end 行
- [ ] 8.4 工具 schema 定义（OpenAI tool-use 格式 + Anthropic 兼容）
```

Full source: openspec/changes/add-rag-tool-call/tasks.md

## openspec/changes/add-rag-tool-call/specs/rag-agent-tools/spec.md

- Source: openspec/changes/add-rag-tool-call/specs/rag-agent-tools/spec.md
- Lines: 1-91
- SHA256: 8e3dd7829462a309833cdfbdcbccf2cac853ee1ac13783c641e085275af31d95

[TRUNCATED]

```md
## ADDED Requirements

### Requirement: Agent 工具集

系统 SHALL 向 Agent session 注入三个工具：`search_codebase(query: str, top_k: int = 8)`、`grep_code(pattern: str, glob?: str, max_results: int = 50)`、`read_file(path: str, start_line?: int, end_line?: int)`。三工具的 schema、描述、参数 SHALL 符合 OpenAI / Anthropic tool-use 调用格式。

#### Scenario: 三工具均注册

- **WHEN** 一个新 chat session 创建且 RAG 已启用
- **THEN** Agent 的 tools 列表中包含三个工具，名称完全匹配

#### Scenario: search_codebase 调用流

- **WHEN** Agent 在对话中决定调 `search_codebase("用户登录校验密码", top_k=5)`
- **THEN** 系统执行混合检索并返回 5 条 JSON 结果作为 tool_result

#### Scenario: grep_code 调用流

- **WHEN** Agent 调 `grep_code("validateCredentials", glob="*.ts", max_results=20)`
- **THEN** 系统在 cwd 下执行 ripgrep 等价搜索，返回最多 20 条 `{file, line, content}` 结果

#### Scenario: read_file 区段读取

- **WHEN** Agent 调 `read_file("src/auth.ts", start_line=40, end_line=80)`
- **THEN** 系统返回该文件第 40-80 行的内容（受 fs.py 同样的安全边界约束）

### Requirement: 工具按 session 自动注入

系统 SHALL 在 session 创建时检查 RAG 配置：若该 cwd 的 `.openharness/rag/<hash>/config.json` 存在且 `enabled=true`（默认），三个工具 SHALL 被自动添加到 session 工具列表；否则不注入。注入操作 SHALL NOT 修改用户自定义的其他工具。

#### Scenario: RAG 未配置时不注入

- **WHEN** 当前 cwd 没有 RAG config 文件
- **THEN** session 创建后工具列表不含三个 RAG 工具

#### Scenario: RAG 禁用时不注入

- **WHEN** RAG config 中 `enabled=false`
- **THEN** session 工具列表不含三个 RAG 工具

#### Scenario: 不影响已有工具

- **WHEN** 用户已有自定义工具（如 cron、memory）
- **THEN** RAG 工具追加到已有列表，已有工具完全保留

### Requirement: 检索结果带源引用

`search_codebase` SHALL 在结果中提供足以让用户追溯的源信息：每条命中至少包含 `file` 路径、`start_line`、`end_line`、`symbol`（若适用）、`score`，确保 Agent 在回答时可引用源。

#### Scenario: 工具结果可被 Agent 引用

- **WHEN** Agent 收到 `search_codebase` 结果
- **THEN** 结果 JSON 字符串中每条均含 `file`、`start_line`、`end_line` 字段，Agent 可在回答中以 `file:line` 形式引用

### Requirement: 工具错误处理

工具调用失败时（索引未建立、维度不一致、provider 不可用等），SHALL 返回结构化错误 `{error: str, code: str, hint?: str}`，而 NOT 抛出异常或返回空字符串。Agent SHALL 能据此决定下一步动作。

#### Scenario: 索引未建立时友好错误

- **WHEN** RAG config 存在但 index.db 为空就调 `search_codebase`
- **THEN** 工具返回 `{error: "Index not built", code: "INDEX_EMPTY", hint: "请先在 /rag 页面点击重建"}`

#### Scenario: provider 不可用时返回原因

- **WHEN** OpenAI API 401 时调 `search_codebase`
- **THEN** 工具返回 `{error: "Embedding provider error", code: "PROVIDER_ERROR", hint: "401 Unauthorized"}`

#### Scenario: 维度不一致时拦截

- **WHEN** 切了 provider 但未重建就调 `search_codebase`
- **THEN** 工具返回 `code: "INDEX_DIM_MISMATCH"` 而不是返回错误结果

### Requirement: grep_code 安全边界

`grep_code` SHALL 仅在当前 cwd 范围内搜索，SHALL 拒绝绝对路径或 `..` 跨出 cwd 的 glob；SHALL 应用与索引相同的过滤（`.gitignore` + `.ragignore` + 二进制 + 超大文件）；SHALL 限制返回结果数（默认 50，最大 500）。

#### Scenario: 拒绝越界 glob

- **WHEN** Agent 调 `grep_code("xxx", glob="../../*.py")`
```

Full source: openspec/changes/add-rag-tool-call/specs/rag-agent-tools/spec.md

## openspec/changes/add-rag-tool-call/specs/rag-embedding-providers/spec.md

- Source: openspec/changes/add-rag-tool-call/specs/rag-embedding-providers/spec.md
- Lines: 1-176
- SHA256: d0bde0fb0d33b859eebd3b3fd6212751e75aa305fcd880a48461e29272be988d

[TRUNCATED]

```md
## ADDED Requirements

### Requirement: EmbedProvider 抽象

系统 SHALL 定义统一的 `EmbedProvider` 接口（Python Protocol），包含以下方法：`embed(texts: list[str]) -> list[Vector]`、`health_check() -> tuple[bool, str]`、`estimate_cost(tokens: int) -> float`，以及属性 `name: str`、`dimensions: int`、`max_batch_tokens: int`。所有内置 provider 与未来扩展 SHALL 实现该接口。

#### Scenario: 所有内置 provider 实现接口

- **WHEN** 加载任意内置 provider（openai/ollama/local/openai-compatible）
- **THEN** 它实现完整的 `EmbedProvider` 接口，且 `health_check` 返回二元组

#### Scenario: health_check 返回失败原因

- **WHEN** provider 连不上目标服务
- **THEN** `health_check()` 返回 `(False, "<具体错误，如 401/ECONNREFUSED>")`

### Requirement: 四个内置 Provider

系统 SHALL 内置以下 4 个 provider 实现：
1. **openai**：调用 OpenAI / 自定 base 的 `/v1/embeddings`，默认模型 `text-embedding-3-small`，dimensions 可配（512/1024/1536）。
2. **ollama**：调用本地 Ollama `/api/embeddings`，默认 base `http://localhost:11434`，模型从 `/api/tags` 动态发现。
3. **local**：使用 `sentence-transformers` 加载 HF 模型，默认 `BAAI/bge-m3`，自动探测设备（cuda/mps/cpu），默认 fp16，lazy 加载，idle 60min 自动卸载。
4. **openai-compatible**：用户填 `api_base` + `api_key` + `model` + `dimensions`，按 OpenAI 协议调用。

#### Scenario: OpenAI provider 默认配置

- **WHEN** 创建 openai provider 不指定参数
- **THEN** 使用 `text-embedding-3-small`，dimensions=1536，api_base 取自 settings 中已有 LLM profile

#### Scenario: Ollama 模型自动发现

- **WHEN** 用户在 UI 选择 Ollama provider 并填入 base URL
- **THEN** UI 展示从 `/api/tags` 拉取的模型列表，未安装模型显示 [拉取] 按钮

#### Scenario: Local provider lazy 加载

- **WHEN** 创建 local provider 后未调用 embed
- **THEN** sentence-transformers 模型未加载入内存

#### Scenario: Local provider 首次嵌入触发加载

- **WHEN** 首次调用 `local_provider.embed([...])`
- **THEN** 模型加载入内存（首次 5-15s），后续调用使用已加载模型

#### Scenario: Local provider idle 卸载

- **WHEN** local provider 连续 60 分钟未被调用
- **THEN** 模型从内存释放，下次调用重新加载

### Requirement: Profile ID 自动生成

系统 SHALL 为每个新创建的 embed profile 生成 ID，格式为 `emb_<provider>_<6位hex随机>`（例 `emb_openai_7k2f9a`）。ID SHALL 在 `settings.embed_profiles[]` 中 UNIQUE，碰撞时重新生成。用户 SHALL NOT 能编辑 ID，仅能编辑 display name。

#### Scenario: 创建 profile 自动生成 ID

- **WHEN** 用户在 UI 保存新 embed profile
- **THEN** 系统生成 `emb_<provider>_<6位>` ID 并写入；用户无需输入 ID

#### Scenario: Display name 与 ID 分离

- **WHEN** 用户编辑 profile 的 display name
- **THEN** display name 更新但 ID 保持不变

#### Scenario: ID 在 settings 中唯一

- **WHEN** 创建多个 profile
- **THEN** 所有 ID 互不重复（碰撞时系统重新生成）

### Requirement: Profile 配置存储

系统 SHALL 在 `~/.openharness/settings.json` 维护全局 `embed_profiles[]` 数组；API key 字段 SHALL 经过 `auth/storage.py` 加密存储；per-project 配置 `.openharness/rag/<project_hash>/config.json` 仅存 `embed_profile_id` 引用，不重复存敏感字段。

#### Scenario: API key 加密存储

- **WHEN** 用户输入 OpenAI API key 并保存
- **THEN** 写入的 settings.json 中 key 字段为加密形态，原文不可见

#### Scenario: 多项目共享同一 profile

- **WHEN** 用户在两个不同 cwd 都选用同一 profile id
```

Full source: openspec/changes/add-rag-tool-call/specs/rag-embedding-providers/spec.md

## openspec/changes/add-rag-tool-call/specs/rag-indexing/spec.md

- Source: openspec/changes/add-rag-tool-call/specs/rag-indexing/spec.md
- Lines: 1-182
- SHA256: 450e8e35a2d30a5831f0a448c06e04169f9dbdedda7264b4dad8f5cef594a8f8

[TRUNCATED]

```md
## ADDED Requirements

### Requirement: 语料发现与过滤

系统 SHALL 在执行索引时扫描当前 cwd 目录下的所有候选文件，并按以下规则过滤：必须先应用 `.gitignore`，再应用 `.ragignore`（支持 `!` 白名单覆盖），排除二进制文件、超过 1MB 的单文件、以及不在支持扩展名列表中的文件。

#### Scenario: 排除 .gitignore 中的文件

- **WHEN** 仓库根有 `.gitignore` 内容包含 `node_modules/` 且执行全量索引
- **THEN** 索引结果中不包含任何 `node_modules/` 下文件的 chunk

#### Scenario: .ragignore 白名单覆盖 .gitignore

- **WHEN** `.gitignore` 排除 `dist/`，`.ragignore` 包含 `!dist/api.md`
- **THEN** 索引结果中包含 `dist/api.md` 的 chunks

#### Scenario: 跳过超大文件

- **WHEN** 仓库内存在一个 2MB 的 `.log` 文件
- **THEN** 索引器跳过该文件并在日志中记录"超大文件已跳过"

#### Scenario: 跳过二进制文件

- **WHEN** 仓库内存在 `.png`、`.exe`、`.zip` 文件
- **THEN** 索引器全部跳过，不尝试 chunking

### Requirement: 多策略切片

系统 SHALL 根据文件扩展名选择 chunker：代码文件（py/ts/tsx/js/go/java/cpp/h/rust）使用 tree-sitter AST chunker；Markdown 文件（md/mdx）使用 heading + 滑窗 chunker；其他文本使用递归字符 chunker；任意 chunker 失败时回退到递归字符 chunker。

#### Scenario: Python 函数被独立切片

- **WHEN** 索引一个含 3 个顶层函数的 `.py` 文件
- **THEN** 至少产生 3 个 chunk，每个 chunk 的 `kind="function"` 且 `symbol` 等于函数名

#### Scenario: 超大函数二次切分

- **WHEN** 索引一个单函数体超过 512 token 的 Python 文件
- **THEN** 该函数被切为多个 chunk，每个 chunk 头部包含 `# from <parent>` 面包屑

#### Scenario: Markdown 按 heading 切

- **WHEN** 索引一个含 `# A` `## B` `## C` 的 Markdown 文件
- **THEN** 至少产生 3 个 chunk，每个对应一个 heading 节

#### Scenario: tree-sitter 解析失败回退

- **WHEN** 索引一个语法严重损坏的 `.ts` 文件
- **THEN** 系统回退到递归字符 chunker 继续完成索引，并在日志中记录失败原因

#### Scenario: chunk 包含上下文前缀

- **WHEN** 索引一个类方法
- **THEN** 该 chunk 的 `content` 字段以 `# file: <path>\n# class <ClassName>:\n` 开头

### Requirement: 索引存储

系统 SHALL 在 `.openharness/rag/<project_hash>/index.db` 维护一个 SQLite 文件，包含 FTS5 虚表 `chunks`（用于 BM25）、`sqlite-vec` 虚表 `vec_chunks`（用于向量）、普通表 `file_meta`（文件级元数据）和 `embed_ledger`（费用记录）。`project_hash` SHALL 为 `sha256(cwd)` 的前 12 位十六进制。

#### Scenario: 首次索引创建 DB 文件

- **WHEN** 在一个新 cwd 下首次执行索引
- **THEN** `.openharness/rag/<12位 hash>/index.db` 被创建且包含 4 张表

#### Scenario: 切 cwd 隔离索引

- **WHEN** 在 cwd A 索引后切到 cwd B 执行 search
- **THEN** 搜不到 cwd A 的内容，B 有独立 DB

#### Scenario: file_meta 记录 sha 与时间

- **WHEN** 索引完一个文件
- **THEN** `file_meta` 表中该 file 的行有非空 `sha`、`mtime`、`last_indexed`、`chunk_count`

### Requirement: 增量索引与 SHA 短路

系统 SHALL 提供"增量更新"模式：仅处理满足以下任一条件的文件：（a）`file_meta` 中无记录；（b）当前文件 SHA 与记录不一致。对单 chunk SHA 与库内一致的，SHALL 跳过嵌入调用。

#### Scenario: 未变文件被跳过

```

Full source: openspec/changes/add-rag-tool-call/specs/rag-indexing/spec.md

## openspec/changes/add-rag-tool-call/specs/rag-search/spec.md

- Source: openspec/changes/add-rag-tool-call/specs/rag-search/spec.md
- Lines: 1-84
- SHA256: 438e75cd3773db60b274e6d572965ea05f70954f95ba66f43c497708b445dc57

[TRUNCATED]

```md
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

```

Full source: openspec/changes/add-rag-tool-call/specs/rag-search/spec.md

