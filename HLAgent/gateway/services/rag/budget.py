"""Daily cost ledger + budget enforcement.

Local-timezone day boundary. M1 wires pause action into runtime; warn/hard_stop
recognized but only differ in indexer side-effects.
"""
from __future__ import annotations

import time
from datetime import date, datetime
from typing import Literal

OverBudgetAction = Literal["pause", "warn", "hard_stop"]


class Budget:
    def __init__(self, store, daily_usd: float,
                 over_budget_action: OverBudgetAction = "pause"):
        self.store = store
        self.daily_usd = daily_usd
        self.over_budget_action = over_budget_action

    def _today_window(self) -> tuple[float, float]:
        today = date.today()
        start = datetime(today.year, today.month, today.day).timestamp()
        return start, start + 86400

    def today_total_usd(self) -> float:
        start, end = self._today_window()
        row = self.store.conn.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) FROM embed_ledger "
            "WHERE ts >= ? AND ts < ?",
            (start, end),
        ).fetchone()
        return float(row[0])

    def exceeded(self) -> bool:
        return self.today_total_usd() >= self.daily_usd

    def would_exceed(self, additional_usd: float) -> bool:
        return self.today_total_usd() + additional_usd > self.daily_usd

    def charge(self, *, tokens: int, cost_usd: float, source: str) -> None:
        self.store.conn.execute(
            "INSERT INTO embed_ledger(ts, tokens, cost_usd, source) VALUES (?, ?, ?, ?)",
            (time.time(), tokens, cost_usd, source),
        )
