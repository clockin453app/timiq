"""Counted vs actual durations using company time policy (stored timestamps unchanged)."""

import math
from dataclasses import dataclass
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from app.modules.companies.models import CompanyTimePolicy


def _parse_standard_start(value: str) -> time:
    parts = value.strip().split(":")
    if len(parts) != 2:
        raise ValueError("standard_start_time must be HH:MM.")
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError("standard_start_time must be HH:MM.")
    return time(hour, minute)


def _policy_zone(policy: CompanyTimePolicy) -> ZoneInfo:
    try:
        return ZoneInfo(policy.timezone_name)
    except Exception:
        return ZoneInfo("UTC")


def counted_clock_in_at(
    clock_in_at_utc: datetime,
    *,
    early_access_enabled: bool,
    policy: CompanyTimePolicy,
) -> datetime:
    """Legacy-aligned counted start (still UTC-aware); actual rows unchanged in DB."""
    if early_access_enabled:
        return clock_in_at_utc

    tz = _policy_zone(policy)
    standard = _parse_standard_start(policy.standard_start_time)
    local_in = clock_in_at_utc.astimezone(tz)
    local_naive_time = local_in.time()

    if local_naive_time < standard:
        anchor_local = datetime.combine(local_in.date(), standard, tzinfo=tz)
        return anchor_local.astimezone(timezone.utc)

    return clock_in_at_utc


def round_duration_seconds(duration_seconds: int, increment_minutes: int, mode: str) -> int:
    if mode == "none" or increment_minutes <= 0:
        return max(0, duration_seconds)

    increment_seconds = increment_minutes * 60
    duration_seconds = max(0, duration_seconds)

    if mode == "nearest":
        return int(round(duration_seconds / increment_seconds) * increment_seconds)
    if mode == "up":
        return int(math.ceil(duration_seconds / increment_seconds) * increment_seconds)
    if mode == "down":
        return int(duration_seconds // increment_seconds) * increment_seconds

    return duration_seconds


@dataclass(frozen=True)
class ShiftCountedMetrics:
    counted_clock_in_at: datetime
    counted_clock_out_at: datetime | None
    actual_seconds: int | None
    running_actual_seconds: int | None
    """Break time recorded on the shift (clock breaks / admin entry)."""
    break_seconds: int
    """Automatic or tracked break actually deducted from payable time."""
    break_deducted_seconds: int
    counted_seconds: int | None
    rounded_seconds: int | None


def compute_shift_metrics(
    *,
    clock_in_at_utc: datetime,
    clock_out_at_utc: datetime | None,
    break_seconds_tracked: int,
    early_access_enabled: bool,
    policy: CompanyTimePolicy,
    now_utc: datetime | None = None,
) -> ShiftCountedMetrics:
    reference_now = now_utc or datetime.now(timezone.utc)

    counted_in = counted_clock_in_at(
        clock_in_at_utc,
        early_access_enabled=early_access_enabled,
        policy=policy,
    )
    counted_out = clock_out_at_utc
    span_end = clock_out_at_utc if clock_out_at_utc is not None else reference_now

    actual_seconds: int | None = None
    running_actual_seconds: int | None = None

    if clock_out_at_utc is not None:
        actual_seconds = max(0, int((clock_out_at_utc - clock_in_at_utc).total_seconds()))
    else:
        running_actual_seconds = max(0, int((reference_now - clock_in_at_utc).total_seconds()))

    gross_span_seconds = max(0, int((span_end - counted_in).total_seconds()))

    # Automatic break floor (break_deduction_minutes) applies only once payable span
    # (counted clock-in → counted end / now) reaches break_deduction_after_minutes (default 360).
    # Tracked breaks still use max(tracked, automatic_floor) when the floor applies.
    threshold_minutes = (
        int(policy.break_deduction_after_minutes)
        if policy.break_deduction_after_minutes is not None
        else 360
    )
    threshold_seconds = max(0, threshold_minutes) * 60

    deduction_floor = max(0, policy.break_deduction_minutes) * 60
    if threshold_seconds > 0 and gross_span_seconds < threshold_seconds:
        deduction_floor = 0
    effective_break = max(max(0, break_seconds_tracked), deduction_floor)

    net_seconds = max(0, gross_span_seconds - effective_break)

    rounded = round_duration_seconds(
        net_seconds,
        policy.rounding_increment_minutes,
        policy.rounding_mode,
    )

    return ShiftCountedMetrics(
        counted_clock_in_at=counted_in,
        counted_clock_out_at=counted_out,
        actual_seconds=actual_seconds,
        running_actual_seconds=running_actual_seconds,
        break_seconds=max(0, break_seconds_tracked),
        break_deducted_seconds=max(0, effective_break),
        counted_seconds=net_seconds,
        rounded_seconds=rounded,
    )
