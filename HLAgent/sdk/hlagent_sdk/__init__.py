"""HLAgent SDK — WebBackendHost wrapping OpenHarness ReactBackendHost.

The SDK exposes a queue-based interface over the existing ReactBackendHost,
replacing stdin/stdout I/O with asyncio queues so the FastAPI Gateway can
bridge WebSocket messages to/from the Agent runtime.
"""

from hlagent_sdk.web_host import WebBackendHost, AgentSessionConfig, create_host

__all__ = ["WebBackendHost", "AgentSessionConfig", "create_host"]
