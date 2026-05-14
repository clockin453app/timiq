"""Pure leave calendar math (no database)."""

from datetime import date

import pytest

from app.modules.leave.calculation import compute_leave_total_days, date_ranges_overlap, leave_year_key_for_date


def test_compute_full_days_no_half() -> None:
    d = compute_leave_total_days(
        date(2026, 3, 2),
        date(2026, 3, 4),
        start_half_day=None,
        end_half_day=None,
        allow_half_days=False,
    )
    assert d == 3


def test_compute_single_day_half_morning() -> None:
    d = compute_leave_total_days(
        date(2026, 3, 2),
        date(2026, 3, 2),
        start_half_day="morning",
        end_half_day="morning",
        allow_half_days=True,
    )
    assert d == 0.5


def test_compute_span_half_start_afternoon() -> None:
    d = compute_leave_total_days(
        date(2026, 3, 2),
        date(2026, 3, 4),
        start_half_day="afternoon",
        end_half_day="afternoon",
        allow_half_days=True,
    )
    assert d == 2.5


def test_reject_date_to_before_from() -> None:
    with pytest.raises(ValueError, match="date_to"):
        compute_leave_total_days(
            date(2026, 3, 5),
            date(2026, 3, 2),
            start_half_day=None,
            end_half_day=None,
            allow_half_days=False,
        )


def test_ranges_overlap() -> None:
    assert date_ranges_overlap(date(2026, 1, 1), date(2026, 1, 5), date(2026, 1, 5), date(2026, 1, 10)) is True
    assert date_ranges_overlap(date(2026, 1, 1), date(2026, 1, 4), date(2026, 1, 5), date(2026, 1, 10)) is False


def test_leave_year_key() -> None:
    assert leave_year_key_for_date(date(2026, 6, 1), start_month=1, start_day=1) == "2026"
    assert leave_year_key_for_date(date(2026, 1, 1), start_month=4, start_day=1) == "2025"
