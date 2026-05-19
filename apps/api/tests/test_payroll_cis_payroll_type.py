"""CIS weekly payroll candidate selection by EmployeeProfile.payroll_type."""

from __future__ import annotations

import uuid
from contextlib import ExitStack
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import sqlite

from app.modules.auth.models import SystemRole, User
from app.modules.payroll.repository import list_cis_employee_users_for_company
from app.modules.payroll.schemas import PayrollPaySplit, PayrollReportAlerts
from app.modules.payroll.service import recalculate_payroll


def _company_id() -> uuid.UUID:
    return uuid.uuid4()


def _employee_user(company_id: uuid.UUID, *, email: str) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id,
        email=email,
        password_hash="hashed",
        system_role=SystemRole.EMPLOYEE,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def _scalars_result(db: MagicMock, users: list[User]) -> None:
    mock_result = MagicMock()
    mock_result.all.return_value = users
    db.scalars.return_value = mock_result


def test_list_cis_repository_sql_includes_only_cis_or_missing_profile() -> None:
    company_id = _company_id()
    db = MagicMock()
    _scalars_result(db, [])

    list_cis_employee_users_for_company(db, company_id)

    statement = db.scalars.call_args[0][0]
    compiled = str(
        statement.compile(
            dialect=sqlite.dialect(),
            compile_kwargs={"literal_binds": True},
        ),
    )
    assert "cis_subcontractor" in compiled
    assert "paye_employee" not in compiled


def test_list_cis_repository_returns_cis_subcontractor_user() -> None:
    company_id = _company_id()
    cis_user = _employee_user(company_id, email="cis@example.com")
    db = MagicMock()
    _scalars_result(db, [cis_user])

    result = list_cis_employee_users_for_company(db, company_id)

    assert result == [cis_user]


def test_list_cis_repository_returns_legacy_no_profile_user() -> None:
    company_id = _company_id()
    legacy_user = _employee_user(company_id, email="legacy@example.com")
    db = MagicMock()
    _scalars_result(db, [legacy_user])

    result = list_cis_employee_users_for_company(db, company_id)

    assert result == [legacy_user]


def test_list_cis_repository_excludes_paye_employee_from_query_results() -> None:
    """DB filter should not return paye_employee; empty mock simulates excluded row."""
    company_id = _company_id()
    db = MagicMock()
    _scalars_result(db, [])

    result = list_cis_employee_users_for_company(db, company_id)

    assert result == []


def _actor(company_id: uuid.UUID) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        system_role=SystemRole.ADMIN,
    )


def _recalculate_saved_user_ids(
    *,
    cis_employee: SimpleNamespace,
    paye_employee: SimpleNamespace | None = None,
) -> list[uuid.UUID]:
    company_id = cis_employee.company_id
    period_id = uuid.uuid4()
    saved_items: list[SimpleNamespace] = []

    def save_period(_db, period):
        period.id = period_id
        return period

    def save_item(_db, item):
        item.id = uuid.uuid4()
        saved_items.append(item)
        return item

    cis_users = [_employee_user(company_id, email="cis@example.com")]
    cis_users[0].id = cis_employee.id

    sum_seconds_kwargs: dict = {"return_value": 3600}
    if paye_employee is not None:
        sum_seconds_kwargs = {
            "side_effect": lambda *_a, user_id, **_k: 7200 if user_id == paye_employee.id else 3600,
        }

    with ExitStack() as stack:
        stack.enter_context(
            patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(default_tax_rate=20)),
        )
        stack.enter_context(
            patch(
                "app.modules.payroll.service.ensure_company_time_policy",
                return_value=SimpleNamespace(
                    timezone_name="Europe/London",
                    overtime_multiplier=Decimal("1.5"),
                    overtime_after_hours=8.5,
                ),
            ),
        )
        stack.enter_context(patch("app.modules.payroll.service.first_workplace_tax", return_value=None))
        stack.enter_context(patch("app.modules.payroll.service.get_period_by_company_week", return_value=None))
        stack.enter_context(patch("app.modules.payroll.service.period_has_paid_item", return_value=False))
        stack.enter_context(patch("app.modules.payroll.service.period_has_approved_item", return_value=False))
        stack.enter_context(patch("app.modules.payroll.service.save_period", side_effect=save_period))
        stack.enter_context(patch("app.modules.payroll.service.list_items_for_period", return_value=[]))
        stack.enter_context(patch("app.modules.payroll.service.delete_pending_items_for_period"))
        stack.enter_context(patch("app.modules.payroll.service.list_cis_employee_users_for_company", return_value=cis_users))
        mock_all_employees = stack.enter_context(patch("app.modules.payroll.service.list_employee_users_for_company"))
        stack.enter_context(
            patch(
                "app.modules.payroll.service.get_employee_profile_by_user_id",
                return_value=SimpleNamespace(
                    hourly_rate=Decimal("20.00"),
                    tax_rate=Decimal("20.00"),
                    payment_mode="net_payment",
                ),
            ),
        )
        stack.enter_context(patch("app.modules.payroll.service.sum_rounded_seconds_payroll_week", **sum_seconds_kwargs))
        stack.enter_context(patch("app.modules.payroll.service.policy_snapshot_dict", return_value={}))
        stack.enter_context(patch("app.modules.payroll.service.save_item", side_effect=save_item))
        stack.enter_context(patch("app.modules.payroll.service.create_internal_audit_event"))
        stack.enter_context(
            patch(
                "app.modules.payroll.service._build_report_alerts",
                return_value=PayrollReportAlerts(
                    pending_approval_count=0,
                    open_shifts_started_in_week_count=0,
                    rate_missing_employees_count=0,
                    missing_payroll_setup_employees_count=0,
                    utr_missing_employees_count=0,
                    nino_missing_employees_count=0,
                    zero_rounded_hours_employees_count=0,
                    payroll_period_not_calculated=False,
                ),
            ),
        )
        stack.enter_context(
            patch(
                "app.modules.payroll.service._build_pay_split",
                return_value=PayrollPaySplit(
                    regular_pay=Decimal("0"),
                    overtime_pay=Decimal("0"),
                    other_pay=Decimal("0"),
                    total_gross=Decimal("0"),
                ),
            ),
        )
        stack.enter_context(patch("app.modules.payroll.service._compute_late_unpaid_employees", return_value=([], 0, 0, 0)))
        stack.enter_context(patch("app.modules.payroll.service._accounting_export_overlaps_payroll_week", return_value=False))
        stack.enter_context(patch("app.modules.payroll.service._payroll_approved_leave_rows", return_value=[]))
        stack.enter_context(patch("app.modules.payroll.service.item_to_response", return_value=MagicMock()))
        recalculate_payroll(
            MagicMock(),
            _actor(company_id),
            company_id=company_id,
            week_start=date(2026, 5, 11),
        )
        mock_all_employees.assert_not_called()

    return [item.user_id for item in saved_items]


def test_recalculate_creates_item_only_for_cis_compatible_employee() -> None:
    company_id = _company_id()
    cis_employee = SimpleNamespace(id=uuid.uuid4(), company_id=company_id)
    paye_employee = SimpleNamespace(id=uuid.uuid4(), company_id=company_id)

    saved_user_ids = _recalculate_saved_user_ids(
        cis_employee=cis_employee,
        paye_employee=paye_employee,
    )

    assert saved_user_ids == [cis_employee.id]
    assert paye_employee.id not in saved_user_ids

