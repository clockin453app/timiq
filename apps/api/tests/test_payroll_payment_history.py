"""Admin payment-history read model for paid payroll rows."""

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole
from app.modules.payroll.permissions import PayrollPermissionError
from app.modules.payroll.service import PayrollError, list_payroll_payment_history


def _actor(company_id: uuid.UUID | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        system_role=SystemRole.ADMINISTRATOR if company_id is None else SystemRole.ADMIN,
    )


def _item(*, status: str = "paid", paid_at: datetime | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        status=status,
        paid_at=paid_at if paid_at is not None else datetime(2026, 5, 17, 9, 30, tzinfo=timezone.utc),
        gross_amount=100,
        tax_amount=20,
        net_amount=80,
        display_tax_amount=None,
        display_net_amount=None,
        payment_mode="net_payment",
        rate_missing=False,
    )


def test_payment_history_returns_paid_rows_only() -> None:
    company_id = uuid.uuid4()
    paid = _item(status="paid")
    unpaid = _item(status="approved")
    missing_paid_at = _item(status="paid")
    missing_paid_at.paid_at = None
    period = SimpleNamespace(week_start=date(2026, 5, 11))

    with (
        patch(
            "app.modules.payroll.service.list_paid_items_for_company_payment_history",
            return_value=[(paid, period), (unpaid, period), (missing_paid_at, period)],
        ),
        patch("app.modules.payroll.service._employee_display", return_value=("employee@example.com", "Employee", None)),
    ):
        rows = list_payroll_payment_history(MagicMock(), _actor(), company_id=company_id)

    assert len(rows) == 1
    assert rows[0].item_id == paid.id
    assert rows[0].status == "paid"
    assert rows[0].paid_at == paid.paid_at


def test_payment_history_passes_date_and_employee_filters_to_repository() -> None:
    company_id = uuid.uuid4()
    employee_id = uuid.uuid4()

    with (
        patch("app.modules.payroll.service._assert_valid_range_filter") as validate_filter,
        patch("app.modules.payroll.service.list_paid_items_for_company_payment_history", return_value=[]) as repo,
    ):
        list_payroll_payment_history(
            MagicMock(),
            _actor(),
            company_id=company_id,
            date_from=date(2026, 5, 1),
            date_to=date(2026, 5, 31),
            employee_user_id=employee_id,
        )

    validate_filter.assert_called_once()
    kwargs = repo.call_args.kwargs
    assert kwargs["company_id"] == company_id
    assert kwargs["employee_user_id"] == employee_id
    assert kwargs.get("payroll_week_start") is None
    assert kwargs["paid_at_from"] == datetime(2026, 5, 1, tzinfo=timezone.utc)
    assert kwargs["paid_at_before"] == datetime(2026, 6, 1, tzinfo=timezone.utc)


def test_payment_history_passes_week_start_to_repository() -> None:
    company_id = uuid.uuid4()
    employee_id = uuid.uuid4()
    week = date(2026, 5, 18)

    with (
        patch("app.modules.payroll.service._assert_valid_range_filter") as validate_filter,
        patch("app.modules.payroll.service.list_paid_items_for_company_payment_history", return_value=[]) as repo,
    ):
        list_payroll_payment_history(
            MagicMock(),
            _actor(),
            company_id=company_id,
            week_start=week,
            employee_user_id=employee_id,
        )

    validate_filter.assert_called_once()
    kwargs = repo.call_args.kwargs
    assert kwargs["company_id"] == company_id
    assert kwargs["employee_user_id"] == employee_id
    assert kwargs["payroll_week_start"] == week
    assert kwargs.get("paid_at_from") is None
    assert kwargs.get("paid_at_before") is None


def test_payment_history_week_start_ignores_date_range() -> None:
    company_id = uuid.uuid4()

    with (
        patch("app.modules.payroll.service._assert_valid_range_filter"),
        patch("app.modules.payroll.service.list_paid_items_for_company_payment_history", return_value=[]) as repo,
    ):
        list_payroll_payment_history(
            MagicMock(),
            _actor(),
            company_id=company_id,
            week_start=date(2026, 5, 18),
            date_from=date(2026, 5, 1),
            date_to=date(2026, 5, 31),
        )

    kwargs = repo.call_args.kwargs
    assert kwargs["payroll_week_start"] == date(2026, 5, 18)
    assert kwargs.get("paid_at_from") is None
    assert kwargs.get("paid_at_before") is None


def test_payment_history_includes_selected_payroll_week() -> None:
    company_id = uuid.uuid4()
    paid = _item(status="paid")
    period = SimpleNamespace(week_start=date(2026, 5, 18))

    with (
        patch(
            "app.modules.payroll.service.list_paid_items_for_company_payment_history",
            return_value=[(paid, period)],
        ),
        patch("app.modules.payroll.service._employee_display", return_value=("employee@example.com", "Employee", None)),
    ):
        rows = list_payroll_payment_history(
            MagicMock(),
            _actor(),
            company_id=company_id,
            week_start=date(2026, 5, 18),
        )

    assert len(rows) == 1
    assert rows[0].week_start == date(2026, 5, 18)
    assert rows[0].week_end == date(2026, 5, 24)


def test_payment_history_rejects_invalid_date_range() -> None:
    with pytest.raises(PayrollError, match="date_from"):
        list_payroll_payment_history(
            MagicMock(),
            _actor(),
            company_id=uuid.uuid4(),
            date_from=date(2026, 6, 1),
            date_to=date(2026, 5, 1),
        )


def test_company_admin_cannot_view_other_company_payment_history() -> None:
    with pytest.raises(PayrollPermissionError):
        list_payroll_payment_history(
            MagicMock(),
            _actor(uuid.uuid4()),
            company_id=uuid.uuid4(),
        )
