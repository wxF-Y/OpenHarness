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

import re as _re_profile
_PROFILE_NAME_RE = _re_profile.compile(r'^[\w\-]{1,64}$')

# Profile 默认值
# context_window_tokens: 200k 是 Claude / 多数主流模型的标准窗口；1M 需用户显式开启
DEFAULT_CONTEXT_WINDOW_TOKENS = 200000
# auto_compact: null = 运行时自动按窗口 × 80% 计算 (≈160k for 200k 窗口)，符合 Claude Code 业界共识
DEFAULT_AUTO_COMPACT_THRESHOLD_TOKENS: int | None = None

class CreateProfileRequest(BaseModel):
    name: str
    label: str = Field(min_length=1, max_length=64)
    api_format: str = Field(pattern=r'^(anthropic|anthropic_compat|openai|openai_compat|copilot)$')
    base_url: str | None = None
    default_model: str = Field(min_length=1, max_length=128)
    api_key: str | None = None
    context_window_tokens: int | None = Field(None, ge=1024, le=10_000_000)
    auto_compact_threshold_tokens: int | None = Field(None, ge=1024, le=10_000_000)

class PatchProfileRequest(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=64)
    api_format: str | None = Field(None, pattern=r'^(anthropic|anthropic_compat|openai|openai_compat|copilot)$')
    base_url: str | None = None
    default_model: str | None = Field(None, min_length=1, max_length=128)
    api_key: str | None = None
    context_window_tokens: int | None = Field(None, ge=1024, le=10_000_000)
    auto_compact_threshold_tokens: int | None = Field(None, ge=1024, le=10_000_000)


