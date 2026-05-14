"""Pure leave-day math (calendar-based; no statutory rules)."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal


def _safe_month_day(year: int, month: int, day: int) -> date:
    try:
        return date(year, month, day)
    except ValueError:
        # e.g. Feb 29 on non-leap — use last valid day of month
        for d in range(28, 31):
            try:
                return date(year, month, d)
            except ValueError:
                continue
        return date(year, month, 28)


def leave_year_start_for_date(containing: date, *, start_month: int, start_day: int) -> date:
    """Start date (inclusive) of the configured annual-leave year containing `containing`."""
    y = containing.year
    anchor = _safe_month_day(y, start_month, start_day)
    if containing >= anchor:
        return anchor
    return _safe_month_day(y - 1, start_month, start_day)


def leave_year_key_for_date(containing: date, *, start_month: int, start_day: int) -> str:
    """Stable bucket label for allowance (calendar year of the leave-year start)."""
    start = leave_year_start_for_date(containing, start_month=start_month, start_day=start_day)
    return str(start.year)


def leave_year_date_range(leave_year: str, *, start_month: int, start_day: int) -> tuple[date, date]:
    """Inclusive date range for a leave_year key like '2026'."""
    y = int(leave_year)
    start = _safe_month_day(y, start_month, start_day)
    end = _safe_month_day(y + 1, start_month, start_day) - timedelta(days=1)
    return start, end


def compute_leave_total_days(
    date_from: date,
    date_to: date,
    *,
    start_half_day: str | None,
    end_half_day: str | None,
    allow_half_days: bool,
) -> Decimal:
    if date_to < date_from:
        raise ValueError("date_to must be on or after date_from")
    if not allow_half_days:
        return Decimal((date_to - date_from).days + 1)

    sh = (start_half_day or "morning").strip().lower()
    eh = (end_half_day or "afternoon").strip().lower()
    if sh not in ("morning", "afternoon") or eh not in ("morning", "afternoon"):
        raise ValueError("Half day must be morning or afternoon.")

    if date_from == date_to:
        if sh == "morning" and eh == "afternoon":
            return Decimal(1)
        if sh == "morning" and eh == "morning":
            return Decimal("0.5")
        if sh == "afternoon" and eh == "afternoon":
            return Decimal("0.5")
        raise ValueError("Invalid half-day combination for a single day.")

    span_days = (date_to - date_from).days + 1
    first = Decimal("0.5") if sh == "afternoon" else Decimal(1)
    last = Decimal("0.5") if eh == "morning" else Decimal(1)
    middle = max(0, span_days - 2)
    return first + Decimal(middle) + last


def date_ranges_overlap(a_from: date, a_to: date, b_from: date, b_to: date) -> bool:
    return a_from <= b_to and a_to >= b_from
