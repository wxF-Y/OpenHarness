"""Auth management REST router."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from openharness.auth.manager import AuthManager
from openharness.api.provider import auth_status
from openharness.config.settings import load_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/status")
async def get_auth_status() -> dict[str, Any]:
    settings = load_settings()
    manager = AuthManager(settings)
    return {
        "auth_status": auth_status(settings),
        "active_profile": settings.resolve_profile()[0],
        "providers": manager.get_auth_status(),
        "profile_statuses": manager.get_profile_statuses(),
    }


class LoginRequest(BaseModel):
    provider: str
    api_key: str
    base_url: str | None = None


@router.post("/login")
async def login(req: LoginRequest) -> dict[str, Any]:
    """Store API key. Does NOT validate — key will be verified on first agent use."""
    try:
        settings = load_settings()
        manager = AuthManager(settings)
        profile_name, _ = settings.resolve_profile()
        manager.store_profile_credential(profile_name, "api_key", req.api_key)
        if req.base_url:
            settings_updated = load_settings()
            settings_updated = settings_updated.model_copy(update={"base_url": req.base_url})
            from openharness.config.settings import save_settings
            save_settings(settings_updated)
        return {"status": "stored", "message": "API Key 已保存，将在首次对话时验证有效性"}
    except Exception as exc:
        raise HTTPException(500, f"保存失败: {exc}") from exc


class LogoutRequest(BaseModel):
    provider: str | None = None


@router.delete("")
async def logout(req: LogoutRequest) -> None:
    settings = load_settings()
    manager = AuthManager(settings)
    profile_name, _ = settings.resolve_profile()
    manager.clear_profile_credential(profile_name)
