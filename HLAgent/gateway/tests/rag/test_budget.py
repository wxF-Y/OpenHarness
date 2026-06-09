"""Budget tracks daily spend, supports pause / warn / hard_stop."""
import pytest

from services.rag.budget import Budget
from services.rag.store import RagStore


@pytest.fixture
def store(tmp_path):
    s = RagStore(tmp_path / "b.db", dimensions=4)
    s.init_schema()
    yield s
    s.close()


def test_charge_records_ledger(store):
    b = Budget(store, daily_usd=1.0, over_budget_action="pause")
    b.charge(tokens=100, cost_usd=0.001, source="manual")
    rows = store.conn.execute("SELECT cost_usd, source FROM embed_ledger").fetchall()
    assert rows == [(0.001, "manual")]


def test_today_total(store):
    b = Budget(store, daily_usd=1.0, over_budget_action="pause")
    b.charge(tokens=100, cost_usd=0.30, source="auto")
    b.charge(tokens=200, cost_usd=0.20, source="auto")
    assert abs(b.today_total_usd() - 0.50) < 1e-9


def test_exceeded(store):
    b = Budget(store, daily_usd=1.0, over_budget_action="pause")
    assert b.exceeded() is False
    b.charge(tokens=100, cost_usd=1.50, source="auto")
    assert b.exceeded() is True


def test_pre_charge_within_limit(store):
    b = Budget(store, daily_usd=1.0, over_budget_action="pause")
    b.charge(tokens=100, cost_usd=0.80, source="auto")
    assert b.would_exceed(0.10) is False
    assert b.would_exceed(0.30) is True
