---
comet_change: add-rag-tool-call
role: technical-design
canonical_spec: openspec
---

# add-rag-tool-call · Technical Design

> 本文件是 OpenSpec change `add-rag-tool-call` 的 **technical design**。
> 需求与验收场景以 `openspec/changes/add-rag-tool-call/` 下的 spec 为准。
> 本文只补充实现层方案、技术风险、测试策略、边界条件，以及一份回写 OpenSpec 的 Spec Patch 清单。

## 1. 实现里程碑（Walking Skeleton）

5 个里程碑纵向切片，每个 M 都能独立 demo 给用户。tasks.md 现有编号映射到里程碑。

| M | 范围 | 包含 tasks | 预估 | 退出标准（可 demo） |
|---|---|---|---|---|
| **M1 端到端最小通路** | 仅 OpenAI provider、仅 Python 文件、仅手动 | 1.1-1.5, 2.*, 3.1-3.4, 3.10, 4.1-4.3, 4.7, 5.1-5.6, 7.*, 8.1, 8.4, 8.5, 9.1, 9.2, 9.4, 9.5, 9.13, 10.1-10.5, 10.15 | 3-4 天 | 配 OpenAI key → 重建 → playground 搜 Python 函数 → 命中 |
| **M2 拓展语料** | 其它语言 + Markdown + grep_code + read_file | 3.2, 3.3, 3.5-3.9, 8.2, 8.3 | 2 天 | 同上但搜 TS/Go/Java/Md/.txt 全命中；Agent 在 chat 调三工具均可用 |
| **M3 自动化** | watcher + budget + SSE 完整 + 进度 UI | 5.7, 5.8, 6.*, 9.3, 9.6, 9.12, 9.14, 10.6 | 2 天 | 改文件 → 几秒内 UI 显示自动嵌入 → 再搜命中新内容；超额自动暂停 |
| **M4 多 Provider** | Ollama + Local + Compat + Profile 管理 | 1.6, 4.4-4.6, 9.7-9.11, 10.7-10.13 | 3 天 | UI 切 Ollama/Local/Compat，测试连接，切维度强制重建 |
| **M5 打磨** | onboarding + 文档 + 测试 + 性能验证 | 11.*, 12.*, 13.*, 14.* | 2 天 | 全测试通过；onboarding 引导可走完；P95 达标 |

**关键纵切原则**：M1 写的代码不会在 M2-M5 被推倒；每个 M 都把"配置→使用→看到结果"打通；M3 之前 watcher 不存在，靠手动按钮即可演示；M4 之前 OpenAI 写死，但 provider 接口已抽象。

## 2. 关键技术决策（补 design.md 没写的）

### TD-1. 检索 P95 预算拆分 + Query 向量缓存

**问题**：`rag-search/spec.md` 写"P95<300ms"，但 query 现算 embed 在远程 provider 上就吃掉 150-250ms。

**决策**：
- spec 改为"**检索环节**（不含 query embedding）P95<300ms"，query embed 另立 SLA：远程<500ms、本地<100ms（详见 Spec Patch S-1）
- 加 **LRU(2048, TTL 24h)** 缓存 query 向量，key=`sha256(provider_id + dim + query)`，命中率预期 30-50%（playground 重复搜 / Agent 多轮）
- 缓存在 provider 层实现，对调用方透明

**结构**：
```python
class CachedEmbedProvider(EmbedProvider):
    def __init__(self, inner: EmbedProvider, cache_size=2048):
        self._inner = inner
        self._cache = LRUCache(cache_size)   # cachetools.TTLCache(maxsize, ttl=86400)
    async def embed(self, texts):
        # 仅缓存"单条 query 类调用"；批量索引调用绕过
        ...
```

### TD-2. FTS5 代码 tokenize：`tokens_split` 副列

**问题**：FTS5 默认 `porter unicode61` 不拆 camelCase/snake_case，BM25 对 `validateUser` 检索 `user` 召不回。

**决策**：FTS5 表加一个独立列 `tokens_split`，**应用层入库前拆分**写入；查询时同时检索 `content` 和 `tokens_split`，BM25 自动 OR。

**拆分规则**：
```
def split_code_tokens(text: str) -> str:
    # camelCase → camel Case
    # snake_case → snake case
    # kebab-case → kebab case
    # SCREAMING_SNAKE → screaming snake
    # 同时保留原 token（提高 exact match 权重）
    parts = re.split(r'[_\-\s]+|(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', text)
    return ' '.join(filter(None, parts))
```

