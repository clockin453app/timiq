"""CIS payroll daily overtime threshold (per work date, not weekly)."""

from datetime import date

from app.modules.payroll.calculation import (
    split_regular_overtime_daily,
    split_regular_overtime_daily_by_work_date,
)

H = 3600
THRESHOLD_H = 8.5


def _h(hours: float) -> int:
    return int(hours * H)


def test_daily_overtime_three_days_under_threshold() -> None:
    reg, ot = split_regular_overtime_daily([_h(8.5), _h(8.5), _h(3)], THRESHOLD_H)
    assert reg == _h(20)
    assert ot == 0


def test_daily_overtime_10h_and_7h() -> None:
    reg, ot = split_regular_overtime_daily([_h(10), _h(7)], THRESHOLD_H)
    assert reg == _h(15.5)
    assert ot == _h(1.5)


def test_daily_overtime_9h_and_10h() -> None:
    reg, ot = split_regular_overtime_daily([_h(9), _h(10)], THRESHOLD_H)
    assert reg == _h(17)
    assert ot == _h(2)


def test_daily_overtime_exactly_threshold() -> None:
    reg, ot = split_regular_overtime_daily([_h(8.5)], THRESHOLD_H)
    assert reg == _h(8.5)
    assert ot == 0


def test_daily_overtime_empty() -> None:
    reg, ot = split_regular_overtime_daily([], THRESHOLD_H)
    assert reg == 0
    assert ot == 0


def test_weekly_total_exceeds_threshold_without_daily_overtime() -> None:
    """Multiple shifts on separate days must not become OT because the week exceeds 8.5h."""
    daily = [_h(8.5), _h(8.5), _h(3)]
    reg, ot = split_regular_overtime_daily(daily, THRESHOLD_H)
    assert sum(daily) > _h(8.5)
    assert ot == 0
    assert reg == sum(daily)


def test_same_work_date_shifts_summed_before_threshold() -> None:
    by_day = {date(2026, 1, 6): _h(4) + _h(5)}
    reg, ot = split_regular_overtime_daily_by_work_date(by_day, THRESHOLD_H)
    assert reg == _h(8.5)
    assert ot == _h(0.5)


def test_negative_day_seconds_clamped() -> None:
    reg, ot = split_regular_overtime_daily([-100, _h(9)], THRESHOLD_H)
    assert reg == _h(8.5)
    assert ot == _h(0.5)
