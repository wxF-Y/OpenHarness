"""Tests for session persistence."""

from __future__ import annotations

import json
from pathlib import Path

from openharness.api.usage import UsageSnapshot
from openharness.engine.messages import ConversationMessage, TextBlock
from openharness.services.session_storage import (
    export_session_markdown,
    get_project_session_dir,
    load_session_snapshot,
    save_session_snapshot,
)


def test_save_and_load_session_snapshot(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPENHARNESS_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "repo"
    project.mkdir()

    path = save_session_snapshot(
        cwd=project,
        model="claude-test",
        system_prompt="system",
        messages=[ConversationMessage(role="user", content=[TextBlock(text="hello")])],
        usage=UsageSnapshot(input_tokens=1, output_tokens=2),
        tool_metadata={
            "task_focus_state": {"goal": "Fix compact carry-over"},
            "recent_verified_work": ["Focused session storage test passed"],
        },
    )

    assert path.exists()
    snapshot = load_session_snapshot(project)
    assert snapshot is not None
    assert snapshot["model"] == "claude-test"
    assert snapshot["usage"]["output_tokens"] == 2
    assert snapshot["tool_metadata"]["task_focus_state"]["goal"] == "Fix compact carry-over"
    assert snapshot["tool_metadata"]["recent_verified_work"] == ["Focused session storage test passed"]


def test_export_session_markdown(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPENHARNESS_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "repo"
    project.mkdir()

    path = export_session_markdown(
        cwd=project,
        messages=[
            ConversationMessage(role="user", content=[TextBlock(text="hello")]),
            ConversationMessage(role="assistant", content=[TextBlock(text="world")]),
        ],
    )

    assert path.exists()
    content = path.read_text(encoding="utf-8")
    assert "OpenHarness Session Transcript" in content
    assert "hello" in content
    assert "world" in content


def test_load_session_snapshot_sanitizes_legacy_empty_assistant_messages(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPENHARNESS_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "repo"
    project.mkdir()

    target_dir = get_project_session_dir(project)
    payload = {
        "session_id": "legacy123",
        "cwd": str(project),
        "model": "claude-test",
        "system_prompt": "system",
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": "hello"}]},
            {"role": "assistant", "content": None},
            {"role": "assistant", "content": []},
            {"role": "assistant", "content": [{"type": "text", "text": "world"}]},
        ],
        "usage": {"input_tokens": 1, "output_tokens": 1},
        "tool_metadata": {},
        "created_at": 1.0,
        "summary": "hello",
        "message_count": 4,
    }
    (target_dir / "latest.json").write_text(json.dumps(payload), encoding="utf-8")

    snapshot = load_session_snapshot(project)
    assert snapshot is not None
    assert snapshot["message_count"] == 2
    assert [message["role"] for message in snapshot["messages"]] == ["user", "assistant"]
    assert snapshot["messages"][1]["content"][0]["text"] == "world"


def test_find_session_by_id_found(tmp_path, monkeypatch):
    from openharness.services import session_storage
    monkeypatch.setattr(session_storage, "get_sessions_dir", lambda: tmp_path)

    proj_dir = tmp_path / "myproject-abc123"
    proj_dir.mkdir()
    sid = "abc123def456"
    (proj_dir / f"session-{sid}.json").write_text(
        '{"session_id": "abc123def456", "cwd": "/tmp/proj", "model": "claude", '
        '"messages": [], "summary": "hello", "message_count": 0, "created_at": 1000.0}',
        encoding="utf-8",
    )

    result = session_storage.find_session_by_id(sid)
    assert result is not None
    assert result["session_id"] == sid
    assert result["cwd"] == "/tmp/proj"


def test_find_session_by_id_not_found(tmp_path, monkeypatch):
    from openharness.services import session_storage
    monkeypatch.setattr(session_storage, "get_sessions_dir", lambda: tmp_path)
    (tmp_path / "proj-abc").mkdir()
    assert session_storage.find_session_by_id("nonexistent") is None


def test_find_session_by_id_corrupt_file(tmp_path, monkeypatch):
    from openharness.services import session_storage
    monkeypatch.setattr(session_storage, "get_sessions_dir", lambda: tmp_path)
    proj_dir = tmp_path / "proj-abc"
    proj_dir.mkdir()
    sid = "abc123def456"
    (proj_dir / f"session-{sid}.json").write_text("not-json", encoding="utf-8")
    # 损坏文件应跳过并继续，最终返回 None（无其他目录有该文件）
    assert session_storage.find_session_by_id(sid) is None


def test_list_all_sessions(tmp_path, monkeypatch):
    from openharness.services import session_storage
    monkeypatch.setattr(session_storage, "get_sessions_dir", lambda: tmp_path)

    for i, (proj, sid, ts) in enumerate([
        ("proj1-aaa", "aaa000000001", 2000.0),
        ("proj2-bbb", "bbb000000002", 1000.0),
    ]):
        d = tmp_path / proj
        d.mkdir()
        (d / f"session-{sid}.json").write_text(
            f'{{"session_id": "{sid}", "cwd": "/tmp/p{i}", "model": "claude", '
            f'"messages": [], "summary": "test", "message_count": 0, "created_at": {ts}}}',
            encoding="utf-8",
        )

    results = session_storage.list_all_sessions()
    assert len(results) == 2
    assert results[0]["session_id"] == "aaa000000001"
    assert results[1]["session_id"] == "bbb000000002"


def test_list_all_sessions_skips_corrupt(tmp_path, monkeypatch):
    from openharness.services import session_storage
    monkeypatch.setattr(session_storage, "get_sessions_dir", lambda: tmp_path)

    good_dir = tmp_path / "proj-good"
    good_dir.mkdir()
    (good_dir / "session-aaa000000001.json").write_text(
        '{"session_id": "aaa000000001", "cwd": "/tmp/good", "model": "claude", '
        '"messages": [], "summary": "ok", "message_count": 0, "created_at": 1000.0}',
        encoding="utf-8",
    )

    bad_dir = tmp_path / "proj-bad"
    bad_dir.mkdir()
    (bad_dir / "session-bbb000000002.json").write_text("not-json", encoding="utf-8")

    results = session_storage.list_all_sessions()
    assert len(results) == 1
    assert results[0]["session_id"] == "aaa000000001"


def test_list_all_sessions_filters_member_sessions(tmp_path, monkeypatch):
    from openharness.services import session_storage
    from openharness.config import paths as config_paths

    monkeypatch.setattr(session_storage, "get_sessions_dir", lambda: tmp_path)

    member_uuid = "abcdef1234567890abcdef1234567890"

    # 模拟 get_config_dir 返回 tmp_path（teams-tasks 在其下）
    monkeypatch.setattr(config_paths, "get_config_dir", lambda: tmp_path)

    # 创建 teams-tasks/team1/run1/team.json
    run_dir = tmp_path / "teams-tasks" / "team1" / "run1"
    run_dir.mkdir(parents=True)
    (run_dir / "team.json").write_text(
        '{"lead_session_id": "aaa000000001", "members": {"agent@team": {"session_id": "' + member_uuid + '"}}}',
        encoding="utf-8",
    )

    # leader session 目录（普通名称）
    leader_dir = tmp_path / "myproject-aaa111"
    leader_dir.mkdir()
    (leader_dir / "session-aaa000000001.json").write_text(
        '{"session_id": "aaa000000001", "cwd": "/tmp/proj", "model": "claude", '
        '"messages": [], "summary": "leader", "message_count": 0, "created_at": 2000.0}',
        encoding="utf-8",
    )

    # member session 目录（以 member UUID 开头）
    member_dir = tmp_path / f"{member_uuid}-bbb222333444"
    member_dir.mkdir()
    (member_dir / "session-bbb000000002.json").write_text(
        '{"session_id": "bbb000000002", "cwd": "/tmp/workspace", "model": "claude", '
        '"messages": [], "summary": "member", "message_count": 0, "created_at": 1000.0}',
        encoding="utf-8",
    )

    results = session_storage.list_all_sessions()
    sids = [r["session_id"] for r in results]
    assert "aaa000000001" in sids, "leader session 应该在列表中"
    assert "bbb000000002" not in sids, "member session 不应该在列表中"