**Schema 变更**：
```sql
CREATE VIRTUAL TABLE chunks USING fts5(
    file UNINDEXED,
    lang UNINDEXED,
    kind UNINDEXED,
    symbol,
    parent,
    content,
    tokens_split,           -- 新增
    hash UNINDEXED,
    start_line UNINDEXED,
    end_line UNINDEXED,
    tokenize='porter unicode61'
);
```

**查询**：`SELECT ... FROM chunks WHERE chunks MATCH ?` 自动跨列搜，BM25 加和。

### TD-3. Worker 并发模型

**决策**：单 Gateway 进程内只跑 **一个全局 asyncio queue worker**；按 cwd 隔离 `RagSession`（持有 store/provider/watcher/cache）。

```
┌──────────────────────────────────────────────────────────┐
│  Gateway (FastAPI process)                               │
│                                                          │
│  ┌──────────────────────┐    ┌────────────────────────┐  │
│  │  RagSessionRegistry  │    │  Global Worker         │  │
│  │  cwd → RagSession    │──▶│  asyncio.Queue         │  │
│  └──────────────────────┘    │  consumer loop         │  │
│           │                  └────────┬───────────────┘  │
│           │ holds                     │                  │
│           ▼                           ▼                  │
│  RagSession(cwd_A)              处理 IndexJob:          │
│    - store_A                      ① 加 RagSession.lock   │
│    - provider_A                   ② chunks → embed       │
│    - watcher_A                    ③ batch → upsert       │
│    - sse_broadcaster_A            ④ emit SSE / charge    │
└──────────────────────────────────────────────────────────┘
```

**理由**：
- 单 worker → DB 写不竞态（每个 RagSession.store 也有 lock 兜底）
- 按 cwd 隔离 → 切项目互不污染、删项目可一键清
- 不做"per-cwd worker"是因为：v1 不需要 cwd 间并行（用户一次只看一个项目）

**实现**：
- `RagSessionRegistry`：`get_or_create(cwd)` 懒构造
- `Worker`：`asyncio.Queue[Job]`，启动后台 task `run_forever`
- `Job` 类型：`RebuildJob`、`UpdateJob`、`DeleteJob`、`DownloadJob`、`CancelToken`

### TD-4. 取消语义：批级粒度

**决策**：cancel 不中断当前 batch（避免半写、避免重复嵌入费用），等当前 batch 完成后停止；最坏响应延迟 = 1 个 batch 嵌入时间（OpenAI ~1-3s / Local ~0.5s）。

**机制**：
```python
class CancelToken:
    def __init__(self): self._cancelled = False
    def cancel(self): self._cancelled = True
    def __bool__(self): return self._cancelled

async def rebuild(token: CancelToken):
    async for batch in batches():
        if token: 
            emit('cancelled', already_done=N, planned=M)
            return
        await process_batch(batch)    # 原子完成
```

UI 表现：点 [取消] → 按钮置 "正在取消…" → 1-3s 后 toast "已取消（已索引 N/M）"。

### TD-5. 项目哈希规范化

**决策**：`project_hash = sha256(os.path.realpath(cwd))[:12]`

- `realpath` 解析符号链接 + `..` + 多余分隔符
- Windows 路径大小写不一致问题：实测 `realpath` 会保留盘符大小写但路径段大小写跟实际一致；不再额外 lowercase
- 文档说明：用户改 cwd 大小写（如 `e:/x` vs `E:/X`）若 NTFS 大小写不敏感 → realpath 应一致；若大小写敏感（少见）→ 视为不同项目
- 碰撞概率 sha256[:12] ≈ 2⁻⁴⁸，可忽略

### TD-6. 崩溃恢复：per-batch 事务

**决策**：每个嵌入 batch 一个 SQLite 事务，包含：
1. DELETE 旧 chunks for `(file, hash NOT IN new_hashes)`
2. INSERT 新 chunks + vec_chunks + chunks_fts
3. UPDATE file_meta (sha, mtime, last_indexed, dimensions, chunk_count)

崩溃 → 该 batch 整体回滚，文件保持上一个一致状态。

**额外**：启动时检查 `file_meta.in_progress=1` 的孤儿记录（被强杀的 update），自动入队 reindex 该文件。

```sql
ALTER TABLE file_meta ADD COLUMN in_progress INTEGER NOT NULL DEFAULT 0;
-- 写流程：
BEGIN;
  UPDATE file_meta SET in_progress=1 WHERE file=?;
  -- chunks 写入
  UPDATE file_meta SET in_progress=0, sha=?, ... WHERE file=?;
COMMIT;
```

### TD-7. Local Provider Idle 卸载竞态

**问题**：idle 60min 触发卸载时，可能正好有并发 embed 调用进来。

