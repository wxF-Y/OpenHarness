"""Skills and plugins REST router."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["skills"])


@router.get("/api/skills")
async def list_skills() -> list[dict[str, Any]]:
    from openharness.skills.registry import load_skill_registry
    registry = load_skill_registry()
    return [
        {
            "name": s.name,
            "description": getattr(s, "description", ""),
            "tags": getattr(s, "tags", []),
            "user_invocable": getattr(s, "user_invocable", False),
        }
        for s in registry.list_skills()
    ]


@router.get("/api/skills/{name}")
async def get_skill(name: str) -> dict[str, Any]:
    from openharness.skills.registry import load_skill_registry
    registry = load_skill_registry()
    for s in registry.list_skills():
        if s.name == name:
            content = ""
            if hasattr(s, "content"):
                content = s.content
            elif hasattr(s, "path") and s.path:
                try:
                    from pathlib import Path
                    content = Path(s.path).read_text(encoding="utf-8")
                except Exception:
                    pass
            return {"name": s.name, "content": content}
    raise HTTPException(404, f"Skill {name!r} not found")


@router.get("/api/plugins")
async def list_plugins() -> list[dict[str, Any]]:
    from openharness.plugins import load_plugins
    from openharness.config.settings import load_settings
    from pathlib import Path

    settings = load_settings()
    plugins = load_plugins(settings, str(Path.cwd()))
    return [
        {
            "name": p.name,
            "enabled": p.enabled,
            "description": getattr(p, "description", ""),
            "commands_count": len(getattr(p, "commands", [])),
            "tools_count": len(getattr(p, "tools", [])),
        }
        for p in plugins
    ]


@router.get("/api/mcp/servers")
async def list_mcp_servers() -> list[dict[str, Any]]:
    from openharness.mcp.client import McpClientManager
    from openharness.mcp.config import load_mcp_server_configs
    from openharness.plugins import load_plugins
    from openharness.config.settings import load_settings
    from pathlib import Path

    settings = load_settings()
    plugins = load_plugins(settings, str(Path.cwd()))
    configs = load_mcp_server_configs(settings, plugins)
    manager = McpClientManager(configs)
    statuses = manager.list_statuses()
    return [
        {
            "name": s.name,
            "state": s.state,
            "transport": s.transport,
            "auth_configured": s.auth_configured,
            "tool_count": len(s.tools),
            "resource_count": len(s.resources),
            "detail": s.detail,
        }
        for s in statuses
    ]
