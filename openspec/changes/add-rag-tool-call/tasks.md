## 1. 项目骨架 & 依赖

- [x] 1.1 在 `HLAgent/gateway/pyproject.toml` 加入核心依赖：`sqlite-vec>=0.1.6`、`watchdog>=4.0`、`tree-sitter>=0.21`、`tree-sitter-languages>=1.10`、`tiktoken>=0.7`、`huggingface_hub>=0.24`、`aiosqlite>=0.20`
- [x] 1.2 在 `pyproject.toml` 加入可选 extras：`[embed-local]` = `sentence-transformers>=3.0` + `torch>=2.4`；`[embed-local-gpu]` = `torch>=2.4` (CUDA wheel index)
- [x] 1.3 创建 `HLAgent/gateway/services/rag/` 目录骨架（含 `__init__.py`、`indexer.py`、`watcher.py`、`search.py`、`store.py`、`budget.py`、`chunkers/`、`providers/`）
- [x] 1.4 创建 `HLAgent/gateway/routers/rag.py` 占位（仅 router 注册，不写端点）
- [x] 1.5 在 `HLAgent/gateway/main.py` include `rag.py` router；启动早期执行 `os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")`
- [x] 1.6 全局 settings 增加 `embed_profiles: list[dict]` 与 `hf_endpoint: str | None` 字段（修改 `routers/settings.py` 与底层数据模型）

## 2. 数据层（store.py + schema）

- [x] 2.1 实现 `store.RagStore`：打开 `.openharness/rag/<project_hash>/index.db`，加载 sqlite-vec 扩展，建 4 张表（chunks FTS5 / vec_chunks vec0 / file_meta / embed_ledger）
- [x] 2.2 `RagStore.upsert_chunks(chunks, vectors)`：事务包裹，写入 chunks + vec_chunks + chunks_fts；带 SHA 短路逻辑
- [x] 2.3 `RagStore.delete_file(path)`：删除该 file 的所有 chunks/vec/fts 行 + file_meta 记录
- [x] 2.4 `RagStore.purge_all()`：清空 4 张表（重建用）
- [x] 2.5 `RagStore.get_file_sha(path)` / `get_chunk_hash_set(path)`：增量短路查询
- [x] 2.6 `RagStore.bm25_search(query, limit)` 与 `RagStore.vector_search(vec, limit)`：返回 (rowid, score) 列表
- [x] 2.7 `RagStore.stats()`：返回 chunks 数 / files 数 / 总字节 / 各 provider 维度
- [x] 2.8 `RagStore.check_dim_consistency(dim)`：返回 bool；启动时调

## 3. 切片层（chunkers/）

- [x] 3.1 实现 `chunkers/text.py`：递归字符切分 (`\n\n` → `\n` → `. ` → ` ` → 字符)，目标 512 token，overlap 64；使用 tiktoken 计 token
- [x] 3.2 实现 `chunkers/markdown.py`：解析 ATX heading 切节；小节合并；大节按段落二切并加面包屑；代码块/表格视为原子
- [x] 3.3 实现 `chunkers/code.py` 基础：tree-sitter 解析、节点遍历框架、上下文前缀生成（`# file:`、`# class X:`）
- [x] 3.4 chunkers/code.py 支持 Python（function_definition / class_definition / 方法）
- [x] 3.5 chunkers/code.py 支持 TypeScript / JavaScript（function_declaration / arrow_function 绑定到 const / class / interface）
- [x] 3.6 chunkers/code.py 支持 Go（function_declaration / method_declaration / type_declaration）
- [x] 3.7 chunkers/code.py 支持 Java（method_declaration / class_declaration / interface_declaration）
- [x] 3.8 chunkers/code.py 支持 C/C++（function_definition / class_specifier / struct_specifier）
- [x] 3.9 chunkers/code.py 支持 Rust（function_item / impl_item / struct_item / enum_item）
- [x] 3.10 chunker dispatch：按扩展名选 chunker；二进制/超大/忽略文件返回空；任意 chunker 异常 fallback 到 text chunker

