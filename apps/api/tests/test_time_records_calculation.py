"""Tests for time_records.calculation (rounding, breaks, counted clock-in)."""

import uuid
from datetime import datetime, timezone

from app.modules.companies.models import CompanyTimePolicy
from app.modules.time_records.calculation import (
    compute_shift_metrics,
    counted_clock_in_at,
    round_duration_seconds,
)


def _policy(**kwargs: object) -> CompanyTimePolicy:
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    base: dict = dict(
        company_id=kwargs.get("company_id", uuid.uuid4()),
        standard_start_time="09:00",
        overtime_after_hours=8.5,
        overtime_multiplier=1.5,
        rounding_increment_minutes=15,
        rounding_mode="nearest",
        break_deduction_minutes=30,
        break_deduction_after_minutes=360,
        rule_effective_from=now,
        rule_note="",
        timezone_name="Europe/London",
        created_at=now,
        updated_at=now,
    )
    base.update(kwargs)
    return CompanyTimePolicy(**base)


def test_round_duration_nearest_up_down() -> None:
    assert round_duration_seconds(100, 1, "nearest") == 120
    assert round_duration_seconds(100, 1, "up") == 120
    assert round_duration_seconds(119, 1, "down") == 60


def test_counted_clock_in_snaps_to_standard_without_early_access() -> None:
    pol = _policy(standard_start_time="09:00", timezone_name="Europe/London")
    clock_in = datetime(2026, 6, 2, 6, 30, tzinfo=timezone.utc)
    counted = counted_clock_in_at(clock_in, early_access_enabled=False, policy=pol)
    assert counted > clock_in


def test_counted_clock_in_early_access_uses_actual() -> None:
    pol = _policy()
    clock_in = datetime(2026, 6, 2, 6, 30, tzinfo=timezone.utc)
    counted = counted_clock_in_at(clock_in, early_access_enabled=True, policy=pol)
    assert counted == clock_in


def test_break_deduction_floor_below_threshold() -> None:
    """Span under break_deduction_after_minutes → no automatic break floor (tracked break still 0)."""
    pol = _policy(break_deduction_minutes=30, break_deduction_after_minutes=360)
    clock_in = datetime(2026, 6, 2, 9, 0, tzinfo=timezone.utc)
    clock_out = datetime(2026, 6, 2, 10, 0, tzinfo=timezone.utc)
    m = compute_shift_metrics(
        clock_in_at_utc=clock_in,
        clock_out_at_utc=clock_out,
        break_seconds_tracked=0,
        early_access_enabled=True,
        policy=pol,
    )
    assert m.break_seconds == 0
    assert m.counted_seconds == 3600


def test_break_deduction_floor_applies_after_threshold() -> None:
    pol = _policy(break_deduction_minutes=30, break_deduction_after_minutes=60)
    clock_in = datetime(2026, 6, 2, 9, 0, tzinfo=timezone.utc)
    clock_out = datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc)
    m = compute_shift_metrics(
        clock_in_at_utc=clock_in,
        clock_out_at_utc=clock_out,
        break_seconds_tracked=0,
        early_access_enabled=True,
        policy=pol,
    )
    assert m.break_seconds == 0
    assert m.break_deducted_seconds == 30 * 60
    assert m.counted_seconds is not None
    assert m.counted_seconds == 3 * 3600 - 30 * 60


def test_break_deducted_uses_max_of_tracked_and_policy_floor() -> None:
    pol = _policy(break_deduction_minutes=30, break_deduction_after_minutes=60)
    clock_in = datetime(2026, 6, 2, 9, 0, tzinfo=timezone.utc)
    clock_out = datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc)
    m = compute_shift_metrics(
        clock_in_at_utc=clock_in,
        clock_out_at_utc=clock_out,
        break_seconds_tracked=20 * 60,
        early_access_enabled=True,
        policy=pol,
    )
    assert m.break_seconds == 20 * 60
    assert m.break_deducted_seconds == 30 * 60


def test_user_example_7h16_clocked_30m_break_payable() -> None:
    """7h16 clocked with 30m automatic break → 6h46 payable (display field populated)."""
    pol = _policy(
        break_deduction_minutes=30,
        break_deduction_after_minutes=360,
        rounding_increment_minutes=30,
        rounding_mode="nearest",
        standard_start_time="09:00",
    )
    clock_in = datetime(2026, 6, 2, 8, 0, tzinfo=timezone.utc)
    clock_out = datetime(2026, 6, 2, 15, 16, tzinfo=timezone.utc)
    m = compute_shift_metrics(
        clock_in_at_utc=clock_in,
        clock_out_at_utc=clock_out,
        break_seconds_tracked=0,
        early_access_enabled=True,
        policy=pol,
    )
    assert m.actual_seconds == 7 * 3600 + 16 * 60
    assert m.break_deducted_seconds == 30 * 60
    assert m.counted_seconds == 7 * 3600 + 16 * 60 - 30 * 60
    assert m.rounded_seconds == 7 * 3600
