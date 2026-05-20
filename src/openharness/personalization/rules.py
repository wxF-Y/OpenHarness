"""Local rules file management."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def _rules_dir() -> Path:
    from openharness.config.paths import get_config_dir
    return get_config_dir() / "local_rules"


def _ensure_dir() -> None:
    _rules_dir().mkdir(parents=True, exist_ok=True)


def load_local_rules() -> str:
    """Load the local rules markdown, or empty string if none exist."""
    rules_file = _rules_dir() / "rules.md"
    if rules_file.exists():
        return rules_file.read_text(encoding="utf-8").strip()
    return ""


def save_local_rules(content: str) -> Path:
    """Write local rules markdown."""
    _ensure_dir()
    rules_file = _rules_dir() / "rules.md"
    rules_file.write_text(content.strip() + "\n", encoding="utf-8")
    return rules_file


def load_facts() -> dict:
    """Load extracted facts as a dict."""
    facts_file = _rules_dir() / "facts.json"
    if facts_file.exists():
        return json.loads(facts_file.read_text(encoding="utf-8"))
    return {"facts": [], "last_updated": None}


def save_facts(facts: dict) -> None:
    """Persist extracted facts."""
    _ensure_dir()
    facts["last_updated"] = datetime.now(timezone.utc).isoformat()
    facts_file = _rules_dir() / "facts.json"
    facts_file.write_text(
        json.dumps(facts, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def merge_facts(existing: dict, new_facts: list[dict]) -> dict:
    """Merge new facts into existing, deduplicating by key."""
    by_key = {}
    for f in existing.get("facts", []):
        by_key[f["key"]] = f
    for f in new_facts:
        key = f.get("key", "")
        if key:
            if key in by_key:
                old = by_key[key]
                if f.get("confidence", 0) >= old.get("confidence", 0):
                    by_key[key] = f
            else:
                by_key[key] = f
    return {"facts": list(by_key.values())}
