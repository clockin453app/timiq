"""Budget labour vs planned formulas (aligned with budgets/service.py labour block)."""

from decimal import ROUND_HALF_UP, Decimal


def _labour_remaining_over(*, planned: Decimal, actual_labour: Decimal) -> tuple[Decimal, Decimal, Decimal | None]:
    """Mirror of planned-budget branch in compute_labour_cost_response (apps/api/app/modules/budgets/service.py)."""
    MONEY_QUANT = Decimal("0.01")
    pb = planned.quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    remaining: Decimal | None = None
    over_amt: Decimal | None = None
    used_pct: Decimal | None = None
    if pb > 0:
        diff = (pb - actual_labour).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
        remaining = max(diff, Decimal("0.00"))
        over_amt = max((actual_labour - pb).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP), Decimal("0.00"))
        used_pct = ((actual_labour / pb) * Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    else:
        remaining = Decimal("0.00")
        over_amt = actual_labour if actual_labour > 0 else Decimal("0.00")
        used_pct = None
    return remaining, over_amt, used_pct


def test_planned_gt_actual_positive_remaining() -> None:
    rem, over, pct = _labour_remaining_over(planned=Decimal("1000.00"), actual_labour=Decimal("400.00"))
    assert rem == Decimal("600.00")
    assert over == Decimal("0.00")
    assert pct == Decimal("40.00")


def test_actual_gt_planned_over_budget() -> None:
    rem, over, pct = _labour_remaining_over(planned=Decimal("100.00"), actual_labour=Decimal("150.00"))
    assert rem == Decimal("0.00")
    assert over == Decimal("50.00")
    assert pct == Decimal("150.00")


def test_missing_hourly_rate_implies_zero_cost_in_aggregation() -> None:
    """Labour row cost uses Decimal(0) when hourly is None (see budgets/service.py)."""
    hourly = None
    rnd_seconds = 3600
    shift_cost = Decimal("0.00") if hourly is None else Decimal(rnd_seconds) / Decimal(3600) * Decimal(hourly)
    assert shift_cost == Decimal("0.00")


def test_purchase_category_totals_reduce_to_dict() -> None:
    """Lightweight stand-in for grouping expenses by category (repository returns dict[str, float])."""
    rows = [("tools", 10.0), ("tools", 5.5), ("fuel", 3.0)]
    acc: dict[str, float] = {}
    for cat, amt in rows:
        acc[cat] = acc.get(cat, 0.0) + amt
    assert acc["tools"] == 15.5
    assert acc["fuel"] == 3.0