**决策**：refcount + 软定时器：
```python
class LocalProvider:
    _refcount = 0
    _last_use = time.time()
    
    async def embed(self, texts):
        self._refcount += 1
        try:
            await self._ensure_loaded()    # 已卸载则重新加载
            return await self._encode(texts)
        finally:
            self._refcount -= 1
            self._last_use = time.time()
    
    async def _idle_watchdog(self):
        while True:
            await asyncio.sleep(60)
            if self._refcount == 0 and time.time() - self._last_use > 3600:
                await self._unload()
```

### TD-8. SSE 多客户端 Fanout

**决策**：每个 `RagSession` 持有一个 in-process `SseBroadcaster`，多个 SSE 客户端订阅同一个 broadcaster；事件分发到所有订阅者。

```python
class SseBroadcaster:
    def __init__(self): self._subscribers: list[asyncio.Queue] = []
    
    def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=200)   # 慢客户端不阻塞快客户端
        self._subscribers.append(q)
        return q
    
    async def emit(self, event: dict):
        for q in self._subscribers:
            try: q.put_nowait(event)
            except asyncio.QueueFull: pass   # 直接丢，慢客户端自负
```

订阅者断开时清理。

### TD-9. Schema Migration

**决策**：DB 顶部加 `meta` 表，启动时跑 migration chain。

```sql
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
INSERT OR IGNORE INTO meta VALUES ('schema_version', '1');
```

启动流程：
```
open db → read schema_version
        ↓
v == CURRENT? → 直接用
        ↓ no
跑 migrate_v{N}_to_v{N+1}() 链
        ↓
UPDATE meta SET v=CURRENT WHERE k='schema_version'
```

v1 写死 `schema_version=1`；新增列等小变更走 migration；维度/provider 变（不可向后兼容）→ 强制重建，不算 migration。

### TD-10. 单 chunk 超 `max_batch_tokens`

**问题**：偶发：某个超大函数或超长 Markdown 单段塞不进任何 batch。

**决策**：硬截断到 `max_batch_tokens * 0.9`，在截断点后追加 `\n\n[TRUNCATED: original X tokens]` 标记。日志记 warning，不挂任务。

### TD-11. tree-sitter 语法包选择

**决策**：依赖 `tree-sitter-language-pack>=0.3`（社区维护，活跃发版，提供 cp310-cp314 预编译 wheel）替代已不再维护的 `tree-sitter-languages`。API 保持兼容：`from tree_sitter_language_pack import get_parser`，使用方式与原包一致。

**理由**：
- `tree-sitter-languages` 1.10.x 自 2024-02 起未发版，作者声明不支持源码安装；Python 3.13/3.14 没有 wheel
- `tree-sitter-language-pack` 是同一群核心贡献者维护的 fork，覆盖 30+ 语言
- 单包内置全部语言，避免每加一种语言改一次 pyproject

不引入 `tree-sitter` 主包之外的单语言绑定包，因为 Windows wheel 不齐全。

### TD-12. HF Cache 写不动

**决策**：尝试默认 `~/.cache/huggingface/hub` → 写不动 fallback 到 `.openharness/rag/_hf_cache/`。后者用 `setdefault("HF_HOME", ...)` 注入。

UI 缓存目录字段允许用户改，改后下次重启生效。

### TD-13. Watcher 网络盘检测

**决策**：启动 watcher 时跑一次启发：
- Linux：检查 `/proc/self/mounts` 中 cwd 所在挂载的 fstype，是 `nfs/cifs/sshfs/fuse` 之一 → 提示
- Windows：调 `GetDriveTypeW` 检测 `DRIVE_REMOTE` → 提示
- macOS：检查 mount point 是否在 `/Volumes/` 且 `df -T` 非 `apfs/hfs` → 提示

提示文案："检测到当前 cwd 在网络驱动器，文件变更监听可能漏事件。建议使用手动增量更新。" 不阻止使用。

### TD-14. 跨 Gateway 实例并发

**决策**：v1 **不支持**多 Gateway 实例同时操作同一 cwd 的 index.db。文档说明。

技术兜底：sqlite 自身用文件锁串行写，最坏情况是另一个 Gateway 写时报 `database is locked` —— 上层捕获，emit 错误事件，不损坏数据。

### TD-15. 维度切换时旧 DB 处理

**决策**：维度变化确认对话框点"确定" → **直接删** `.openharness/rag/<hash>/index.db` 文件 → 创建新 DB → 触发全量重建。不保留备份（备份目录会无限膨胀，用户无机制清理）。

UI 文案明确："切换嵌入维度将清空已有索引并重建，预计 X 分钟。是否继续？"

### TD-16. `.ragignore` vs `.gitignore` 合并

