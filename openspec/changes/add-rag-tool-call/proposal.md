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