## 4. 嵌入 Provider 抽象与实现

- [x] 4.1 `providers/base.py`：`EmbedProvider` Protocol；`ProviderConfig` Pydantic 模型；profile_id 生成器 `gen_profile_id(provider)`
- [x] 4.2 `providers/__init__.py`：provider 注册表 + factory `make_provider(profile: dict) -> EmbedProvider`
- [x] 4.3 `providers/openai_provider.py`：复用 `auth/storage.py` 取 key；batch 打包到 ~80k token；asyncio.Semaphore(8) 并发；tenacity 重试 5 次；`estimate_cost` 按 token 计 `text-embedding-3-small` 单价
- [x] 4.4 `providers/ollama_provider.py`：调 `/api/embeddings`；实现 `list_models()` 拉 `/api/tags`；`pull_model(name)` 代理 `/api/pull`（流式进度透传到 SSE）
- [ ] 4.5 `providers/local_provider.py`：lazy load sentence-transformers；设备探测（cuda > mps > cpu）；fp16 默认；ThreadPoolExecutor(1) 包 model.encode；idle 60min 卸载（后台 asyncio task）
- [x] 4.6 `providers/compat_provider.py`：参数化 OpenAI-compat 端点；继承 openai_provider 的 batch/重试逻辑
- [x] 4.7 所有 provider 实现 `health_check() -> (bool, str)`，错误信息含具体原因（401/ECONNREFUSED 等）

## 5. 索引主流程（indexer.py + budget.py）

- [x] 5.1 `budget.Budget`：从 settings 读 daily_usd / over_budget_action；`charge(tokens, cost, source)` 写 `embed_ledger`；`exceeded()` 判断；本地时区跨日重置
- [x] 5.2 `indexer.Indexer`：构造时持有 store / provider / budget / config
- [x] 5.3 `Indexer.iter_candidate_files(cwd)`：遍历 cwd、应用 `.gitignore` + `.ragignore`、过滤二进制/超大、yield path
- [x] 5.4 `Indexer.update(paths: list[str])`：增量更新核心——读文件、算 sha、查 file_meta、若变 → chunk → SHA 短路 → 调 provider → 写库；按 batch 流式 emit 进度事件
- [x] 5.5 `Indexer.rebuild()`：先 `store.purge_all()`，再对全部 candidate 文件调 update 等价逻辑
- [x] 5.6 `Indexer.delete_files(paths)`：调 `store.delete_file` 清理
- [x] 5.7 单一 asyncio worker 串行消化（indexer 与 watcher 共用），防 DB 竞态；提供 cancel token 支持取消
- [x] 5.8 budget 超额时 emit 事件并按 `over_budget_action` 处理（pause: watcher 停 / warn: 仅记录 / hard_stop: 中止当前 job）

## 6. 文件监听（watcher.py）

- [x] 6.1 `watcher.Watcher`：watchdog `Observer` + 自定义 `FileSystemEventHandler`；启动监听 cwd
- [x] 6.2 事件过滤：`.gitignore` + `.ragignore` + 二进制 + 超大；过滤后入队
- [x] 6.3 per-file 防抖：以 path 为 key，500ms 内重复事件合并为最后一个
- [x] 6.4 聚合 flush：每 3s 收集队列内文件 → 调 `indexer.update(paths)` 或 `delete_files(paths)`
- [x] 6.5 启停控制：`start()` / `stop()` / `pause(reason)` / `resume()`；状态可查
- [x] 6.6 健康守护：每 5 分钟 provider `health_check`，连续 3 次失败 → `pause("provider unavailable: <err>")`
- [x] 6.7 与 manual rebuild 互斥：rebuild 开始时 watcher 入队暂停，结束后恢复
- [x] 6.8 状态 + 最近活动日志：环形 buffer（最近 50 条），供 UI 拉取