**决策**：先读 `.gitignore` 规则，再叠加 `.ragignore` 规则。`.ragignore` 支持 `!path` 白名单覆盖 `.gitignore` 排除。

```python
import pathspec
gi = pathspec.PathSpec.from_lines('gitwildmatch', open('.gitignore'))
ri = pathspec.PathSpec.from_lines('gitwildmatch', open('.ragignore'))

def is_indexed(path):
    if gi.match_file(path):
        # 被 git 忽略，看 .ragignore 是否白名单
        return any(p.startswith('!') and matches(p[1:], path) for p in ri.patterns)
    return not ri.match_file(path)
```

实际依赖 `pathspec>=0.12`（依赖 1.1 行加）。

## 3. 测试策略

| 类别 | 工具 | 关键点 |
|---|---|---|
| **chunkers 单测** | pytest + 真实样本 | 每语言各 1-2 个样本文件；不 mock tree-sitter（grammar 包小且确定） |
| **store 单测** | pytest + `:memory:` SQLite | 加载 sqlite-vec 扩展；FTS5 + vec 同时建表；CRUD + SHA 短路全测 |
| **providers 单测** | respx (HTTP mock) | OpenAI/Ollama/Compat 全 mock；Local provider 跑真模型用一个超小模型（`all-MiniLM-L6-v2`，~80MB） + `@pytest.mark.slow` 标记 |
| **indexer 集成** | pytest-asyncio + tmpfs cwd | 造 50 文件项目，rebuild → search → 修改 5 文件 → update → search 命中新内容 |
| **watcher 集成** | watchdog `MockObserver` 注入 | 不真摸 FS；触发 event 测防抖/聚合/budget 熔断 |
| **search 性能** | pytest-benchmark | 造 10k chunks fixture，跑 100 query，断言 P95<300ms（不含 embed） |
| **e2e** | playwright（已有） | onboarding → 配 OpenAI → 重建 → playground 搜 → 改文件 → 自动嵌 → 再搜 |
| **跨平台** | GH Actions matrix Win/Mac/Linux | watcher 集成测仅 lin/mac 自动跑；Win 手测记录在 14.2 |

**覆盖率目标**：rag/ 模块整体 ≥ 80%；providers/local_provider.py 因模型大可降到 60%。

## 4. 风险登记表（补 design.md 的）

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **tree-sitter-languages 在 Windows 缺包** | 中 | 高 | 启动 doctor 检测 import；缺则前端 /rag 红条 + 安装命令 |
| **sqlite-vec 在 macOS x86 brew sqlite 冲突** | 低 | 中 | 文档说明用 system sqlite；CI 加 macOS arm64 + x86 双跑 |
| **大仓首次嵌入超预算停在半途** | 高 | 中 | 重建前预估费用 + 弹窗提示；预算可临时调高 |
| **用户重命名 cwd 后变孤儿索引** | 低 | 低 | UI 提供 [清理无效项目索引] 入口（v1 留按钮，逻辑 v2 完善） |
| **OpenAI 改 schema** | 低 | 高 | provider 严格 pydantic 校验返回；版本锁 SDK |
| **watchdog 在容器内不工作** | 中 | 中 | 文档说明；提供"轮询模式"flag（v3 加） |
| **playground SSE 长连接 nginx 超时** | 中 | 低 | 文档示例 nginx config（proxy_read_timeout 3600） |
| **同一 cwd 在 IDE 中被多 Gateway 同时开** | 低 | 中 | sqlite 文件锁兜底；启动检测 `.openharness/rag/<hash>/.lock` |

## 5. 模块边界 & 单一职责检查

```
rag/
├── store.py           ← 只跟 sqlite 说话；不知道 provider/chunker
├── chunkers/          ← 纯函数 file→chunks；不知道 store/provider
├── providers/         ← 接 provider API；不知道 store/chunker
├── budget.py          ← 只算钱；不调任何外部
├── indexer.py         ← 编排 chunker + provider + store + budget；本身不操作 FS
├── watcher.py         ← 只发事件给 worker；不直接调 indexer
├── search.py          ← store + provider 组合检索；不操作 FS / SSE
├── session.py         ← 单 cwd 的 facade，持有上述所有 + sse_broadcaster
├── registry.py        ← cwd → session 映射；进程级单例
├── worker.py          ← 全局 queue worker
└── tools/             ← Agent 工具适配；只调 session.search / grep / read
```

依赖方向严格单向：tools → session → {indexer, search} → {store, providers, chunkers, budget}。watcher/worker 是 indexer 的"驱动"，不被反向依赖。

## 6. 部署 & 配置面

