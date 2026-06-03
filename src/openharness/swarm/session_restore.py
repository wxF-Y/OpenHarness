"""Session history restoration from disk.

Provides utilities to load conversation history from persisted session snapshots,
enabling member session continuity when respawning after termination.
"""

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def load_session_snapshot(session_id: str) -> dict:
    """Load session snapshot from disk.

    Args:
        session_id: The session ID to load (can be short form like "abc123" or "session-abc123.json")

    Returns:
        Dict with 'messages' field containing conversation history,
        or empty dict if file not found or corrupted.
    """
    # Sessions are stored under ~/.hlagent/data/sessions/{parent_session}/session-{session_id}.json
    # or latest.json. We need to search for the session file.
    home = Path.home()
    sessions_root = home / ".hlagent" / "data" / "sessions"

    if not sessions_root.exists():
        logger.warning(f"Sessions directory not found: {sessions_root}")
        return {}

    # Search for session file across all parent session directories
    for parent_dir in sessions_root.iterdir():
        if not parent_dir.is_dir():
            continue

        # Try session-{session_id}.json format
        snapshot_path = parent_dir / f"session-{session_id}.json"
        if snapshot_path.exists():
            try:
                with open(snapshot_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse session snapshot {snapshot_path}: {e}")
                return {}
            except Exception as e:
                logger.error(f"Failed to load session snapshot {snapshot_path}: {e}")
                return {}

    logger.warning(f"Session snapshot not found for session_id: {session_id}")
    return {}
