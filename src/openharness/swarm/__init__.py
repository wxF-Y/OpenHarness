"""Swarm backend abstraction for teammate execution."""

from __future__ import annotations

from importlib import import_module

from openharness.swarm.registry import BackendRegistry, get_backend_registry
from openharness.swarm.subprocess_backend import SubprocessBackend
from openharness.swarm.types import (
    BackendType,
    SpawnResult,
    TeammateExecutor,
    TeammateIdentity,
    TeammateMessage,
    TeammateSpawnConfig,
)

_LAZY_EXPORTS = {
    # mailbox
    "MailboxMessage": ("openharness.swarm.mailbox", "MailboxMessage"),
    "TeammateMailbox": ("openharness.swarm.mailbox", "TeammateMailbox"),
    "create_idle_notification": ("openharness.swarm.mailbox", "create_idle_notification"),
    "create_shutdown_request": ("openharness.swarm.mailbox", "create_shutdown_request"),
    "create_user_message": ("openharness.swarm.mailbox", "create_user_message"),
    "get_agent_mailbox_dir": ("openharness.swarm.mailbox", "get_agent_mailbox_dir"),
    "get_team_dir": ("openharness.swarm.mailbox", "get_team_dir"),
    # permission_sync
    "SwarmPermissionRequest": ("openharness.swarm.permission_sync", "SwarmPermissionRequest"),
    "SwarmPermissionResponse": ("openharness.swarm.permission_sync", "SwarmPermissionResponse"),
    "create_permission_request": ("openharness.swarm.permission_sync", "create_permission_request"),
    "handle_permission_request": ("openharness.swarm.permission_sync", "handle_permission_request"),
    "poll_permission_response": ("openharness.swarm.permission_sync", "poll_permission_response"),
    "send_permission_request": ("openharness.swarm.permission_sync", "send_permission_request"),
    "send_permission_response": ("openharness.swarm.permission_sync", "send_permission_response"),
    # models
    "AllowedPath": ("openharness.swarm.models", "AllowedPath"),
    "TeamFile": ("openharness.swarm.models", "TeamFile"),
    "TeamMember": ("openharness.swarm.models", "TeamMember"),
    "TeamRunState": ("openharness.swarm.models", "TeamRunState"),
    "sanitize_agent_name": ("openharness.swarm.models", "sanitize_agent_name"),
    "sanitize_name": ("openharness.swarm.models", "sanitize_name"),
    # persistence
    "get_team_file_path": ("openharness.swarm.persistence", "get_team_file_path"),
    "read_team_file": ("openharness.swarm.persistence", "read_team_file"),
    "read_team_file_async": ("openharness.swarm.persistence", "read_team_file_async"),
    "write_team_file": ("openharness.swarm.persistence", "write_team_file"),
    "write_team_file_async": ("openharness.swarm.persistence", "write_team_file_async"),
}

__all__ = [
    "AllowedPath",
    "BackendRegistry",
    "BackendType",
    "MailboxMessage",
    "SpawnResult",
    "SubprocessBackend",
    "SwarmPermissionRequest",
    "SwarmPermissionResponse",
    "TeamFile",
    "TeamMember",
    "TeamRunState",
    "TeammateExecutor",
    "TeammateIdentity",
    "TeammateMailbox",
    "TeammateMessage",
    "TeammateSpawnConfig",
    "create_idle_notification",
    "create_permission_request",
    "create_shutdown_request",
    "create_user_message",
    "get_agent_mailbox_dir",
    "get_backend_registry",
    "get_team_dir",
    "get_team_file_path",
    "handle_permission_request",
    "poll_permission_response",
    "read_team_file",
    "read_team_file_async",
    "sanitize_agent_name",
    "sanitize_name",
    "send_permission_request",
    "send_permission_response",
    "write_team_file",
    "write_team_file_async",
]


def __getattr__(name: str):
    """Lazily load swarm helpers when they are actually used."""
    target = _LAZY_EXPORTS.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module_name, attr_name = target
    value = getattr(import_module(module_name), attr_name)
    globals()[name] = value
    return value
