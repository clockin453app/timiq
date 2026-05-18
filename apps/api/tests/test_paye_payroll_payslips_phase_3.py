from __future__ import annotations

import uuid
from contextlib import ExitStack, contextmanager
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import get_authenticated_user
from app.modules.auth.models import SystemRole, User
from app.modules.paye_payroll.models import MonthlyPayeItem, MonthlyPayePeriod
from app.modules.paye_payroll.service import (
    PayePayrollPermissionError,
    render_monthly_paye_payslip_html,
    render_monthly_paye_payslip_pdf,
)


def _user(role: SystemRole, *, company_id: uuid.UUID | None = None) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id,
        email=f"{role.value}-{uuid.uuid4()}@example.com",
        password_hash="hashed",
        system_role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def _period(company_id: uuid.UUID) -> MonthlyPayePeriod:
    now = datetime.now(timezone.utc)
    return MonthlyPayePeriod(
        id=uuid.uuid4(),
        company_id=company_id,
        tax_year="2026-2027",
        tax_month=1,
        period_start=date(2026, 4, 6),
        period_end=date(2026, 5, 5),
        pay_date=date(2026, 5, 5),
        status="approved",
        created_at=now,
        updated_at=now,
    )


def _item(company_id: uuid.UUID, user_id: uuid.UUID, *, status: str = "approved", unsupported_reason: str | None = None) -> MonthlyPayeItem:
    now = datetime.now(timezone.utc)
    return MonthlyPayeItem(
        id=uuid.uuid4(),
        period_id=uuid.uuid4(),
        company_id=company_id,
        user_id=user_id,
        payroll_type="paye_employee",
        pay_frequency="monthly",
        salary_type="fixed_monthly_salary",
        monthly_salary=Decimal("3000"),
        tax_code="1257L",
        tax_basis="cumulative",
        ni_category="A",
        student_loan_plan="plan_2",
        postgraduate_loan=True,
        pension_enrolment_status="enrolled",
        employee_pension_percent=Decimal("5"),
        employer_pension_percent=Decimal("3"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="net_pay_arrangement",
        gross_pay=Decimal("3000"),
        taxable_pay=Decimal("2876"),
        niable_pay=Decimal("3000"),
        pensionable_pay=Decimal("2480"),
        paye_tax=Decimal("365.70"),
        employee_ni=Decimal("156.16"),
        employer_ni=Decimal("387.45"),
        employee_pension=Decimal("124.00"),
        employer_pension=Decimal("74.40"),
        student_loan=Decimal("49.00"),
        postgraduate_loan_deduction=Decimal("75.00"),
        other_deductions=Decimal("0"),
        additions=Decimal("0"),
        total_deductions=Decimal("769.86"),
        net_pay=Decimal("2230.14"),
        ytd_gross_pay=Decimal("3000"),
        ytd_taxable_pay=Decimal("2876"),
        ytd_paye_tax=Decimal("365.70"),
        ytd_employee_ni=Decimal("156.16"),
        ytd_employer_ni=Decimal("387.45"),
        ytd_employee_pension=Decimal("124.00"),
        ytd_employer_pension=Decimal("74.40"),
        ytd_student_loan=Decimal("49.00"),
        ytd_postgraduate_loan=Decimal("75.00"),
        ytd_net_pay=Decimal("2230.14"),
        status=status,
        calculation_snapshot={},
        unsupported_reason=unsupported_reason,
        created_at=now,
        updated_at=now,
    )


@contextmanager
def _patch_context(item: MonthlyPayeItem, period: MonthlyPayePeriod, owner: User):
    profile = SimpleNamespace(first_name="Ann", last_name="Example", national_insurance_number="QQ123456C")
    company = SimpleNamespace(id=item.company_id, name="Example Ltd")
    with ExitStack() as stack:
        stack.enter_context(patch("app.modules.paye_payroll.repository.get_monthly_item_by_id", return_value=item))
        stack.enter_context(patch("app.modules.paye_payroll.repository.get_monthly_period_by_id", return_value=period))
        stack.enter_context(patch("app.modules.paye_payroll.service.get_user_by_id", return_value=owner))
        stack.enter_context(patch("app.modules.paye_payroll.service.get_employee_profile_by_user_id", return_value=profile))
        stack.enter_context(patch("app.modules.paye_payroll.service.get_company_by_id", return_value=company))
        yield


def test_administrator_can_view_html_paye_payslip_for_approved_item() -> None:
    company_id = uuid.uuid4()
    owner = _user(SystemRole.EMPLOYEE, company_id=company_id)
    item = _item(company_id, owner.id)
    period = _period(company_id)
    item.period_id = period.id
    with _patch_context(item, period, owner):
        body = render_monthly_paye_payslip_html(MagicMock(), _user(SystemRole.ADMINISTRATOR), item.id)
    assert "Monthly PAYE Payslip" in body
    assert "PAYE tax" in body
    assert "National Insurance" in body
    assert "QQ123456C" in body
    assert "CIS" not in body
    assert "subcontractor" not in body.lower()


def test_administrator_can_download_paye_payslip_pdf() -> None:
    company_id = uuid.uuid4()
    owner = _user(SystemRole.EMPLOYEE, company_id=company_id)
    item = _item(company_id, owner.id)
    period = _period(company_id)
    item.period_id = period.id
    with _patch_context(item, period, owner):
        body, filename = render_monthly_paye_payslip_pdf(MagicMock(), _user(SystemRole.ADMINISTRATOR), item.id)
    assert body.startswith(b"%PDF")
    assert filename == "timiq-paye-payslip-2026-2027-month-01.pdf"
    assert b"CIS" not in body


def test_company_admin_can_view_own_company_item() -> None:
    company_id = uuid.uuid4()
    owner = _user(SystemRole.EMPLOYEE, company_id=company_id)
    item = _item(company_id, owner.id)
    period = _period(company_id)
    item.period_id = period.id
    with _patch_context(item, period, owner):
        body = render_monthly_paye_payslip_html(MagicMock(), _user(SystemRole.ADMIN, company_id=company_id), item.id)
    assert "Monthly PAYE Payslip" in body


def test_company_admin_cannot_view_another_company_item() -> None:
    item_company = uuid.uuid4()
    owner = _user(SystemRole.EMPLOYEE, company_id=item_company)
    item = _item(item_company, owner.id)
    period = _period(item_company)
    item.period_id = period.id
    with _patch_context(item, period, owner):
        try:
            render_monthly_paye_payslip_html(MagicMock(), _user(SystemRole.ADMIN, company_id=uuid.uuid4()), item.id)
            raise AssertionError("Expected company admin scope block")
        except PayePayrollPermissionError:
            pass


def test_employee_cannot_access_paye_payslip_endpoint() -> None:
    employee = _user(SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    client = TestClient(app)
    app.dependency_overrides[get_authenticated_user] = lambda: employee
    try:
        response = client.get(f"/api/paye-payroll/items/{uuid.uuid4()}/payslip")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_pending_and_unsupported_items_are_blocked() -> None:
    company_id = uuid.uuid4()
    owner = _user(SystemRole.EMPLOYEE, company_id=company_id)
    period = _period(company_id)
    for item in (
        _item(company_id, owner.id, status="pending"),
        _item(company_id, owner.id, unsupported_reason="Tax code BR is not supported."),
    ):
        item.period_id = period.id
        with _patch_context(item, period, owner):
            try:
                render_monthly_paye_payslip_html(MagicMock(), _user(SystemRole.ADMINISTRATOR), item.id)
                raise AssertionError("Expected payslip eligibility block")
            except PayePayrollPermissionError:
                pass


def test_pdf_endpoint_returns_application_pdf() -> None:
    admin = _user(SystemRole.ADMINISTRATOR)
    client = TestClient(app)
    app.dependency_overrides[get_authenticated_user] = lambda: admin
    try:
        with patch("app.modules.paye_payroll.router.render_monthly_paye_payslip_pdf", return_value=(b"%PDF-1.4\n", "test.pdf")):
            response = client.get(f"/api/paye-payroll/items/{uuid.uuid4()}/payslip.pdf")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert response.content.startswith(b"%PDF")
    finally:
        app.dependency_overrides.clear()
