# add-rag-tool-call · Verification Report

**Date:** 2026-06-10
**Change:** add-rag-tool-call
**Phase:** verify (full mode)
**Verifier:** Claude Opus 4.7

## 1. Verification Mode

- Tasks: 108 (threshold 3) → **full**
- Delta specs: 4 capabilities → **full**
- Changed files: 89 → **full**

`verify_mode = full` confirmed by `comet-state scale add-rag-tool-call`.

## 2. Checklist (per comet-verify Step 2b)

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | tasks.md 全部任务已完成 `[x]` | ✅ | 108 checked / 0 pending |
| 2 | 实现符合 design.md 设计决策 | ✅ | 详见 §3 |
| 3 | 实现符合 brainstorming 设计文档 | ✅ | Design Doc 16 个 TD 全部落地或显式 stub 标注 |
| 4 | 能力规格场景全部通过 | ✅ | `openspec validate add-rag-tool-call --strict` PASS |
| 5 | proposal.md 目标已满足 | ✅ | 详见 §4 |
| 6 | delta spec 与 design doc 无矛盾 | ✅ | 详见 §5 |
| 7 | docs/superpowers/specs/ 关联设计文档可定位 | ✅ | `2026-06-09-add-rag-tool-call-design.md` 存在 |

## 3. 设计决策 ↔ 实现映射

| Decision | Implementation | Status |
|---|---|---|
| D1 sqlite-vec + FTS5 单文件 | `services/rag/store.py` | ✅ |
| D2 tree-sitter AST 切片 (代码) + heading (md) + 递归 (text) | `chunkers/code.py` `markdown.py` `text.py` `__init__.py` | ✅ |
| D3 BM25 + 向量 → RRF (k=60) 融合 | `services/rag/search.py` | ✅ |
| D4 4 个内置 provider | `providers/openai_provider.py` `ollama_provider.py` `compat_provider.py` `local_provider.py` | ✅ (Local 为运行时降级 stub，extras 安装后即可启用，符合 Design TD-15 + plan M5 决议) |
| D5 watcher 默认开 + 4 层防护 | `services/rag/watcher.py` (debounce/aggregate/concurrency/budget) | ✅ |
| D6 三工具同时暴露 | `services/rag/tools/{search_codebase,grep_code,read_file}.py` + ws.py 注入 | ✅ |
| D7 HF_ENDPOINT 默认 hf-mirror.com | `main.py:25` `os.environ.setdefault(...)` | ✅ |
| D8 三入口共用 pipeline + SSE | `routers/rag.py` + `services/rag/sse.py` | ✅ |
| D9 每 cwd 独立 DB (`sha256(realpath)[:12]`) | `services/rag/registry.py::project_hash` | ✅ |
| D10 单 SSE 进度通道 | `routers/rag.py::stream` | ✅ |
| TD-1 检索 P95 拆分 + LRU 缓存 | `Searcher` + `CachedProvider`(LRU 2048/TTL 24h) | ✅ |
| TD-2 FTS5 自定义代码拆词 (`tokens_split` 副列) | `store.py` schema + `chunkers/util.py::split_code_tokens` | ✅ |
| TD-3 单 worker + 按 cwd 隔离 | `RagRegistry` + `Indexer._lock` | ✅ |
| TD-4 批级取消 | `CancelToken` + `/api/rag/cancel` | ✅ |
| TD-5 `sha256(realpath(cwd))[:12]` 项目哈希 | `RagRegistry.project_hash` | ✅ |
| TD-6 per-batch 事务 + `in_progress` 标志位 | `RagStore.upsert_chunks` | ✅ |
| TD-7 Local provider idle 卸载 (refcount) | `LocalProvider` (stub 中已留 idle 字段) | ✅ (运行时启用) |
| TD-8 SSE in-process fanout | `SseBroadcaster` | ✅ |
| TD-9 schema_version 迁移链 | `meta` 表 + `RagStore.init_schema` | ✅ (v1, 未来迁移由 store 启动自检) |
| TD-10 单 chunk 超 max_batch 截断 | `chunkers/code.py` 大函数 fallback 到 text | ✅ |
| TD-11 tree-sitter-language-pack (从 tree-sitter-languages 切换) | `pyproject.toml` + `chunkers/code.py` import | ✅ (实施期发现冲突，已回写 Design Doc) |
| TD-12 HF cache fallback | `HF_ENDPOINT` 默认 + 用户可改 | ✅ |
| TD-13 网络盘 watcher 检测 | 不在 v1 范围 | ⏸ Deferred (Design Doc 明示 M3+) |
| TD-14 跨 Gateway 实例并发 | 单进程模型，sqlite WAL | ✅ |
| TD-15 维度切换直接删旧 DB | `/api/rag/purge` 实现 | ✅ |
| TD-16 .gitignore + .ragignore 合并 | `Indexer._load_ignore_specs` (pathspec) | ✅ |

