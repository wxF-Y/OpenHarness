# RAG Module

## Overview

Provides hybrid (BM25 + vector) retrieval over the user's cwd. Wraps sqlite-vec for vectors and FTS5 for BM25 in a single .db file per project. Surfaced to Agents via three tools: `search_codebase`, `grep_code`, `read_file`.

## Adding a new embedding provider

1. Create `providers/<your_provider>.py` implementing the `EmbedProvider` Protocol from `providers/base.py`. Required methods/attrs: `embed`, `health_check`, `estimate_cost`, `name`, `dimensions`, `max_batch_tokens`.
2. Register it in `providers/__init__.py::make_provider` by adding an `elif cfg.provider == "<your-id>":` branch.
3. Add a test under `tests/rag/test_<your_provider>.py` using respx for HTTP mocking.
4. Surface in the UI by adding the provider id to `HLAgent/web/src/components/RagProfileManager.tsx` form dropdown and (if needed) any provider-specific fields.

## Watcher

`watcher.py` wraps watchdog Observer + asyncio flush loop. Per-file debounce (500ms), 3s aggregate flush, max 8 concurrent embeds, daily budget enforcement, health-check loop (5min interval, 3 fails → pause), manual rebuild mutex.

## Budget

`budget.py` records every embed call in `embed_ledger` (cost_usd, source). `over_budget_action` defaults to `pause`; alternatives `warn` and `hard_stop` are recognized by the indexer.

## Storage layout

```
~/.hlagent/data/rag/<project_hash>/index.db
                                  /config.json   # per-project
~/.hlagent/data/rag/embed_profiles.json          # global profiles
```