## 7. 检索（search.py）

- [x] 7.1 `search.Searcher`：持有 store + provider；公开 `hybrid_search(query, top_k=8)`
- [x] 7.2 维度一致性预检（不一致返回 `INDEX_DIM_MISMATCH` 错误）
- [x] 7.3 并行执行 `store.bm25_search(query, 50)` 与 `provider.embed([query]) → store.vector_search(vec, 50)`（asyncio.gather）
- [x] 7.4 RRF 融合 (k=60)，按融合分排序取 top_k；分数归一化到 [0,1]
- [x] 7.5 结果组装：返回 `[{file, lang, kind, symbol, start_line, end_line, score, content}]`
- [ ] 7.6 性能验证：构造 10k chunks 数据集，确认 P95 < 300ms

## 8. Agent 工具集

- [x] 8.1 `rag/tools/search_codebase.py`：包装 `Searcher.hybrid_search`；返回 JSON 字符串；错误情况返回 `{error, code, hint}` 结构
- [x] 8.2 `rag/tools/grep_code.py`：调用 ripgrep（`subprocess` 或 `python-ripgrep`）；强制 cwd 边界；过滤规则复用 indexer；上限 500
- [x] 8.3 `rag/tools/read_file.py`：复用现有 `routers/fs.py` 的安全边界；支持 start/end 行
- [x] 8.4 工具 schema 定义（OpenAI tool-use 格式 + Anthropic 兼容）
- [x] 8.5 在 `services/session_manager.py` 或 `routers/sessions.py` / `ws.py` 创建 session 时检查 RAG config，按 `enabled` 注入三工具

## 9. Gateway REST API

- [x] 9.1 `POST /api/rag/rebuild`：触发全量重建（异步），返回 job_id
- [x] 9.2 `POST /api/rag/update`：触发增量（异步），返回 job_id
- [x] 9.3 `POST /api/rag/cancel`：取消进行中的 job
- [x] 9.4 `GET /api/rag/status`：返回 stats + watcher 状态 + 最近活动 + 今日费用
- [x] 9.5 `POST /api/rag/search`：playground 调用，参数 `{query, top_k?}`
- [x] 9.6 `GET /api/rag/ignore` / `PUT /api/rag/ignore`：读写 `.ragignore` 文件
- [x] 9.7 `POST /api/rag/embed/test`：临时构造 provider 跑 health_check + 1 次嵌入；返回 `{ok, latency_ms, dimensions, error?}`
- [ ] 9.8 `POST /api/rag/embed/download`：触发 huggingface_hub.snapshot_download；磁盘预检 < 2× → 507；进度推 SSE
- [x] 9.9 `GET /api/rag/embed/ollama/models`：代理 Ollama `/api/tags`
- [x] 9.10 `POST /api/rag/embed/ollama/pull`：代理 Ollama `/api/pull`，流式进度
- [x] 9.11 `GET /api/rag/profiles` / `POST` / `PATCH` / `DELETE`：embed_profiles CRUD（id 自动生成、display name 可改）
- [x] 9.12 `POST /api/rag/watcher/toggle`：开关 watcher
- [x] 9.13 `GET /api/rag/stream`：统一 SSE 进度通道
- [x] 9.14 `POST /api/rag/purge`：清空索引（删 DB 文件 + 内存状态）

## 10. Web UI: /rag 页面

