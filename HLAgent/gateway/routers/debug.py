"""Debug and diagnostics REST router — localhost-only endpoints."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/debug", tags=["debug"])

_LOCALHOST = {"127.0.0.1", "::1", "localhost"}


def _require_localhost(request: Request) -> None:
    """Raise 403 if the request does not originate from localhost."""
    host = request.client.host if request.client else ""
    if host not in _LOCALHOST:
        raise HTTPException(403, "Debug endpoints are only accessible from localhost")


@router.get("/doctor")
async def doctor(request: Request) -> dict[str, Any]:
    _require_localhost(request)
    from openharness.api.provider import auth_status
    from openharness.auth.manager import AuthManager
    from openharness.config.settings import load_settings

    settings = load_settings()
    manager = AuthManager(settings)
    active_profile_name, active_profile = settings.resolve_profile()

    return {
        "python_version": sys.version,
        "cwd": str(Path.cwd()),
        "active_profile": active_profile_name,
        "model": settings.model,
        "provider": active_profile.provider if active_profile else "unknown",
        "auth_source": active_profile.auth_source if active_profile else "unknown",
        "auth_status": auth_status(settings),
        "auth_configured": manager.get_profile_statuses().get(active_profile_name, {}).get("configured", False),
        "permission_mode": settings.permission.mode.value,
        "theme": settings.theme,
        "output_style": settings.output_style,
        "fast_mode": settings.fast_mode,
        "effort": settings.effort,
        "passes": settings.passes,
        "vim_mode": settings.vim_mode,
        "voice_mode": settings.voice_mode,
    }


@router.get("/hooks")
async def list_hooks(request: Request) -> list[dict[str, Any]]:
    _require_localhost(request)
    try:
        from openharness.config.settings import load_settings
        from openharness.hooks import load_hook_registry
        from openharness.plugins import load_plugins

        settings = load_settings()
        plugins = load_plugins(settings, str(Path.cwd()))
        registry = load_hook_registry(settings, plugins)
        hooks = []
        for event, hook_list in registry.all_hooks().items():
            for hook in hook_list:
                hooks.append({
                    "event": str(event),
                    "command": hook.command if hasattr(hook, "command") else str(hook),
                    "enabled": True,
                })
        return hooks
    except Exception as exc:
        return [{"error": str(exc)}]