**新增配置项（settings.json）**：
```yaml
hf_endpoint: "https://hf-mirror.com"
embed_profiles:
  - id: "emb_openai_a3f9b2"
    name: "OpenAI Default"
    provider: "openai"
    model: "text-embedding-3-small"
    dimensions: 1536
    api_key_enc: "<encrypted>"
    api_base: null
```

**新增配置项（per-project `.openharness/rag/<hash>/config.json`）**：
```yaml
embed_profile_id: "emb_openai_a3f9b2"
enabled: true
watcher:
  enabled: true
  debounce_ms: 500
  flush_interval_s: 3
  max_concurrent_embeds: 8
budget:
  daily_usd: 1.0
  over_budget_action: "pause"   # pause | warn | hard_stop
```

**新增环境变量**（用户可选）：
- `HF_ENDPOINT` — 覆盖 settings 中的镜像
- `HLAGENT_RAG_DATA_DIR` — 自定义索引根目录（默认 `.openharness/rag/`）

## 7. 回写 OpenSpec 的 Spec Patch 清单

下列 patch 会回写到 `openspec/changes/add-rag-tool-call/specs/` 对应文件。仅补充验收场景与精确化措辞，不引入新需求。

### S-1. `rag-search/spec.md` · 精确化 P95 预算

**当前**：
> ### Requirement: 检索性能预算
> 系统 SHALL 在 1 万 chunk 规模下，单次混合检索（不含 reranker）端到端延迟 P95 < 300ms。

**改为**：
> ### Requirement: 检索性能预算
> 系统 SHALL 在 1 万 chunk 规模下：
> - **检索环节**（BM25 + 向量召回 + RRF 融合 + 结果组装，不含 query embedding）P95 < 300ms。
> - **Query embedding**：远程 provider P95 < 500ms；本地 provider（Ollama/Local）P95 < 100ms。
> - 系统 SHALL 提供 query 向量的 LRU(2048, TTL 24h) 缓存。
>
> #### Scenario: 检索环节延迟达标
> - **WHEN** index 中有约 10000 chunks，跑 100 次 query 测检索环节
> - **THEN** P95 < 300ms
>
> #### Scenario: Query 向量缓存命中
> - **WHEN** 同一 query 在 24h 内被检索两次（同 provider 同维度）
> - **THEN** 第二次 query embedding 直接命中缓存（< 1ms）

### S-2. `rag-indexing/spec.md` · 取消粒度

**新增 scenario**（追加在"全量重建过程可被取消"之后）：
> #### Scenario: 取消等待当前 batch 完成
> - **WHEN** 用户在 batch 进行中点"取消"
> - **THEN** 系统不中断当前 batch（保护已嵌入投入），等当前 batch 完成（最长 3s）后停止；emit 事件 `{done: N, planned: M, status: "cancelled"}`

### S-3. `rag-indexing/spec.md` · 崩溃恢复

**新增 Requirement**：
> ### Requirement: 崩溃恢复
> 系统 SHALL 对每个嵌入 batch 包裹 SQLite 事务；启动时 SHALL 检查 `file_meta.in_progress=1` 的孤儿记录，自动入队 reindex 该文件。
>
> #### Scenario: 单 batch 崩溃文件不残缺
> - **WHEN** 嵌入 batch 写库时进程被强杀
> - **THEN** 该 batch 的所有 chunks 因事务回滚未写入；文件状态保持上一个一致版本
>
> #### Scenario: 启动恢复孤儿文件
> - **WHEN** 启动时检测到 `file_meta.in_progress=1`
> - **THEN** 该文件被加入下一次 update 队列重新索引

### S-4. `rag-embedding-providers/spec.md` · Query 缓存归属

**新增 Requirement**：
> ### Requirement: Query 向量缓存
> 系统 SHALL 在 provider 层包装 LRU(2048, TTL 24h) 缓存层，key 由 `provider_id + dimensions + sha256(query)` 组成。仅对单条 query 类调用启用；批量索引调用绕过缓存。
>
> #### Scenario: 缓存隔离
> - **WHEN** 同样的 query 字符串在两个不同 provider 上调用
> - **THEN** 各自独立缓存，互不串扰
>
> #### Scenario: 维度变化失效
> - **WHEN** 同 provider 的 dimensions 字段变更
> - **THEN** 旧 key 自然失效（新 key 不匹配），下次调用重新嵌入

## 8. 下一步

- 用 `writing-plans` 把 M1 落到一个可执行的 implementation plan
- M1 计划经用户 review 后进 build 阶段（`/comet-build`）
- M2-M5 作为后续 plan，复用本 Design Doc 的决策不再讨论