@router.get("")
async def get_settings() -> dict[str, Any]:
    s = load_settings()
    return {
        "model": s.model,
        "active_profile": s.active_profile,
        "provider": getattr(s, "provider", ""),
        "api_format": getattr(s, "api_format", ""),
        "fast_mode": s.fast_mode,
        "effort": s.effort,
        "passes": s.passes,
        "max_turns": s.max_turns,
        "vim_mode": s.vim_mode,
        "voice_mode": s.voice_mode,
        "output_style": s.output_style,
        "theme": getattr(s, "theme", ""),
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
        for _sid, host in session_mgr.get_all_ready():
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
    from openharness.config.settings import builtin_provider_profile_names
    builtin_names = builtin_provider_profile_names()
    profiles = []
    for name, profile in s.merged_profiles().items():
        profiles.append({
            "name": name,
            "provider": getattr(profile, "provider", ""),
            "model": getattr(profile, "model", "") or getattr(profile, "last_model", "") or getattr(profile, "default_model", ""),
            "api_format": getattr(profile, "api_format", ""),
            "base_url": getattr(profile, "base_url", "") or "",
            "auth_source": getattr(profile, "auth_source", ""),
            "label": getattr(profile, "label", name),
            "allowed_models": getattr(profile, "allowed_models", []),
            "context_window_tokens": getattr(profile, "context_window_tokens", None),
            "auto_compact_threshold_tokens": getattr(profile, "auto_compact_threshold_tokens", None),
            "credential_slot": getattr(profile, "credential_slot", None),
            "is_builtin": name in builtin_names,
        })
    return profiles



@router.post("/profiles", status_code=201)
async def create_profile(req: CreateProfileRequest) -> dict[str, Any]:
    if not _PROFILE_NAME_RE.match(req.name):
        raise HTTPException(400, "profile name must match ^[\\w\\-]{1,64}$")
    from openharness.config.settings import (
        builtin_provider_profile_names, ProviderProfile,
        default_auth_source_for_provider, auth_source_uses_api_key
    )
    from openharness.auth.storage import store_credential
    builtin_names = builtin_provider_profile_names()
    if req.name in builtin_names:
        raise HTTPException(409, f"Cannot create profile with reserved name '{req.name}'")
    if req.api_format in {"anthropic_compat", "openai_compat"} and not req.base_url:
        raise HTTPException(400, "base_url is required for anthropic_compat and openai_compat formats")
    s = load_settings()
    user_profiles = dict(s.profiles)
    if req.api_format in {"anthropic", "anthropic_compat"}:
        provider = "anthropic"
    elif req.api_format == "copilot":
        provider = "copilot"
    else:
        provider = "openai"
    auth_source = default_auth_source_for_provider(provider, req.api_format)
    # credential_slot = profile name，让每个 profile 独立存储自己的 API Key，避免共享全局 api_key 导致 401
    credential_slot = req.name if auth_source_uses_api_key(auth_source) else None
    new_profile = ProviderProfile(
        label=req.label,
        provider=provider,
        api_format=req.api_format,
        auth_source=auth_source,
        default_model=req.default_model,
        base_url=req.base_url or None,
        credential_slot=credential_slot,
        context_window_tokens=req.context_window_tokens if req.context_window_tokens is not None else DEFAULT_CONTEXT_WINDOW_TOKENS,
        auto_compact_threshold_tokens=req.auto_compact_threshold_tokens if req.auto_compact_threshold_tokens is not None else DEFAULT_AUTO_COMPACT_THRESHOLD_TOKENS,
    )
    user_profiles[req.name] = new_profile
    updated = s.model_copy(update={"profiles": user_profiles})
    save_settings(updated)
    # API Key 写入 profile 隔离槽位，而不是污染全局 api_key
    if req.api_key and credential_slot:
        store_credential(f"profile:{credential_slot}", "api_key", req.api_key)
    return {"name": req.name, "created": True}


@router.patch("/profiles/{profile_name}")
async def update_profile(profile_name: str, req: PatchProfileRequest) -> dict[str, Any]:
    if not _PROFILE_NAME_RE.match(profile_name):
        raise HTTPException(400, "profile name must match ^[\\w\\-]{1,64}$")
    from openharness.config.settings import builtin_provider_profile_names, auth_source_uses_api_key
    from openharness.auth.storage import store_credential
    builtin_names = builtin_provider_profile_names()
    s = load_settings()
    profiles = s.merged_profiles()
    if profile_name not in profiles:
        raise HTTPException(404, f"Profile '{profile_name}' not found")
    is_builtin = profile_name in builtin_names
    if is_builtin:
        if any(v is not None for v in [req.label, req.api_format, req.base_url, req.default_model]):
            raise HTTPException(403, "Built-in profiles only allow updating api_key")
        if req.api_key is not None:
            updated = s.model_copy(update={"api_key": req.api_key})
            save_settings(updated)
        return {"name": profile_name, "updated": True}
    existing = profiles[profile_name]
    patch: dict[str, Any] = {}
    if req.label is not None:
        patch["label"] = req.label
    if req.api_format is not None:
        if req.api_format in {"anthropic_compat", "openai_compat"}:
            new_base_url = req.base_url if req.base_url is not None else existing.base_url
            if not new_base_url:
                raise HTTPException(400, "base_url is required for anthropic_compat and openai_compat formats")
        patch["api_format"] = req.api_format
    if req.base_url is not None:
        patch["base_url"] = req.base_url or None
    if req.default_model is not None:
        patch["default_model"] = req.default_model
    if req.context_window_tokens is not None:
        patch["context_window_tokens"] = req.context_window_tokens
    if req.auto_compact_threshold_tokens is not None:
        patch["auto_compact_threshold_tokens"] = req.auto_compact_threshold_tokens
    # 旧 profile 可能没有 credential_slot，update 时回填，便于后续 Key 隔离
    if not existing.credential_slot and auth_source_uses_api_key(existing.auth_source):
        patch["credential_slot"] = profile_name
    updated_profile = existing.model_copy(update=patch)
    user_profiles = dict(s.profiles)
    user_profiles[profile_name] = updated_profile
    updated_settings = s.model_copy(update={"profiles": user_profiles})
    save_settings(updated_settings)
    # API Key 存到隔离槽位（不再污染全局 api_key）
    if req.api_key is not None:
        slot = updated_profile.credential_slot or profile_name
        store_credential(f"profile:{slot}", "api_key", req.api_key)
    # 对所有正在使用此 profile 的活跃 session 立即应用变更（重建 API client + 推 state_snapshot）
    refreshed_sessions: list[str] = []
    hot_apply_warning: str | None = None
    try:
        from services.session_manager import session_mgr
        from openharness.ui.runtime import refresh_runtime_client
        from openharness.ui.protocol import BackendEvent
        for sid in session_mgr.list_ids():
            entry = session_mgr.get_entry(sid)
            if entry is None or not entry.host.is_ready or entry.host._bundle is None:
                continue
            # 判断 session 当前是否使用此 profile
            session_active_profile = entry.active_profile or updated_settings.active_profile
            if session_active_profile != profile_name:
                continue
            try:
                refresh_runtime_client(entry.host._bundle)
            except (SystemExit, ValueError):
                pass  # 缺 Key 等错误下次发消息时由 engine 报
            try:
                snapshot = BackendEvent.state_snapshot(entry.host._bundle.app_state.get())
                await entry.host._event_queue.put(snapshot)
            except Exception:
                pass
            refreshed_sessions.append(sid)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Profile hot-apply failed: %s", exc)
        # 把错误反馈给前端，避免静默失败让用户误以为切换已生效
        hot_apply_warning = f"配置已保存，但热更新到活跃会话失败：{exc}"
    result: dict[str, Any] = {"name": profile_name, "updated": True, "refreshed_sessions": refreshed_sessions}
    if hot_apply_warning:
        result["hot_apply_warning"] = hot_apply_warning
    return result


@router.delete("/profiles/{profile_name}", status_code=204)
async def delete_profile(profile_name: str) -> None:
    if not _PROFILE_NAME_RE.match(profile_name):
        raise HTTPException(400, "profile name must match ^[\\w\\-]{1,64}$")
    from openharness.config.paths import get_config_file_path
    from openharness.utils.fs import atomic_write_text
    from openharness.utils.file_lock import exclusive_file_lock
    import json

    config_path = get_config_file_path()
    if not config_path.exists():
        raise HTTPException(404, "Settings file not found")
    # 读 + 改 + 写在同一文件锁内，避免 TOCTOU 丢失并发写入
    lock_path = config_path.with_suffix(config_path.suffix + ".lock")
    with exclusive_file_lock(lock_path):
        raw = json.loads(config_path.read_text(encoding="utf-8"))
        profiles = raw.get("profiles", {})
        if profile_name not in profiles:
            raise HTTPException(404, f"Profile '{profile_name}' not found")
        del profiles[profile_name]
        raw["profiles"] = profiles
        # 清空平铺字段，防止下次 load_settings 推断出同名 profile
        raw["model"] = ""
        raw["base_url"] = None
        raw["provider"] = ""
        raw["api_format"] = "anthropic"
        # 若 active_profile 指向被删除的，重置为第一个剩余的或空串
        if raw.get("active_profile") == profile_name:
            remaining = list(profiles.keys())
            raw["active_profile"] = remaining[0] if remaining else ""
        atomic_write_text(config_path, json.dumps(raw, indent=2, ensure_ascii=False) + "\n")
