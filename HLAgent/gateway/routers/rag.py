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


# --- Embed Profile storage (M4 minimal: JSON file) ---

_PROFILES_FILE = _REGISTRY.data_root / "embed_profiles.json"


def _load_profiles() -> list[dict]:
    if not _PROFILES_FILE.exists():
        return []
    return json.loads(_PROFILES_FILE.read_text(encoding="utf-8"))


def _save_profiles(profs: list[dict]) -> None:
    _PROFILES_FILE.parent.mkdir(parents=True, exist_ok=True)
    _PROFILES_FILE.write_text(json.dumps(profs, ensure_ascii=False, indent=2),
                              encoding="utf-8")


def _gen_profile_id_unique(provider: str, existing: list[dict]) -> str:
    from services.rag.providers.base import gen_profile_id
    existing_ids = {p["id"] for p in existing}
    while True:
        pid = gen_profile_id(provider)
        if pid not in existing_ids:
            return pid


def _redact(p: dict) -> dict:
    out = {k: v for k, v in p.items() if k != "api_key"}
    out["has_api_key"] = bool(p.get("api_key"))
    return out


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


# --- Embed Profile CRUD ---

class ProfileCreateReq(BaseModel):
    name: str
    provider: str
    model: str
    dimensions: int
    api_base: str | None = None
    api_key: str | None = None


@router.get("/profiles")
async def list_profiles() -> list[dict]:
    return [_redact(p) for p in _load_profiles()]


@router.post("/profiles")
async def create_profile(req: ProfileCreateReq) -> dict:
    profs = _load_profiles()
    pid = _gen_profile_id_unique(req.provider, profs)
    rec = req.model_dump()
    rec["id"] = pid
    profs.append(rec)
    _save_profiles(profs)
    return _redact(rec)


@router.patch("/profiles/{profile_id}")
async def update_profile(profile_id: str, body: dict) -> dict:
    profs = _load_profiles()
    for p in profs:
        if p["id"] == profile_id:
            body.pop("id", None)
            p.update(body)
            _save_profiles(profs)
            return _redact(p)
    raise HTTPException(404, f"profile {profile_id} not found")


@router.delete("/profiles/{profile_id}")
async def delete_profile(profile_id: str) -> dict:
    profs = _load_profiles()
    new = [p for p in profs if p["id"] != profile_id]
    if len(new) == len(profs):
        raise HTTPException(404, f"profile {profile_id} not found")
    _save_profiles(new)
    return {"deleted": True}


# --- Embed test + Ollama discovery ---

class EmbedTestReq(BaseModel):
    provider: str
    model: str
    dimensions: int
    api_base: str | None = None
    api_key: str | None = None


@router.post("/embed/test")
async def embed_test(req: EmbedTestReq) -> dict:
    import time
    cfg = ProviderConfig(
        id=f"emb_{req.provider}_000000",
        name="(test)",
        provider=req.provider,
        model=req.model,
        dimensions=req.dimensions,
        api_base=req.api_base,
    )
    try:
        prov = make_provider(cfg, api_key=req.api_key)
    except (ValueError, NotImplementedError) as exc:
        return {"ok": False, "error": str(exc), "latency_ms": 0,
                "dimensions": None}
    t0 = time.time()
    ok, msg = await prov.health_check()
    latency_ms = int((time.time() - t0) * 1000)
    return {
        "ok": ok,
        "error": None if ok else msg,
        "latency_ms": latency_ms,
        "dimensions": req.dimensions if ok else None,
    }


@router.get("/embed/ollama/models")
async def ollama_models(base_url: str = "http://localhost:11434") -> dict:
    from services.rag.providers.ollama_provider import OllamaProvider
    prov = OllamaProvider(base_url=base_url, model="(probe)", dimensions=1)
    try:
        models = await prov.list_models()
        return {"models": models}
    except Exception as exc:
        raise HTTPException(502, f"ollama at {base_url}: {exc}")


@router.post("/embed/ollama/pull")
async def ollama_pull(name: str, base_url: str = "http://localhost:11434"):
    from services.rag.providers.ollama_provider import OllamaProvider
    prov = OllamaProvider(base_url=base_url, model=name, dimensions=1)

    async def gen():
        try:
            async for evt in prov.pull_model(name):
                yield f"data: {json.dumps(evt)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")
