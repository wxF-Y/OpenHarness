"""Marker: integration watcher coverage lives in test_watcher.py."""


def test_watcher_integration_marker():
    """tests/rag/test_watcher.py::test_modify_triggers_update covers this."""
    from services.rag.watcher import Watcher  # noqa: F401
    assert Watcher.__name__ == "Watcher"
