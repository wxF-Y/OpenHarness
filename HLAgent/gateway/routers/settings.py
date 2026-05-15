"""Settings management REST router."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from openharness.config.settings import load_settings, save_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
async def get_settings() -> dict[str, Any]:
    s = load_settings()
    return {
        "model": s.model,
        "provider": getattr(s, "provider", ""),
        "fast_mode": s.fast_mode,
        "effort": s.effort,
        "passes": s.passes,
        "max_turns": s.max_turns,
        "vim_mode": s.vim_mode,
        "voice_mode": s.voice_mode,
        "output_style": s.output_style,
        "theme": s.theme,
        "base_url": s.base_url or "",
    }


class PatchSettingsRequest(BaseModel):
    fast_mode: bool | None = None
    effort: str | None = None
    passes: int | None = None
    max_turns: int | None = None
    vim_mode: bool | None = None
    voice_mode: bool | None = None
    output_style: str | None = None
    theme: str | None = None
    cwd: str | None = None


@router.patch("")
async def patch_settings(req: PatchSettingsRequest) -> dict[str, Any]:
    s = load_settings()
    updates: dict[str, Any] = {}
    if req.fast_mode is not None:
        updates["fast_mode"] = req.fast_mode
    if req.effort is not None:
        updates["effort"] = req.effort
    if req.passes is not None:
        updates["passes"] = req.passes
    if req.max_turns is not None:
        updates["max_turns"] = req.max_turns
    if req.vim_mode is not None:
        updates["vim_mode"] = req.vim_mode
    if req.voice_mode is not None:
        updates["voice_mode"] = req.voice_mode
    if req.output_style is not None:
        updates["output_style"] = req.output_style
    if req.theme is not None:
        updates["theme"] = req.theme

    if updates:
        updated = s.model_copy(update=updates)
        save_settings(updated)

    if req.cwd is not None:
        import os
        try:
            os.chdir(req.cwd)
        except Exception:
            pass

    return {"status": "updated", **updates}


@router.get("/profiles")
async def get_profiles() -> list[dict[str, Any]]:
    s = load_settings()
    profiles = []
    for name, profile in s.merged_profiles().items():
        profiles.append({
            "name": name,
            "provider": getattr(profile, "provider", ""),
            "model": getattr(profile, "model", ""),
            "auth_source": getattr(profile, "auth_source", ""),
            "label": getattr(profile, "label", name),
            "allowed_models": getattr(profile, "allowed_models", []),
        })
    return profiles
