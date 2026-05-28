"""Session persistence helpers."""

from __future__ import annotations

import json
import logging
import re
import time
from hashlib import sha1
from pathlib import Path
from typing import Any
from uuid import uuid4

log = logging.getLogger(__name__)

from openharness.api.usage import UsageSnapshot
from openharness.config.paths import get_config_dir, get_sessions_dir
from openharness.engine.messages import ConversationMessage, sanitize_conversation_messages
from openharness.utils.fs import atomic_write_text


_PERSISTED_TOOL_METADATA_KEYS = (
    "permission_mode",
    "read_file_state",
    "invoked_skills",
    "async_agent_state",
    "async_agent_tasks",
    "recent_work_log",
    "recent_verified_work",
    "task_focus_state",
    "compact_checkpoints",
    "compact_last",
    "swarm_member_session_ids",
)


def _sanitize_metadata(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _sanitize_metadata(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_sanitize_metadata(item) for item in value]
    return str(value)


def _persistable_tool_metadata(tool_metadata: dict[str, object] | None) -> dict[str, Any]:
    if not isinstance(tool_metadata, dict):
        return {}
    payload: dict[str, Any] = {}
    for key in _PERSISTED_TOOL_METADATA_KEYS:
        if key in tool_metadata:
            payload[key] = _sanitize_metadata(tool_metadata[key])
    return payload


def get_project_session_dir(cwd: str | Path) -> Path:
    """Return the session directory for a project."""
    path = Path(cwd).resolve()
    digest = sha1(str(path).encode("utf-8")).hexdigest()[:12]
    session_dir = get_sessions_dir() / f"{path.name}-{digest}"
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


def save_session_snapshot(
    *,
    cwd: str | Path,
    model: str,
    system_prompt: str,
    messages: list[ConversationMessage],
    usage: UsageSnapshot,
    session_id: str | None = None,
    tool_metadata: dict[str, object] | None = None,
    permission_mode: str | None = None,
    api_format: str | None = None,
    active_profile: str | None = None,
    expert_role: str | None = None,
    expert_role_label: str | None = None,
) -> Path:
    """Persist a session snapshot. Saves both by ID and as latest."""
    session_dir = get_project_session_dir(cwd)
    sid = session_id or uuid4().hex[:12]
    now = time.time()
    messages = sanitize_conversation_messages(messages)
    # Extract a summary from the first user message
    summary = ""
    for msg in messages:
        if msg.role == "user" and msg.text.strip():
            summary = msg.text.strip()[:80]
            break

    payload = {
        "session_id": sid,
        "cwd": str(Path(cwd).resolve()),
        "model": model,
        "system_prompt": system_prompt,
        "messages": [message.model_dump(mode="json") for message in messages],
        "usage": usage.model_dump(),
        "tool_metadata": _persistable_tool_metadata(tool_metadata),
        "created_at": now,
        "summary": summary,
        "message_count": len(messages),
        "permission_mode": permission_mode,
        "api_format": api_format,
        "active_profile": active_profile,
        "expert_role": expert_role,
        "expert_role_label": expert_role_label,
    }
    # Serialize — clean any surrogate characters that break utf-8 encoding
    try:
        data = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    except (UnicodeEncodeError, ValueError):
        # Fallback: re-encode to drop surrogates then decode back to clean str
        raw = json.dumps(payload, indent=2, ensure_ascii=True) + "\n"
        data = raw.encode("utf-8", errors="replace").decode("utf-8")

    # Save as latest
    latest_path = session_dir / "latest.json"
    atomic_write_text(latest_path, data)

    # Save by session ID
    session_path = session_dir / f"session-{sid}.json"
    atomic_write_text(session_path, data)

    return latest_path


def _sanitize_snapshot_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize persisted messages for forward compatibility."""
    raw_messages = payload.get("messages", [])
    if isinstance(raw_messages, list):
        messages = sanitize_conversation_messages(
            [ConversationMessage.model_validate(item) for item in raw_messages]
        )
        payload = dict(payload)
        payload["messages"] = [message.model_dump(mode="json") for message in messages]
        payload["message_count"] = len(messages)
    return payload


def load_session_snapshot(cwd: str | Path) -> dict[str, Any] | None:
    """Load the most recent session snapshot for the project."""
    path = get_project_session_dir(cwd) / "latest.json"
    if not path.exists():
        return None
    return _sanitize_snapshot_payload(json.loads(path.read_text(encoding="utf-8")))


def list_session_snapshots(cwd: str | Path, limit: int = 20) -> list[dict[str, Any]]:
    """List saved sessions for the project, newest first."""
    session_dir = get_project_session_dir(cwd)
    sessions: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    # Named session files
    for path in sorted(session_dir.glob("session-*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            sid = data.get("session_id", path.stem.replace("session-", ""))
            seen_ids.add(sid)
            summary = data.get("summary", "")
            if not summary:
                # Extract from first user message
                for msg in data.get("messages", []):
                    if msg.get("role") == "user":
                        texts = [b.get("text", "") for b in msg.get("content", []) if b.get("type") == "text"]
                        summary = " ".join(texts).strip()[:80]
                        if summary:
                            break
            sessions.append({
                "session_id": sid,
                "summary": summary,
                "message_count": data.get("message_count", len(data.get("messages", []))),
                "model": data.get("model", ""),
                "created_at": data.get("created_at", path.stat().st_mtime),
            })
        except (json.JSONDecodeError, OSError):
            continue
        if len(sessions) >= limit:
            break

    # Also include latest.json if it has no corresponding session file
    latest_path = session_dir / "latest.json"
    if latest_path.exists() and len(sessions) < limit:
        try:
            data = json.loads(latest_path.read_text(encoding="utf-8"))
            sid = data.get("session_id", "latest")
            if sid not in seen_ids:
                summary = data.get("summary", "")
                if not summary:
                    for msg in data.get("messages", []):
                        if msg.get("role") == "user":
                            texts = [b.get("text", "") for b in msg.get("content", []) if b.get("type") == "text"]
                            summary = " ".join(texts).strip()[:80]
                            if summary:
                                break
                sessions.append({
                    "session_id": sid,
                    "summary": summary or "(latest session)",
                    "message_count": data.get("message_count", len(data.get("messages", []))),
                    "model": data.get("model", ""),
                    "created_at": data.get("created_at", latest_path.stat().st_mtime),
                })
        except (json.JSONDecodeError, OSError):
            pass

    # Sort by created_at descending
    sessions.sort(key=lambda s: s.get("created_at", 0), reverse=True)
    return sessions[:limit]


def load_session_by_id(cwd: str | Path, session_id: str) -> dict[str, Any] | None:
    """Load a specific session by ID."""
    session_dir = get_project_session_dir(cwd)
    # Try named session first
    path = session_dir / f"session-{session_id}.json"
    if path.exists():
        return _sanitize_snapshot_payload(json.loads(path.read_text(encoding="utf-8")))
    # Fallback to latest.json if session_id matches
    latest = session_dir / "latest.json"
    if latest.exists():
        data = _sanitize_snapshot_payload(json.loads(latest.read_text(encoding="utf-8")))
        if data.get("session_id") == session_id or session_id == "latest":
            return data
    return None


def find_session_by_id(session_id: str) -> dict[str, Any] | None:
    """全局扫描所有项目目录，按 session_id 查找 snapshot 文件。"""
    sessions_dir = get_sessions_dir()
    if not sessions_dir.exists():
        return None
    for project_dir in sessions_dir.iterdir():
        if not project_dir.is_dir():
            continue
        path = project_dir / f"session-{session_id}.json"
        if path.exists():
            try:
                return _sanitize_snapshot_payload(json.loads(path.read_text(encoding="utf-8")))
            except Exception:
                log.warning("Failed to load session file %s", path)
                continue
    return None


def _get_member_session_ids() -> set[str]:
    """从所有 session 的 tool_metadata.swarm_member_session_ids 中收集 member session UUID。

    member session 与 leader session 可能在同一目录，因此过滤在文件级别进行，
    对比 session-*.json 的 session_id 字段与此集合。
    """
    member_ids: set[str] = set()
    sessions_dir = get_sessions_dir()
    if not sessions_dir.exists():
        return member_ids
    for project_dir in sessions_dir.iterdir():
        if not project_dir.is_dir():
            continue
        # 读每个目录的 session-*.json（leader session 含 swarm_member_session_ids）
        for path in project_dir.glob("session-*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                ids = data.get("tool_metadata", {}).get("swarm_member_session_ids") or []
                for mid in ids:
                    if mid:
                        member_ids.add(str(mid))
            except (json.JSONDecodeError, OSError, UnicodeDecodeError):
                pass
    return member_ids


def list_all_sessions() -> list[dict[str, Any]]:
    """扫描所有项目目录下的 session-*.json，返回轻量摘要列表，按 created_at 倒序。

    同一 workspace 下可能有多个独立 session（不同对话），全部返回；
    Swarm member session 的 session_id 与 leader 的 swarm_member_session_ids 匹配时过滤。
    """
    sessions_dir = get_sessions_dir()
    results: list[dict[str, Any]] = []
    if not sessions_dir.exists():
        return results
    member_session_ids = _get_member_session_ids()
    for project_dir in sessions_dir.iterdir():
        if not project_dir.is_dir():
            continue
        for path in project_dir.glob("session-*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                sid = data.get("session_id", "")
                if sid and sid in member_session_ids:
                    continue  # 跳过 member session
                results.append({
                    "session_id": sid,
                    "cwd": data.get("cwd", ""),
                    "model": data.get("model", ""),
                    "summary": data.get("summary", ""),
                    "message_count": data.get("message_count", 0),
                    "created_at": data.get("created_at", path.stat().st_mtime),
                    "permission_mode": data.get("permission_mode"),
                    "api_format": data.get("api_format"),
                    "active_profile": data.get("active_profile"),
                    "expert_role": data.get("expert_role"),
                    "expert_role_label": data.get("expert_role_label"),
                })
            except (json.JSONDecodeError, OSError, UnicodeDecodeError):
                log.warning("Skipping unreadable session file %s", path)
                continue
    results.sort(key=lambda x: x["created_at"], reverse=True)
    return results


_SESSION_ID_RE = re.compile(r"^[0-9a-f]{12}$")


def delete_session_snapshot(cwd: str | Path | None, session_id: str | None) -> None:
    """Delete a persisted session snapshot and, if it is the latest, also remove latest.json."""
    if not cwd or not session_id:
        return
    if not _SESSION_ID_RE.fullmatch(session_id):
        return
    path = Path(cwd).resolve()
    digest = sha1(str(path).encode("utf-8")).hexdigest()[:12]
    session_dir = get_sessions_dir() / f"{path.name}-{digest}"
    if not session_dir.exists():
        return
    snapshot_path = session_dir / f"session-{session_id}.json"
    try:
        snapshot_path.unlink(missing_ok=True)
    except OSError:
        pass
    latest_path = session_dir / "latest.json"
    try:
        if latest_path.exists():
            data = json.loads(latest_path.read_text(encoding="utf-8"))
            if data.get("session_id") == session_id:
                latest_path.unlink(missing_ok=True)
    except (OSError, json.JSONDecodeError):
        pass
    try:
        if not any(session_dir.iterdir()):
            session_dir.rmdir()
    except OSError:
        pass


def export_session_markdown(
    *,
    cwd: str | Path,
    messages: list[ConversationMessage],
) -> Path:
    """Export the session transcript as Markdown."""
    session_dir = get_project_session_dir(cwd)
    path = session_dir / "transcript.md"
    parts: list[str] = ["# OpenHarness Session Transcript"]
    for message in messages:
        parts.append(f"\n## {message.role.capitalize()}\n")
        text = message.text.strip()
        if text:
            parts.append(text)
        for block in message.tool_uses:
            parts.append(f"\n```tool\n{block.name} {json.dumps(block.input, ensure_ascii=False)}\n```")
        for block in message.content:
            if getattr(block, "type", "") == "tool_result":
                parts.append(f"\n```tool-result\n{block.content}\n```")
    atomic_write_text(path, "\n".join(parts).strip() + "\n")
    return path
