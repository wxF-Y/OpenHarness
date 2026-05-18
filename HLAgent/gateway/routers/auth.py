"""Auth management REST router."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from openharness.auth.manager import AuthManager
from openharness.api.provider import auth_status
from openharness.config.settings import load_settings, save_settings

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
    model: str | None = None
    api_format: str | None = None  # "anthropic" | "openai" | "openai_compat"


@router.post("/login")
async def login(req: LoginRequest) -> dict[str, Any]:
    """Store API key and update settings. Does NOT validate — key will be verified on first agent use."""
    try:
        settings = load_settings()
        manager = AuthManager(settings)
        profile_name, _ = settings.resolve_profile()

        # 1. Store the API key credential
        manager.store_profile_credential(profile_name, "api_key", req.api_key)

        # 2. Update settings: base_url, model, api_format
        updates: dict[str, Any] = {}
        if req.base_url:
            updates["base_url"] = req.base_url
        if req.model:
            updates["model"] = req.model
        if req.api_format:
            updates["api_format"] = req.api_format
        elif req.provider == "anthropic":
            # Ensure anthropic format is not overridden
            updates["api_format"] = "anthropic"
        elif req.provider in ("openai", "openai_compat", "custom") and req.base_url:
            # Default to openai_compat for custom/openai providers with base_url
            updates.setdefault("api_format", "openai_compat")

        if updates:
            settings_updated = settings.model_copy(update=updates)
            save_settings(settings_updated)

        return {
            "status": "stored",
            "message": "API Key 已保存，将在首次对话时验证有效性",
            "updated": list(updates.keys()),
        }
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