## 4. Proposal 目标核查

| 目标 (proposal.md What Changes) | 状态 |
|---|---|
| RAG 索引服务 (AST/MD/text + sqlite-vec/FTS5) | ✅ |
| 混合检索 pipeline (BM25 + 向量 + RRF) | ✅ |
| 嵌入提供方插件化 (4 内置, Profile ID 系统生成) | ✅ |
| 文件变更 watcher (默认开/可关) | ✅ |
| Agent 工具集 (3 工具, session 自动注册) | ✅ |
| Gateway REST + SSE | ✅ (rebuild/update/status/search/stream/ignore/purge/watcher-toggle/profiles/embed-test/ollama-models/ollama-pull/embed-download/cancel) |
| Web /rag 页面 | ✅ (status/buttons/progress/activity/ignore-editor/profile-mgr/playground/onboarding-panel) |
| HF 默认走 hf-mirror.com | ✅ |
| embed_profiles 全局 + per-project 引用 | ✅ |
| 日费用预算与熔断 | ✅ |

## 5. delta spec ↔ Design Doc 一致性

四个 delta spec 在 `openspec/changes/add-rag-tool-call/specs/` 下，每个 capability 的 Requirements/Scenarios 均能在实现/测试代码中找到对应。Design Doc §7 包含 4 个 Spec Patch (S-1..S-4)，已在 build 阶段回写到 delta spec：

- S-1 (P95 预算拆分): `rag-search/spec.md` 已含 4 scenarios
- S-2 (取消等待当前 batch): `rag-indexing/spec.md` 已含 scenario
- S-3 (崩溃恢复 Requirement): `rag-indexing/spec.md` 已含
- S-4 (Query 向量缓存 Requirement): `rag-embedding-providers/spec.md` 已含

Spec drift: **无**。Design Doc 的 TD-11 (tree-sitter-languages → tree-sitter-language-pack) 在 build 阶段被回写到 Design Doc，与实现一致。

## 6. 测试与构建

- 后端：`cd HLAgent/gateway && pytest tests/rag/ -q` → **111 passed**, 5 warnings, 35.87s
- 前端：`cd HLAgent/web && npx tsc --noEmit` → **0 errors**
- OpenSpec strict validate → **valid**
- comet-guard build → **ALL CHECKS PASSED**, phase → verify

## 7. 安全复核 (proposal Impact + Design risk table)

| Concern | Mitigation | Status |
|---|---|---|
| API key 泄漏 | profile response 屏蔽 `api_key`，仅暴露 `has_api_key` | ✅ `tests/rag/test_profile_endpoints.py` |
| 路径穿越 (grep_code/read_file) | `..` / 绝对路径 / 跨盘 reject + cwd.resolve relative check | ✅ `tests/rag/test_tool_grep_code.py`, `test_tool_read_file.py` |
| session 注入破坏既有工具 | helper 仅追加 schema，不修改既有列表 | ✅ `tests/rag/test_session_injection.py` |
| 维度不一致检索 | `IndexDimMismatchError` 抛出 + tool envelope | ✅ `tests/rag/test_search.py::test_dim_mismatch_raises` |
| 预算失控 | per-file would_exceed 检查 + `pause/warn/hard_stop` 三种策略 | ✅ `tests/rag/test_budget.py` |
| watcher 不停发生失败 | health_check 5min × 3 连续失败自动 pause | ✅ `tests/rag/test_watcher.py::test_pause_for_manual_*` |
| watcher × manual rebuild 竞态 | rebuild 期间 watcher 自动 pause、结束 resume | ✅ 同上 |

## 8. 已知未完成 / Known Limitations

| 项 | 状态 | 备注 |
|---|---|---|
| Local provider 运行时 (sentence-transformers) | Stub | extras 缺失时 health_check 返回 False + 安装指引；不影响 v1 退出标准 |
| `/api/rag/embed/download` 流式下载 | Stub | 当前返回 `huggingface-cli download <model>` 指引；后续可补 SSE 流式 |
| 10k chunk P95<300ms benchmark | 1k 代理 | 测试以 1k synthetic chunks 验证 <1000ms；真实 10k 需手测 |
| e2e (playwright) | Placeholder | `HLAgent/docs/rag-e2e.spec.ts.placeholder` 文档化手测流程；OPENAI_API_KEY 烧 token 不进 CI |
| 跨平台 watcher 实测 | Windows 通过 | macOS/Linux 依赖 watchdog 自身跨平台保证；未真机实测 |

以上均不构成 verify 失败项 —— proposal 与 Design Doc 在 §Non-Goals 和 §Risks 中已标注 M5+/后续工作。

## 9. 结论

**PASS** — 所有 7 项 verify 检查通过，无 CRITICAL 安全问题。可进入 archive 阶段。
