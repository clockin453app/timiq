"""Payroll readiness warnings and approval blocking."""

from __future__ import annotations

import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole
from app.modules.payroll.service import (
    PayrollItemStateError,
    _build_report_alerts,
    approve_all_pending,
    approve_item,
)


def _actor() -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), company_id=None, system_role=SystemRole.ADMINISTRATOR)


def _item(
    *,
    status: str = "pending",
    rate_missing: bool = False,
    hourly_rate_snapshot: float | None = 20,
    tax_rate_snapshot: float | None = 20,
    payment_mode: str | None = "net_payment",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        period_id=uuid.uuid4(),
        status=status,
        rate_missing=rate_missing,
        hourly_rate_snapshot=hourly_rate_snapshot,
        tax_rate_snapshot=tax_rate_snapshot,
        payment_mode=payment_mode,
        rounded_total_seconds=3600,
    )


def test_missing_payroll_setup_appears_in_report_alerts() -> None:
    with patch("app.modules.payroll.service.count_open_shifts_started_in_week", return_value=0):
        alerts = _build_report_alerts(
            MagicMock(),
            company_id=uuid.uuid4(),
            policy=SimpleNamespace(timezone_name="UTC"),
            week_start=date(2026, 5, 11),
            period=SimpleNamespace(id=uuid.uuid4(), calculated_at=None),
            all_items=[
                _item(tax_rate_snapshot=None, payment_mode="net_payment"),
                _item(tax_rate_snapshot=None, payment_mode="gross_payment"),
            ],
        )

    assert alerts.missing_payroll_setup_employees_count == 1


@patch("app.modules.payroll.service._payroll_period_needs_recalculation", return_value=False)
@patch("app.modules.payroll.service.get_item_by_id")
def test_missing_hourly_rate_blocks_individual_approval(mock_get: MagicMock, _stale: MagicMock) -> None:
    item = _item(rate_missing=True, hourly_rate_snapshot=None)
    mock_get.return_value = item
    db = MagicMock()
    db.get.return_value = SimpleNamespace(id=item.period_id, week_start=date(2026, 5, 11))

    with pytest.raises(PayrollItemStateError, match="missing hourly rate"):
        approve_item(db, _actor(), item.id)


@patch("app.modules.payroll.service._payroll_period_needs_recalculation", return_value=False)
@patch("app.modules.payroll.service.get_period_by_company_week")
@patch("app.modules.payroll.service.list_items_for_period")
def test_missing_hourly_rate_blocks_approve_all(
    mock_items: MagicMock,
    mock_period: MagicMock,
    _stale: MagicMock,
) -> None:
    period = SimpleNamespace(id=uuid.uuid4(), week_start=date(2026, 5, 11))
    mock_period.return_value = period
    mock_items.return_value = [_item(rate_missing=True, hourly_rate_snapshot=None)]

    with pytest.raises(PayrollItemStateError, match="missing hourly rate"):
        approve_all_pending(MagicMock(), _actor(), company_id=uuid.uuid4(), week_start=period.week_start)


@patch("app.modules.payroll.service._payroll_period_needs_recalculation", return_value=False)
@patch("app.modules.payroll.service.get_item_by_id")
def test_missing_cis_setup_blocks_net_payment_individual_approval(mock_get: MagicMock, _stale: MagicMock) -> None:
    item = _item(tax_rate_snapshot=None, payment_mode="net_payment")
    mock_get.return_value = item
    db = MagicMock()
    db.get.return_value = SimpleNamespace(id=item.period_id, week_start=date(2026, 5, 11))

    with pytest.raises(PayrollItemStateError, match="payroll/CIS setup"):
        approve_item(db, _actor(), item.id)


@patch("app.modules.payroll.service._payroll_period_needs_recalculation", return_value=False)
@patch("app.modules.payroll.service.get_period_by_company_week")
@patch("app.modules.payroll.service.list_items_for_period")
def test_missing_cis_setup_blocks_approve_all(
    mock_items: MagicMock,
    mock_period: MagicMock,
    _stale: MagicMock,
) -> None:
    period = SimpleNamespace(id=uuid.uuid4(), week_start=date(2026, 5, 11))
    mock_period.return_value = period
    mock_items.return_value = [_item(tax_rate_snapshot=None, payment_mode="net_payment")]

    with pytest.raises(PayrollItemStateError, match="payroll/CIS setup"):
        approve_all_pending(MagicMock(), _actor(), company_id=uuid.uuid4(), week_start=period.week_start)


@patch("app.modules.payroll.service._payroll_period_needs_recalculation", return_value=False)
@patch("app.modules.payroll.service.get_item_by_id")
@patch("app.modules.payroll.service.update_item")
@patch("app.modules.payroll.service.item_to_response")
@patch("app.modules.payroll.service.create_internal_audit_event")
def test_valid_row_can_still_approve(
    _audit: MagicMock,
    response: MagicMock,
    _update: MagicMock,
    mock_get: MagicMock,
    _stale: MagicMock,
) -> None:
    item = _item()
    mock_get.return_value = item
    response.return_value = "ok"
    db = MagicMock()
    db.get.return_value = SimpleNamespace(id=item.period_id, week_start=date(2026, 5, 11))

    assert approve_item(db, _actor(), item.id) == "ok"
    assert item.status == "approved"
