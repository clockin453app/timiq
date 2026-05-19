"""CIS payroll stale detection when inputs drift from stored PayrollItem snapshots."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.modules.payroll.calculation import policy_snapshot_dict
from app.modules.payroll.models import PayrollItem, PayrollPeriod
from app.modules.payroll.service import (
    PayrollApprovedBlockingError,
    _build_report_alerts,
    _payroll_item_inputs_stale,
    recalculate_payroll,
)


def _company_policy() -> SimpleNamespace:
    return SimpleNamespace(
        timezone_name="UTC",
        standard_start_time="09:00",
        overtime_after_hours=8.5,
        overtime_multiplier=1.5,
        rounding_increment_minutes=15,
        rounding_mode="nearest",
        break_deduction_minutes=0,
        break_deduction_after_minutes=0,
        rule_effective_from=date(2020, 1, 1),
    )


def _period(*, calculated_at: datetime | None) -> PayrollPeriod:
    return PayrollPeriod(
        id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        week_start=date(2026, 5, 11),
        timezone_name="UTC",
        calculated_at=calculated_at,
        calculated_by_user_id=uuid.uuid4() if calculated_at else None,
    )


def _item(
    *,
    company_id: uuid.UUID,
    period_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
    hourly_rate_snapshot: float | None = 10.0,
    tax_rate_snapshot: float | None = 20.0,
    payment_mode: str = "net_payment",
    payment_mode_source: str | None = "profile",
    rounded_total_seconds: int = 3600,
    status: str = "pending",
    policy_snapshot: dict | None = None,
) -> PayrollItem:
    policy = _company_policy()
    snap = policy_snapshot if policy_snapshot is not None else policy_snapshot_dict(policy)
    return PayrollItem(
        id=uuid.uuid4(),
        period_id=period_id,
        user_id=user_id or uuid.uuid4(),
        company_id=company_id,
        regular_seconds=3600,
        overtime_seconds=0,
        rounded_total_seconds=rounded_total_seconds,
        hourly_rate_snapshot=hourly_rate_snapshot,
        tax_rate_snapshot=tax_rate_snapshot,
        overtime_multiplier_snapshot=float(policy.overtime_multiplier),
        gross_amount=100.0,
        tax_amount=20.0,
        net_amount=80.0,
        other_deductions_amount=0,
        display_tax_amount=20.0,
        display_net_amount=80.0,
        payment_mode=payment_mode,
        payment_mode_source=payment_mode_source,
        policy_snapshot=snap,
        status=status,
        rate_missing=False,
    )


def _alerts_patch_context() -> dict[str, object]:
    return {
        "app.modules.payroll.service.count_open_shifts_started_in_week": 0,
        "app.modules.payroll.service._missing_profile_hourly_rate_count": 0,
        "app.modules.payroll.service._item_missing_required_payroll_setup": False,
        "app.modules.payroll.service._missing_tax_identifier_counts": (0, 0),
        "app.modules.payroll.service.max_employee_shift_updated_at_in_payroll_week": None,
        "app.modules.payroll.service.get_company_by_id": SimpleNamespace(default_tax_rate=20.0),
        "app.modules.payroll.service.first_workplace_tax": None,
    }


def test_hourly_rate_change_marks_payroll_stale() -> None:
    company_id = uuid.uuid4()
    period = _period(calculated_at=datetime(2026, 5, 12, 12, 0, tzinfo=timezone.utc))
    row = _item(company_id=company_id, period_id=period.id, hourly_rate_snapshot=10.0)
    profile = SimpleNamespace(hourly_rate=20.0, tax_rate=None, payment_mode=None)
    policy = _company_policy()

    with (
        patch("app.modules.payroll.service.count_open_shifts_started_in_week", return_value=0),
        patch("app.modules.payroll.service._missing_profile_hourly_rate_count", return_value=0),
        patch("app.modules.payroll.service._missing_tax_identifier_counts", return_value=(0, 0)),
        patch("app.modules.payroll.service.max_employee_shift_updated_at_in_payroll_week", return_value=None),
        patch("app.modules.payroll.service.get_employee_profile_by_user_id", return_value=profile),
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(default_tax_rate=20.0)),
        patch("app.modules.payroll.service.first_workplace_tax", return_value=None),
        patch("app.modules.payroll.service.sum_rounded_seconds_payroll_week", return_value=3600),
    ):
        assert _payroll_item_inputs_stale(
            MagicMock(),
            item=row,
            profile=profile,
            company_default_tax=20.0,
            workplace_tax=None,
            company_policy=policy,
            week_start=period.week_start,
        )
        alerts = _build_report_alerts(
            MagicMock(),
            company_id=company_id,
            policy=policy,
            week_start=period.week_start,
            period=period,
            all_items=[row],
        )

    assert alerts.payroll_needs_recalculation is True


def test_unchanged_snapshots_not_stale() -> None:
    company_id = uuid.uuid4()
    period = _period(calculated_at=datetime(2026, 5, 12, 12, 0, tzinfo=timezone.utc))
    policy = _company_policy()
    row = _item(company_id=company_id, period_id=period.id, hourly_rate_snapshot=10.0)
    profile = SimpleNamespace(hourly_rate=10.0, tax_rate=20.0, payment_mode="net_payment")

    with (
        patch("app.modules.payroll.service.count_open_shifts_started_in_week", return_value=0),
        patch("app.modules.payroll.service._missing_profile_hourly_rate_count", return_value=0),
        patch("app.modules.payroll.service._missing_tax_identifier_counts", return_value=(0, 0)),
        patch("app.modules.payroll.service.max_employee_shift_updated_at_in_payroll_week", return_value=None),
        patch("app.modules.payroll.service.get_employee_profile_by_user_id", return_value=profile),
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(default_tax_rate=None)),
        patch("app.modules.payroll.service.first_workplace_tax", return_value=None),
        patch("app.modules.payroll.service.sum_rounded_seconds_payroll_week", return_value=3600),
    ):
        alerts = _build_report_alerts(
            MagicMock(),
            company_id=company_id,
            policy=policy,
            week_start=period.week_start,
            period=period,
            all_items=[row],
        )

    assert alerts.payroll_needs_recalculation is False


def test_rounded_seconds_mismatch_marks_stale() -> None:
    company_id = uuid.uuid4()
    period = _period(calculated_at=datetime(2026, 5, 12, 12, 0, tzinfo=timezone.utc))
    policy = _company_policy()
    row = _item(company_id=company_id, period_id=period.id, rounded_total_seconds=3600)
    profile = SimpleNamespace(hourly_rate=10.0, tax_rate=20.0, payment_mode="net_payment")

    with (
        patch("app.modules.payroll.service.count_open_shifts_started_in_week", return_value=0),
        patch("app.modules.payroll.service._missing_profile_hourly_rate_count", return_value=0),
        patch("app.modules.payroll.service._missing_tax_identifier_counts", return_value=(0, 0)),
        patch("app.modules.payroll.service.max_employee_shift_updated_at_in_payroll_week", return_value=None),
        patch("app.modules.payroll.service.get_employee_profile_by_user_id", return_value=profile),
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(default_tax_rate=None)),
        patch("app.modules.payroll.service.first_workplace_tax", return_value=None),
        patch("app.modules.payroll.service.sum_rounded_seconds_payroll_week", return_value=7200),
    ):
        alerts = _build_report_alerts(
            MagicMock(),
            company_id=company_id,
            policy=policy,
            week_start=period.week_start,
            period=period,
            all_items=[row],
        )

    assert alerts.payroll_needs_recalculation is True


def test_shift_updated_after_calculation_still_marks_stale() -> None:
    company_id = uuid.uuid4()
    calculated_at = datetime(2026, 5, 12, 12, 0, tzinfo=timezone.utc)
    period = _period(calculated_at=calculated_at)
    policy = _company_policy()
    row = _item(company_id=company_id, period_id=period.id)
    profile = SimpleNamespace(hourly_rate=10.0, tax_rate=20.0, payment_mode="net_payment")

    with (
        patch("app.modules.payroll.service.count_open_shifts_started_in_week", return_value=0),
        patch("app.modules.payroll.service._missing_profile_hourly_rate_count", return_value=0),
        patch("app.modules.payroll.service._missing_tax_identifier_counts", return_value=(0, 0)),
        patch(
            "app.modules.payroll.service.max_employee_shift_updated_at_in_payroll_week",
            return_value=datetime(2026, 5, 13, 8, 0, tzinfo=timezone.utc),
        ),
        patch("app.modules.payroll.service.get_employee_profile_by_user_id", return_value=profile),
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(default_tax_rate=None)),
        patch("app.modules.payroll.service.first_workplace_tax", return_value=None),
        patch("app.modules.payroll.service.sum_rounded_seconds_payroll_week", return_value=3600),
    ):
        alerts = _build_report_alerts(
            MagicMock(),
            company_id=company_id,
            policy=policy,
            week_start=period.week_start,
            period=period,
            all_items=[row],
        )

    assert alerts.payroll_needs_recalculation is True


def test_payment_mode_change_marks_stale() -> None:
    company_id = uuid.uuid4()
    period = _period(calculated_at=datetime(2026, 5, 12, 12, 0, tzinfo=timezone.utc))
    policy = _company_policy()
    row = _item(company_id=company_id, period_id=period.id, payment_mode="net_payment", payment_mode_source="profile")
    profile = SimpleNamespace(hourly_rate=10.0, tax_rate=20.0, payment_mode="gross_payment")

    with (
        patch("app.modules.payroll.service.count_open_shifts_started_in_week", return_value=0),
        patch("app.modules.payroll.service._missing_profile_hourly_rate_count", return_value=0),
        patch("app.modules.payroll.service._missing_tax_identifier_counts", return_value=(0, 0)),
        patch("app.modules.payroll.service.max_employee_shift_updated_at_in_payroll_week", return_value=None),
        patch("app.modules.payroll.service.get_employee_profile_by_user_id", return_value=profile),
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(default_tax_rate=None)),
        patch("app.modules.payroll.service.first_workplace_tax", return_value=None),
        patch("app.modules.payroll.service.sum_rounded_seconds_payroll_week", return_value=3600),
    ):
        alerts = _build_report_alerts(
            MagicMock(),
            company_id=company_id,
            policy=policy,
            week_start=period.week_start,
            period=period,
            all_items=[row],
        )

    assert alerts.payroll_needs_recalculation is True


def test_policy_snapshot_change_marks_stale() -> None:
    company_id = uuid.uuid4()
    period = _period(calculated_at=datetime(2026, 5, 12, 12, 0, tzinfo=timezone.utc))
    policy = _company_policy()
    old_policy = dict(policy_snapshot_dict(policy))
    old_policy["overtime_after_hours"] = 7.0
    row = _item(company_id=company_id, period_id=period.id, policy_snapshot=old_policy)
    profile = SimpleNamespace(hourly_rate=10.0, tax_rate=20.0, payment_mode="net_payment")

    with (
        patch("app.modules.payroll.service.count_open_shifts_started_in_week", return_value=0),
        patch("app.modules.payroll.service._missing_profile_hourly_rate_count", return_value=0),
        patch("app.modules.payroll.service._missing_tax_identifier_counts", return_value=(0, 0)),
        patch("app.modules.payroll.service.max_employee_shift_updated_at_in_payroll_week", return_value=None),
        patch("app.modules.payroll.service.get_employee_profile_by_user_id", return_value=profile),
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(default_tax_rate=None)),
        patch("app.modules.payroll.service.first_workplace_tax", return_value=None),
        patch("app.modules.payroll.service.sum_rounded_seconds_payroll_week", return_value=3600),
    ):
        alerts = _build_report_alerts(
            MagicMock(),
            company_id=company_id,
            policy=policy,
            week_start=period.week_start,
            period=period,
            all_items=[row],
        )

    assert alerts.payroll_needs_recalculation is True


def test_approved_row_can_be_stale_without_mutating_item() -> None:
    company_id = uuid.uuid4()
    period = _period(calculated_at=datetime(2026, 5, 12, 12, 0, tzinfo=timezone.utc))
    policy = _company_policy()
    row = _item(company_id=company_id, period_id=period.id, status="approved", hourly_rate_snapshot=10.0)
    profile = SimpleNamespace(hourly_rate=25.0, tax_rate=20.0, payment_mode="net_payment")
    before_gross = row.gross_amount

    with (
        patch("app.modules.payroll.service.count_open_shifts_started_in_week", return_value=0),
        patch("app.modules.payroll.service._missing_profile_hourly_rate_count", return_value=0),
        patch("app.modules.payroll.service._missing_tax_identifier_counts", return_value=(0, 0)),
        patch("app.modules.payroll.service.max_employee_shift_updated_at_in_payroll_week", return_value=None),
        patch("app.modules.payroll.service.get_employee_profile_by_user_id", return_value=profile),
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(default_tax_rate=None)),
        patch("app.modules.payroll.service.first_workplace_tax", return_value=None),
        patch("app.modules.payroll.service.sum_rounded_seconds_payroll_week", return_value=3600),
    ):
        alerts = _build_report_alerts(
            MagicMock(),
            company_id=company_id,
            policy=policy,
            week_start=period.week_start,
            period=period,
            all_items=[row],
        )

    assert alerts.payroll_needs_recalculation is True
    assert row.gross_amount == before_gross
    assert row.status == "approved"


def test_stale_period_with_approved_row_blocks_recalculate() -> None:
    company_id = uuid.uuid4()
    actor = SimpleNamespace(id=uuid.uuid4(), company_id=company_id, system_role=SimpleNamespace(value="admin"))
    period = _period(calculated_at=datetime(2026, 5, 12, 12, 0, tzinfo=timezone.utc))

    with (
        patch("app.modules.payroll.service.assert_payroll_admin_or_administrator"),
        patch("app.modules.payroll.service.assert_payroll_company_scope"),
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(default_tax_rate=20.0)),
        patch("app.modules.payroll.service.ensure_company_time_policy", return_value=_company_policy()),
        patch("app.modules.payroll.service.first_workplace_tax", return_value=None),
        patch("app.modules.payroll.service.get_period_by_company_week", return_value=period),
        patch("app.modules.payroll.service.period_has_paid_item", return_value=False),
        patch("app.modules.payroll.service.period_has_approved_item", return_value=True),
    ):
        with pytest.raises(PayrollApprovedBlockingError):
            recalculate_payroll(
                MagicMock(),
                actor,
                company_id=company_id,
                week_start=period.week_start,
            )
