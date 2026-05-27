"""Tests for role-scoped tool registry."""

from __future__ import annotations

import pytest

from openharness.tools import (
    LEADER_EXCLUSIVE_TOOLS,
    create_default_tool_registry,
    create_member_tool_registry,
)


def test_leader_exclusive_tools_is_frozenset():
    assert isinstance(LEADER_EXCLUSIVE_TOOLS, frozenset)


def test_leader_exclusive_tools_nonempty():
    assert len(LEADER_EXCLUSIVE_TOOLS) >= 12


def test_leader_exclusive_tools_contains_required_names():
    required = {
        "team_create_run", "team_spawn_member", "team_list_members",
        "team_wait", "team_read_mailbox", "team_send_message",
        "team_shutdown_member", "team_request_plan", "team_review_plan",
        "team_request_shutdown", "team_create", "team_delete",
    }
    assert required <= LEADER_EXCLUSIVE_TOOLS


def test_create_member_tool_registry_excludes_leader_tools():
    registry = create_member_tool_registry()
    names = {t.name for t in registry.list_tools()}
    overlap = names & LEADER_EXCLUSIVE_TOOLS
    assert overlap == set(), f"member registry contains leader tools: {overlap}"


def test_create_member_tool_registry_retains_base_tools():
    registry = create_member_tool_registry()
    names = {t.name for t in registry.list_tools()}
    base_tools = {"bash", "read_file", "edit_file", "write_file",
                  "glob", "grep", "web_fetch", "web_search", "skill", "todo_write"}
    missing = base_tools - names
    assert missing == set(), f"base tools missing from member registry: {missing}"


def test_member_registry_is_strict_subset_of_default():
    default_names = {t.name for t in create_default_tool_registry().list_tools()}
    member_names = {t.name for t in create_member_tool_registry().list_tools()}
    assert member_names < default_names, "member registry must be strict subset of default"
    assert default_names - member_names == LEADER_EXCLUSIVE_TOOLS, (
        f"difference should equal LEADER_EXCLUSIVE_TOOLS exactly, got: "
        f"{default_names - member_names}"
    )


def test_create_member_tool_registry_accepts_mcp_manager_none():
    """Signature compatible with create_default_tool_registry."""
    registry = create_member_tool_registry(mcp_manager=None)
    assert registry is not None
