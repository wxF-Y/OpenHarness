"""Verification script for hlagent_sdk — task 2.4.

Checks:
1. WebBackendHost, AgentSessionConfig, create_host importable
2. All required methods/properties exist on WebBackendHost
3. openharness.ui.backend_host (ReactBackendHost) is the correct local package
"""
from hlagent_sdk import AgentSessionConfig, WebBackendHost, create_host
from openharness.ui.backend_host import BackendHostConfig, ReactBackendHost

print("✓ Imports OK")

# Verify inheritance
assert issubclass(WebBackendHost, ReactBackendHost), "WebBackendHost must subclass ReactBackendHost"
print("✓ Inheritance OK")

# Verify required interface exists
required_methods = ["push_request", "next_event", "start", "stop",
                    "get_system_prompt", "get_messages", "pop_last_turn",
                    "get_session_id", "get_session_backend"]
required_props = ["is_ready", "app_state", "commands"]

for m in required_methods:
    assert hasattr(WebBackendHost, m), f"Missing method: {m}"
for p in required_props:
    assert hasattr(WebBackendHost, p), f"Missing property: {p}"
print("✓ All interface methods/properties exist")

# Verify create_host factory
config = AgentSessionConfig(model="claude-sonnet-4-6", cwd=".")
host = create_host(config)
assert isinstance(host, WebBackendHost)
assert not host.is_ready  # not started yet
assert host.app_state is None
assert host.commands == []
assert host.get_system_prompt() is None
assert host.get_messages() == []
print("✓ create_host factory works, is_ready=False before start")

# Verify no Ink/Textual dependency triggered
import sys
ink_modules = [m for m in sys.modules if "ink" in m.lower() and "textual" not in m.lower()]
textual_modules = [m for m in sys.modules if "textual" in m.lower()]
assert not ink_modules, f"Ink modules unexpectedly loaded: {ink_modules}"
assert not textual_modules, f"Textual modules unexpectedly loaded: {textual_modules}"
print("✓ No Ink/Textual modules loaded")

print("\nAll SDK verification checks passed!")
