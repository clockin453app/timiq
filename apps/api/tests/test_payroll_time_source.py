"""Payroll invalidation and approval safety after time-record changes."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole
from app.modules.live_attendance.service import _completed_worked_seconds
from app.modules.payroll.calculation import sum_rounded_seconds_payroll_week
from app.modules.payroll.permissions import PayrollPermissionError
from app.modules.payroll.service import (
    PayrollItemStateError,
    _build_report_alerts,
    approve_all_pending,
    approve_item,
    mark_payroll_period_needs_recalculation,
)
from app.modules.time_records.admin_manual_service import (
    _assert_payroll_allows_time_edit_for_weeks,
    _mark_payroll_weeks_needing_recalculation,
)
from app.modules.time_records.calculation import compute_shift_metrics


def _actor(company_id: uuid.UUID | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        system_role=SystemRole.ADMINISTRATOR if company_id is None else SystemRole.ADMIN,
    )


def test_existing_period_with_items_and_no_calculated_at_is_stale() -> None:
    company_id = uuid.uuid4()
    period = SimpleNamespace(id=uuid.uuid4(), calculated_at=None)
    item = SimpleNamespace(status="pending", rate_missing=False, rounded_total_seconds=3600)

    with patch("app.modules.payroll.service.count_open_shifts_started_in_week", return_value=0):
        alerts = _build_report_alerts(
            MagicMock(),
            company_id=company_id,
            policy=SimpleNamespace(timezone_name="UTC"),
            week_start=date(2026, 5, 11),
            period=period,
            all_items=[item],
        )

    assert alerts.payroll_period_not_calculated is False
    assert alerts.payroll_needs_recalculation is True


@patch("app.modules.payroll.service.invalidate_period_calculation_for_company_week")
def test_mark_payroll_period_needs_recalculation_uses_calculated_at_invalidation(mock_invalidate: MagicMock) -> None:
    mock_invalidate.return_value = True
    company_id = uuid.uuid4()
    week_start = date(2026, 5, 11)

    changed = mark_payroll_period_needs_recalculation(MagicMock(), company_id=company_id, week_start=week_start)

    assert changed is True
    mock_invalidate.assert_called_once()


@patch("app.modules.payroll.service._payroll_period_needs_recalculation", return_value=True)
@patch("app.modules.payroll.service.get_item_by_id")
def test_stale_individual_approve_blocked_server_side(mock_get: MagicMock, _stale: MagicMock) -> None:
    company_id = uuid.uuid4()
    item = SimpleNamespace(id=uuid.uuid4(), company_id=company_id, period_id=uuid.uuid4(), status="pending")
    mock_get.return_value = item
    db = MagicMock()
    db.get.return_value = SimpleNamespace(id=item.period_id, week_start=date(2026, 5, 11))

    with pytest.raises(PayrollItemStateError, match="recalculation"):
        approve_item(db, _actor(), item.id)


@patch("app.modules.payroll.service.get_item_by_id")
def test_company_admin_cannot_approve_other_company_payroll(mock_get: MagicMock) -> None:
    actor_company_id = uuid.uuid4()
    item = SimpleNamespace(id=uuid.uuid4(), company_id=uuid.uuid4(), period_id=uuid.uuid4(), status="pending")
    mock_get.return_value = item

    with pytest.raises(PayrollPermissionError):
        approve_item(MagicMock(), _actor(actor_company_id), item.id)


@patch("app.modules.payroll.service._payroll_period_needs_recalculation", return_value=True)
@patch("app.modules.payroll.service.get_period_by_company_week")
@patch("app.modules.payroll.service.list_items_for_period")
def test_stale_approve_all_blocked_server_side(
    mock_items: MagicMock,
    mock_period: MagicMock,
    _stale: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    period = SimpleNamespace(id=uuid.uuid4(), week_start=date(2026, 5, 11))
    mock_period.return_value = period
    mock_items.return_value = [SimpleNamespace(status="pending")]

    with pytest.raises(PayrollItemStateError, match="recalculation"):
        approve_all_pending(MagicMock(), _actor(), company_id=company_id, week_start=period.week_start)


def test_approved_and_paid_rows_do_not_block_time_edit_but_remain_locked() -> None:
    company_id = uuid.uuid4()
    user_id = uuid.uuid4()
    paid = SimpleNamespace(status="paid")
    approved = SimpleNamespace(status="approved")
    with patch(
        "app.modules.time_records.admin_manual_service._payroll_item_for_user_week",
        side_effect=[paid, approved],
    ):
        _assert_payroll_allows_time_edit_for_weeks(
            MagicMock(),
            company_id=company_id,
            user_id=user_id,
            week_starts={date(2026, 5, 11), date(2026, 5, 18)},
        )


def test_time_edit_between_weeks_invalidates_old_and_new_week() -> None:
    company_id = uuid.uuid4()
    old_week = date(2026, 5, 11)
    new_week = date(2026, 5, 18)
    with patch("app.modules.time_records.admin_manual_service.mark_payroll_period_needs_recalculation") as mark:
        _mark_payroll_weeks_needing_recalculation(
            MagicMock(),
            company_id=company_id,
            week_starts={old_week, new_week},
        )

    assert mark.call_count == 2
    called_weeks = {call.kwargs["week_start"] for call in mark.call_args_list}
    assert called_weeks == {old_week, new_week}


def test_payroll_rounded_seconds_match_time_records_metrics() -> None:
    policy = SimpleNamespace(
        timezone_name="UTC",
        standard_start_time="09:00",
        rounding_increment_minutes=15,
        rounding_mode="nearest",
        break_deduction_minutes=0,
        break_deduction_after_minutes=0,
    )
    shift = SimpleNamespace(
        clock_in_at=datetime(2026, 5, 17, 8, 46, tzinfo=timezone.utc),
        clock_out_at=datetime(2026, 5, 17, 17, 7, tzinfo=timezone.utc),
        break_seconds=0,
    )
    metrics = compute_shift_metrics(
        clock_in_at_utc=shift.clock_in_at,
        clock_out_at_utc=shift.clock_out_at,
        break_seconds_tracked=shift.break_seconds,
        early_access_enabled=True,
        policy=policy,
    )
    with (
        patch("app.modules.payroll.calculation.list_time_shifts_for_payroll_week", return_value=[(shift, None, None, None)]),
        patch("app.modules.payroll.calculation.effective_time_policy_for_shift", return_value=policy),
        patch("app.modules.payroll.calculation.effective_early_access_for_shift", return_value=True),
    ):
        payroll_seconds = sum_rounded_seconds_payroll_week(
            MagicMock(),
            company_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            week_start=date(2026, 5, 11),
            policy=policy,
        )

    assert payroll_seconds == metrics.rounded_seconds


def test_live_attendance_completed_duration_uses_actual_span_minus_break() -> None:
    shift = SimpleNamespace(
        clock_in_at=datetime(2026, 5, 17, 8, 46, tzinfo=timezone.utc),
        clock_out_at=datetime(2026, 5, 17, 17, 7, tzinfo=timezone.utc),
        break_seconds=0,
    )

    assert _completed_worked_seconds(shift) == (8 * 3600) + (21 * 60)
