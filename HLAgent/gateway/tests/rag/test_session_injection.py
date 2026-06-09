"""Verify search_codebase tool schema is importable and well-formed.

The full Agent tool-list integration in ws.py is verified by the e2e in Task 20.
M1 here verifies the wiring scaffolding is present and importable.
"""
import json

from services.rag.tools import SEARCH_CODEBASE_SCHEMA


def test_search_codebase_schema_present():
    assert SEARCH_CODEBASE_SCHEMA["function"]["name"] == "search_codebase"
    json.dumps(SEARCH_CODEBASE_SCHEMA)  # serializable for tool registration
