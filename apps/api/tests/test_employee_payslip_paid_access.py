"""Employee CIS payslips and Pay History release only after payroll is paid."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import require_authenticated_employee_self_service
from app.modules.auth.models import SystemRole, User
from app.modules.payroll.models import PayrollItem
from app.modules.payroll.permissions import PayrollPermissionError, assert_actor_can_view_payroll_item
from app.modules.payroll.service import list_my_pay_history


def _user(
    *,
    role: SystemRole = SystemRole.EMPLOYEE,
    user_id: uuid.UUID | None = None,
    company_id: uuid.UUID | None = None,
) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=user_id or uuid.uuid4(),
        company_id=company_id or uuid.uuid4(),
        email=f"{role.value}@example.com",
        password_hash="hashed",
        system_role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def _item(
    *,
    user_id: uuid.UUID,
    status: str,
    company_id: uuid.UUID | None = None,
) -> PayrollItem:
    now = datetime.now(timezone.utc)
    return PayrollItem(
        id=uuid.uuid4(),
        period_id=uuid.uuid4(),
        company_id=company_id or uuid.uuid4(),
        user_id=user_id,
        status=status,
        approved_at=now if status in ("approved", "paid") else None,
        paid_at=now if status == "paid" else None,
        created_at=now,
        updated_at=now,
    )


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_employee_cannot_view_pending_or_approved_payslip_item() -> None:
    employee = _user()
    owner = employee
    for status in ("pending", "approved"):
        with pytest.raises(PayrollPermissionError, match="not available"):
            assert_actor_can_view_payroll_item(employee, _item(user_id=employee.id, status=status), owner)


def test_employee_can_view_own_paid_payslip_item() -> None:
    employee = _user()
    assert_actor_can_view_payroll_item(
        employee,
        _item(user_id=employee.id, status="paid"),
        employee,
    )


def test_employee_cannot_view_other_employee_paid_payslip() -> None:
    employee_a = _user()
    employee_b = _user()
    with pytest.raises(PayrollPermissionError, match="cannot view"):
        assert_actor_can_view_payroll_item(
            employee_a,
            _item(user_id=employee_b.id, status="paid"),
            employee_b,
        )


def test_admin_can_preview_approved_item_in_scope() -> None:
    company_id = uuid.uuid4()
    admin = _user(role=SystemRole.ADMIN, company_id=company_id)
    owner = _user(company_id=company_id)
    item = _item(user_id=owner.id, status="approved", company_id=company_id)
    with patch("app.modules.payroll.permissions.can_manage_user", return_value=True):
        assert_actor_can_view_payroll_item(admin, item, owner)


def test_admin_cannot_preview_out_of_scope_item() -> None:
    admin = _user(role=SystemRole.ADMIN)
    owner = _user()
    item = _item(user_id=owner.id, status="approved")
    with patch("app.modules.payroll.permissions.can_manage_user", return_value=False):
        with pytest.raises(PayrollPermissionError, match="cannot view"):
            assert_actor_can_view_payroll_item(admin, item, owner)


def test_administrator_can_preview_approved_item() -> None:
    administrator = _user(role=SystemRole.ADMINISTRATOR)
    owner = _user()
    assert_actor_can_view_payroll_item(
        administrator,
        _item(user_id=owner.id, status="approved"),
        owner,
    )


def test_pay_history_lists_paid_only_and_sets_can_open_payslip() -> None:
    employee = _user()
    paid = SimpleNamespace(
        id=uuid.uuid4(),
        user_id=employee.id,
        company_id=uuid.uuid4(),
        period_id=uuid.uuid4(),
        status="paid",
        approved_at=datetime.now(timezone.utc),
        paid_at=datetime.now(timezone.utc),
        regular_seconds=3600,
        overtime_seconds=0,
        rounded_total_seconds=3600,
        gross_amount=100,
        tax_amount=20,
        net_amount=80,
        display_tax_amount=None,
        display_net_amount=None,
        other_deductions_amount=0,
        rate_missing=False,
        payment_mode="net_payment",
    )
    period = SimpleNamespace(week_start=date(2026, 8, 3), timezone_name="Europe/London")
    db = MagicMock()
    db.get.return_value = period

    with (
        patch(
            "app.modules.payroll.service.list_items_for_user_pay_history",
            return_value=[paid],
        ) as repo,
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(name="Acme")),
        patch("app.modules.payroll.service._effective_tax_amount_for_item", return_value=None),
        patch("app.modules.payroll.service._effective_net_amount_for_item", return_value=None),
        patch("app.modules.payroll.service._decimal_or_none", side_effect=lambda v: v),
    ):
        rows = list_my_pay_history(db, employee)

    repo.assert_called_once_with(db, employee.id)
    assert len(rows) == 1
    assert rows[0].id == paid.id
    assert rows[0].status == "paid"
    assert rows[0].can_open_payslip is True


def test_pay_history_repo_excludes_approved_from_filter_clause() -> None:
    """Repository query must constrain status == paid (not approved)."""
    from app.modules.payroll import repository as payroll_repo

    db = MagicMock()
    db.scalars.return_value.all.return_value = []
    payroll_repo.list_items_for_user_pay_history(db, uuid.uuid4())
    statement = db.scalars.call_args.args[0]
    compiled = statement.compile(compile_kwargs={"literal_binds": True})
    sql = str(compiled).lower()
    assert "status" in sql and "'paid'" in sql
    assert "'approved'" not in sql


@patch("app.modules.payroll.router.render_payroll_item_payslip_pdf")
def test_approved_payslip_pdf_denied_for_employee(mock_render: MagicMock, client: TestClient) -> None:
    employee = _user()
    mock_render.side_effect = PayrollPermissionError("This payroll item is not available.")
    app.dependency_overrides[require_authenticated_employee_self_service] = lambda: employee
    try:
        response = client.get(f"/api/payroll/items/{uuid.uuid4()}/payslip.pdf")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


@patch("app.modules.payroll.router.get_payroll_item_summary")
def test_approved_summary_denied_for_employee(mock_summary: MagicMock, client: TestClient) -> None:
    employee = _user()
    mock_summary.side_effect = PayrollPermissionError("This payroll item is not available.")
    app.dependency_overrides[require_authenticated_employee_self_service] = lambda: employee
    try:
        response = client.get(f"/api/payroll/items/{uuid.uuid4()}/summary")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


@patch("app.modules.payroll.router.list_my_pay_history")
def test_pay_history_endpoint_returns_paid_rows(mock_list: MagicMock, client: TestClient) -> None:
    employee = _user()
    mock_list.return_value = []
    app.dependency_overrides[require_authenticated_employee_self_service] = lambda: employee
    try:
        response = client.get("/api/payroll/pay-history/me")
        assert response.status_code == 200
        assert response.json() == []
        mock_list.assert_called_once()
    finally:
        app.dependency_overrides.clear()


def test_unauthenticated_payslip_rejected(client: TestClient) -> None:
    response = client.get(f"/api/payroll/items/{uuid.uuid4()}/payslip.pdf")
    assert response.status_code in (401, 403)