- [x] 10.1 添加路由 `/rag` 到 `HLAgent/web/src/App.tsx`（或路由配置）
- [x] 10.2 SSE 客户端 hook `useRagStream()`：订阅 `/api/rag/stream`，按 stage/source 分发到全局状态
- [x] 10.3 状态卡片组件：显示 chunks/files/size/last_indexed/today_cost
- [x] 10.4 操作按钮组件：[手动重建] [手动增量] [取消]；watcher 切换 toggle；预算配置（日额度 + 超额行为）
- [x] 10.5 进度条组件：根据 SSE 事件实时更新；显示当前 stage/file/速度
- [x] 10.6 最近活动日志组件：环形 buffer，最新在上
- [x] 10.7 Embed Profile 管理组件：列表 + 新建对话框 + 编辑 + 删除 + 设为 active
- [x] 10.8 Provider 动态表单：按 provider 类型渲染不同字段（OpenAI / Ollama / Local / Compat）；ID 只读显示
- [x] 10.9 [测试连接] 按钮：调 `/api/rag/embed/test`，未通过禁用保存
- [ ] 10.10 Local provider 专属 UI：模型选择 + 设备 + 精度 + 缓存目录 + [下载模型] + 下载进度条 + 后端依赖检测提示
- [x] 10.11 Ollama 专属 UI：模型下拉自动发现 + 未装显示 [拉取]
- [x] 10.12 HF 镜像切换组件（mirror / 官方 / 自定义）+ [测试连通]
- [x] 10.13 维度变更确认对话框：切 provider 时 dim 不一致弹出
- [x] 10.14 .ragignore 编辑器：Monaco 简易模式 + 保存
- [x] 10.15 Playground 区块：输入框 + [搜索] + 结果列表（可展开 content / 跳转源文件）

## 11. Onboarding & 默认引导

- [ ] 11.1 `/rag` 首次访问检测：若无 active embed_profile，引导用户配置首个 profile（默认推荐 OpenAI 并尝试复用现有 LLM profile 的 key）
- [ ] 11.2 引导流：配置 → 测试连接 → 选语料范围（确认 cwd）→ 保存并触发首次重建
- [ ] 11.3 在 `/onboarding` 现有引导中追加"RAG 可选步骤"（可跳过）

## 12. 测试

- [ ] 12.1 单测：chunkers/text、chunkers/markdown、chunkers/code 各语言（输入样例 + 期望 chunk 数/边界）
- [ ] 12.2 单测：store CRUD + SHA 短路 + BM25/vector search
- [ ] 12.3 单测：每个 provider 用 mock HTTP（OpenAI/Ollama/Compat）；local provider mock SentenceTransformer
- [ ] 12.4 单测：RRF 融合正确性（构造已知 rank → 验证融合分）
- [ ] 12.5 集成：watcher 防抖 + 聚合 + SHA 短路 一条龙
- [ ] 12.6 集成：budget 超额 → watcher 暂停
- [ ] 12.7 集成：维度切换 → 检索拦截 → 重建后通过
- [ ] 12.8 e2e (playwright)：UI 走 onboarding → 重建 → playground 搜索看到结果 → 改文件 → watcher 自动 → playground 再搜命中新内容
- [ ] 12.9 性能：1 万 chunk 数据集跑 100 次 query，断言 P95 < 300ms

## 13. 文档

- [ ] 13.1 `HLAgent/README.md` 增加 "RAG" 章节：架构图 + 启用步骤
- [ ] 13.2 `HLAgent/gateway/services/rag/README.md`：模块说明 + 添加新 provider 指南
- [ ] 13.3 用户文档：watcher 工作原理 + 费用预算 + .ragignore 示例 + 切 provider 注意事项
- [ ] 13.4 在 `docs/` 加 RAG 路线图说明（v1/v2/v3 关系）

## 14. 验证与收尾

- [ ] 14.1 全量回归：现有功能（chat / memory / cron / swarm / skills / autopilot）不受影响
- [ ] 14.2 跨平台手测：Windows / macOS / Linux 三平台 watcher 事件正常
- [ ] 14.3 国内网络环境验证：HF 镜像默认配置生效，能下载 bge-m3
- [ ] 14.4 安全复核：API key 加密；grep_code 边界；session 注入不破坏既有工具
- [ ] 14.5 跑 `bash $COMET_GUARD add-rag-tool-call build --apply` 进入归档阶段
