"""Per-cwd RagSession registry; one Gateway process owns one registry."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

from .session import RagSession


class RagRegistry:
    def __init__(self, data_root: Path | None = None):
        if data_root is None:
            home = Path(os.environ.get("HLAGENT_CONFIG_DIR",
                                        Path.home() / ".hlagent"))
            data_root = home / "data" / "rag"
        self.data_root = data_root
        self.data_root.mkdir(parents=True, exist_ok=True)
        self._sessions: dict[str, RagSession] = {}

    def project_hash(self, cwd: Path) -> str:
        return hashlib.sha256(str(cwd.resolve()).encode()).hexdigest()[:12]

    def db_path(self, cwd: Path) -> Path:
        return self.data_root / self.project_hash(cwd) / "index.db"

    def get(self, cwd: Path) -> RagSession | None:
        return self._sessions.get(self.project_hash(cwd))

    def register(self, cwd: Path, session: RagSession) -> None:
        self._sessions[self.project_hash(cwd)] = session

    def close_all(self) -> None:
        for s in self._sessions.values():
            s.close()
        self._sessions.clear()
