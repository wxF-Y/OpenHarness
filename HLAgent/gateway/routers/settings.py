"""Settings management REST router."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from openharness.config.settings import load_settings, save_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])

_TOOL_NAME_RE = re.compile(r'^[\w\-\.]{1,128}$')
_COMMAND_PATTERN_RE = re.compile(r'^[\w\-\.\*\?\[\]\{\} /\\]{1,256}$')


@router.get("")
async def get_settings() -> dict[str, Any]:
    s = load_settings()
    return {
        "model": s.model,
        "provider": getattr(s, "provider", ""),
        "api_format": getattr(s, "api_format", ""),
        "fast_mode": s.fast_mode,
        "effort": s.effort,
        "passes": s.passes,
        "max_turns": s.max_turns,
        "vim_mode": s.vim_mode,
        "voice_mode": s.voice_mode,
        "output_style": s.output_style,
        "theme": s.theme,
        "base_url": s.base_url or "",
        "permission_mode": s.permission.mode.value,
        "allowed_tools": s.permission.allowed_tools,
        "denied_tools": s.permission.denied_tools,
        "path_rules": [{"pattern": r.pattern, "allow": r.allow} for r in s.permission.path_rules],
        "denied_commands": s.permission.denied_commands,
    }


class PathRuleRequest(BaseModel):
    pattern: str = Field(min_length=1, max_length=512)
    allow: bool = True

    @model_validator(mode="after")
    def _no_traversal(self) -> "PathRuleRequest":
        parts = self.pattern.replace("\\", "/").split("/")
        if ".." in parts:
            raise ValueError("path_rules pattern must not contain '..' segments")
        return self


class PatchSettingsRequest(BaseModel):
    fast_mode: bool | None = None
    effort: str | None = None
    passes: int | None = None
    max_turns: int | None = None
    vim_mode: bool | None = None
    voice_mode: bool | None = None
    output_style: str | None = None
    theme: str | None = None
    model: str | None = None
    base_url: str | None = None
    api_format: str | None = None
    permission_mode: str | None = None  # "default" | "plan" | "full_auto"
    allowed_tools: list[str] | None = None
    denied_tools: list[str] | None = None
    path_rules: list[PathRuleRequest] | None = None
    denied_commands: list[str] | None = None
    cwd: str | None = None


@router.patch("")
async def patch_settings(req: PatchSettingsRequest) -> dict[str, Any]:
    s = load_settings()
    updates: dict[str, Any] = {}
    for field in ("fast_mode", "effort", "passes", "max_turns", "vim_mode",
                  "voice_mode", "output_style", "theme", "model", "base_url", "api_format"):
        val = getattr(req, field, None)
        if val is not None:
            updates[field] = val

    # permission_mode 映射到嵌套对象 settings.permission.mode
    if req.permission_mode is not None:
        from openharness.permissions.modes import PermissionMode
        try:
            mode = PermissionMode(req.permission_mode)
        except ValueError:
            valid = [m.value for m in PermissionMode]
            raise HTTPException(400, f"permission_mode must be one of {valid}")
        updated_perm = s.permission.model_copy(update={"mode": mode})
        updates["permission"] = updated_perm

    # 权限规则字段更新（含基本输入校验）
    perm_rule_updates: dict[str, Any] = {}
    if req.allowed_tools is not None:
        for t in req.allowed_tools:
            if not _TOOL_NAME_RE.match(t):
                raise HTTPException(400, f"Invalid tool name: {t!r}")
        perm_rule_updates["allowed_tools"] = list(dict.fromkeys(req.allowed_tools))
    if req.denied_tools is not None:
        for t in req.denied_tools:
            if not _TOOL_NAME_RE.match(t):
                raise HTTPException(400, f"Invalid tool name: {t!r}")
        perm_rule_updates["denied_tools"] = list(dict.fromkeys(req.denied_tools))
    if req.denied_commands is not None:
        for c in req.denied_commands:
            if not _COMMAND_PATTERN_RE.match(c):
                raise HTTPException(400, f"Invalid command pattern: {c!r}")
        perm_rule_updates["denied_commands"] = list(dict.fromkeys(req.denied_commands))
    if req.path_rules is not None:
        from openharness.config.settings import PathRuleConfig
        perm_rule_updates["path_rules"] = [
            PathRuleConfig(pattern=r.pattern, allow=r.allow) for r in req.path_rules
        ]
    if perm_rule_updates:
        base_perm = updates.get("permission", s.permission)
        updates["permission"] = base_perm.model_copy(update=perm_rule_updates)

    if updates:
        updated = s.model_copy(update=updates)
        save_settings(updated)

    if req.cwd is not None:
        cwd_path = Path(req.cwd).resolve()
        if not cwd_path.is_dir():
            raise HTTPException(400, "cwd must be an existing absolute directory path")
        try:
            os.chdir(cwd_path)
        except Exception as e:
            raise HTTPException(400, f"Cannot change directory: {e}")

    # 推送给所有活跃会话以同步 StatusBar 即时更新
    if req.permission_mode is not None:
        from services.session_manager import session_mgr
        from openharness.ui.protocol import FrontendRequest
        for host in session_mgr.get_all_ready():
            try:
                await host.push_request(
                    FrontendRequest(type="submit_line", line=f"/permissions {req.permission_mode}")
                )
            except Exception:
                pass

    result: dict[str, Any] = {"status": "updated"}
    if updates:
        result["updated"] = [k for k in updates if k != "permission"]
    if req.permission_mode:
        result["permission_mode"] = req.permission_mode
    return result


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
