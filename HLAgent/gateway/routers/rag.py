"""RAG REST + SSE endpoints. M1 scope: rebuild, update, status, search, stream."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.rag.budget import Budget
from services.rag.providers import make_cached_provider, make_provider
from services.rag.providers.base import ProviderConfig
from services.rag.registry import RagRegistry
from services.rag.session import RagSession
from services.rag.store import RagStore
from services.rag.worker import CancelToken

router = APIRouter(prefix="/api/rag", tags=["rag"])

_REGISTRY = RagRegistry()
_CANCEL_TOKENS: dict[str, CancelToken] = {}


def _cancel_key(cwd: Path) -> str:
    return _REGISTRY.project_hash(cwd)


def _get_active_profile() -> dict | None:
    """Load active embed_profile. M1 minimal: env-based default."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None
    return {
        "id": "emb_openai_def001",
        "name": "Default OpenAI",
        "provider": "openai",
        "model": "text-embedding-3-small",
        "dimensions": 1536,
        "api_key": api_key,
        "api_base": "https://api.openai.com/v1",
    }


def _get_or_create_session(cwd_str: str) -> RagSession:
    cwd = Path(cwd_str).resolve()
    if not cwd.exists() or not cwd.is_dir():
        raise HTTPException(400, f"cwd not found: {cwd_str}")
    sess = _REGISTRY.get(cwd)
    if sess:
        return sess

    profile = _get_active_profile()
    if not profile:
        raise HTTPException(409, "No active embed profile. Set OPENAI_API_KEY env var (M1).")
    cfg = ProviderConfig(
        id=profile["id"], name=profile["name"], provider=profile["provider"],
        model=profile["model"], dimensions=profile["dimensions"],
        api_base=profile["api_base"],
    )
    inner = make_provider(cfg, api_key=profile["api_key"])
    cached = make_cached_provider(inner, profile_id=cfg.id)
    db_path = _REGISTRY.db_path(cwd)
    store = RagStore(db_path, dimensions=cfg.dimensions)
    store.init_schema()
    budget = Budget(store, daily_usd=1.0, over_budget_action="pause")
    sess = RagSession(cwd=cwd, store=store, provider=cached, budget=budget)
    _REGISTRY.register(cwd, sess)
    return sess


class SearchReq(BaseModel):
    query: str
    top_k: int = 8


@router.get("/status")
async def status(cwd: str) -> dict:
    sess = _get_or_create_session(cwd)
    stats = sess.store.stats()
    return {
        "stats": stats,
        "active_profile": {
            "id": sess.provider.profile_id,
            "model": getattr(sess.provider.inner, "model", "unknown"),
            "dimensions": sess.provider.dimensions,
        },
        "today_cost_usd": sess.budget.today_total_usd(),
        "budget_usd": sess.budget.daily_usd,
    }


@router.post("/rebuild")
async def rebuild(cwd: str) -> dict:
    sess = _get_or_create_session(cwd)
    key = _cancel_key(sess.cwd)
    token = CancelToken()
    _CANCEL_TOKENS[key] = token

    async def run():
        if sess.watcher:
            sess.watcher.pause_for_manual()
        try:
            await sess.indexer.rebuild(on_event=sess.emit, cancel=token)
        except Exception as exc:
            await sess.emit({"stage": "error", "error": str(exc)})
        finally:
            _CANCEL_TOKENS.pop(key, None)
            if sess.watcher:
                sess.watcher.resume_after_manual()

    asyncio.create_task(run())
    return {"started": True}


@router.post("/update")
async def update(cwd: str) -> dict:
    sess = _get_or_create_session(cwd)
    paths = list(sess.indexer._candidate_files())
    key = _cancel_key(sess.cwd)
    token = CancelToken()
    _CANCEL_TOKENS[key] = token

    async def run():
        if sess.watcher:
            sess.watcher.pause_for_manual()
        try:
            await sess.indexer.update(paths, on_event=sess.emit,
                                      cancel=token, source="manual")
        except Exception as exc:
            await sess.emit({"stage": "error", "error": str(exc)})
        finally:
            _CANCEL_TOKENS.pop(key, None)
            if sess.watcher:
                sess.watcher.resume_after_manual()

    asyncio.create_task(run())
    return {"started": True, "files": len(paths)}


@router.post("/cancel")
async def cancel(cwd: str) -> dict:
    sess = _get_or_create_session(cwd)
    key = _cancel_key(sess.cwd)
    token = _CANCEL_TOKENS.get(key)
    if token:
        token.cancel()
        return {"cancelled": True}
    return {"cancelled": False, "reason": "no active job"}


@router.post("/search")
async def search(cwd: str, req: SearchReq) -> Any:
    sess = _get_or_create_session(cwd)
    try:
        return await sess.searcher.hybrid_search(req.query, top_k=req.top_k)
    except Exception as exc:
        raise HTTPException(409, str(exc))


@router.get("/ignore")
async def get_ignore(cwd: str) -> dict:
    sess = _get_or_create_session(cwd)
    f = sess.cwd / ".ragignore"
    content = f.read_text(encoding="utf-8") if f.exists() else ""
    return {"content": content, "exists": f.exists()}


@router.put("/ignore")
async def put_ignore(cwd: str, body: dict) -> dict:
    sess = _get_or_create_session(cwd)
    content = body.get("content", "")
    if not isinstance(content, str):
        raise HTTPException(400, "content must be a string")
    f = sess.cwd / ".ragignore"
    f.write_text(content, encoding="utf-8")
    return {"saved": True, "bytes": len(content.encode("utf-8"))}


@router.post("/purge")
async def purge(cwd: str) -> dict:
    """Delete index DB + drop in-memory session (next call recreates)."""
    sess = _get_or_create_session(cwd)
    db_path = sess.store.db_path
    if sess.watcher is not None:
        try:
            sess.watcher.stop()
        except Exception:
            pass
    sess.store.close()
    key = _REGISTRY.project_hash(sess.cwd)
    _REGISTRY._sessions.pop(key, None)
    _CANCEL_TOKENS.pop(key, None)
    try:
        db_path.unlink(missing_ok=True)
        for suffix in ("-wal", "-shm"):
            sibling = db_path.with_suffix(db_path.suffix + suffix)
            sibling.unlink(missing_ok=True)
    except OSError as exc:
        raise HTTPException(500, f"failed to delete: {exc}")
    return {"purged": True}


@router.post("/watcher/toggle")
async def toggle_watcher(cwd: str, body: dict | None = None) -> dict:
    sess = _get_or_create_session(cwd)
    desired = (body or {}).get("enabled")
    if sess.watcher is None:
        from services.rag.watcher import Watcher
        sess.watcher = Watcher(sess.indexer)
    cur = sess.watcher.state["state"]
    if desired is None:
        desired = cur == "stopped"
    if desired and cur == "stopped":
        sess.watcher.start()
    elif not desired and cur != "stopped":
        sess.watcher.stop()
    return {"state": sess.watcher.state["state"]}


@router.get("/stream")
async def stream(cwd: str, request: Request) -> StreamingResponse:
    sess = _get_or_create_session(cwd)
    q = sess.sse.subscribe()

    async def gen():
        try:
            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            sess.sse.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream")
