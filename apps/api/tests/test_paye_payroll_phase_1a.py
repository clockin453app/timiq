"""PAYE payroll Phase 1A settings and shell tests."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import get_authenticated_user
from app.modules.auth.models import SystemRole, User
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.employee_profiles.schemas import EmployeeProfileResponse, EmployeeProfileUpdateRequest
from app.modules.employee_profiles.service import update_profile_for_actor_or_user_id
from app.modules.payroll.calculation import compute_money_bundle
from app.modules.paye_payroll.schemas import (
    CompanyPayeSettingsPatchRequest,
    EmployeePayeSettingsPatchRequest,
)
from app.modules.paye_payroll.service import (
    PayePayrollPermissionError,
    monthly_paye_report_shell,
    patch_company_paye_settings,
    patch_employee_paye_settings,
    read_company_paye_settings,
    read_employee_paye_settings,
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


def test_employee_profile_response_defaults_to_cis_subcontractor() -> None:
    now = datetime.now(timezone.utc)
    response = EmployeeProfileResponse(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        first_name=None,
        last_name=None,
        phone=None,
        job_title=None,
        start_date=None,
        emergency_contact_name=None,
        emergency_contact_phone=None,
        is_onboarded=False,
        early_access_enabled=False,
        created_at=now,
        updated_at=now,
    )
    assert response.payroll_type == "cis_subcontractor"


def test_paye_employee_settings_can_be_saved_and_read_separately() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    target = _user(SystemRole.EMPLOYEE, company_id=company_id)
    db = MagicMock()
    db.get.return_value = None
    with (
        patch("app.modules.paye_payroll.service.get_user_by_id", return_value=target),
        patch("app.modules.paye_payroll.service.can_manage_user", return_value=True),
    ):
        saved = patch_employee_paye_settings(
            db,
            actor,
            target.id,
            EmployeePayeSettingsPatchRequest(
                salary_type="fixed_monthly_salary",
                monthly_salary=Decimal("2500.00"),
                tax_code="1257L",
                ni_category="A",
                student_loan_plan="plan_2",
                postgraduate_loan=True,
                employee_pension_percent=Decimal("5"),
                employer_pension_percent=Decimal("3"),
            ),
        )
    assert saved.user_id == target.id
    assert saved.company_id == company_id
    assert saved.salary_type == "fixed_monthly_salary"
    assert saved.monthly_salary == Decimal("2500.0000")
    assert saved.tax_code == "1257L"
    assert saved.ni_category == "A"
    assert saved.student_loan_plan == "plan_2"
    assert saved.postgraduate_loan is True


def test_company_paye_settings_can_be_saved_and_read_separately() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    db = MagicMock()
    db.get.return_value = None
    with patch("app.modules.paye_payroll.service.get_company_by_id", return_value=SimpleNamespace(id=company_id)):
        saved = patch_company_paye_settings(
            db,
            actor,
            CompanyPayeSettingsPatchRequest(
                company_id=company_id,
                paye_reference="123/AB456",
                accounts_office_reference="123PA00012345",
                pension_provider_name="Example Pension",
                default_employee_pension_percent=Decimal("5"),
                default_employer_pension_percent=Decimal("3"),
                default_tax_year="2026-2027",
            ),
        )
    assert saved.company_id == company_id
    assert saved.paye_reference == "123/AB456"
    assert saved.accounts_office_reference == "123PA00012345"
    assert saved.rti_status == "not_ready"


def test_administrator_can_read_company_paye_settings() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    db = MagicMock()
    db.get.return_value = None
    with patch("app.modules.paye_payroll.service.get_company_by_id", return_value=SimpleNamespace(id=company_id)):
        settings = read_company_paye_settings(db, actor, company_id)
    assert settings.company_id == company_id
    assert settings.rti_status == "not_ready"


def test_paye_settings_do_not_change_cis_money_calculation() -> None:
    out = compute_money_bundle(
        regular_seconds=3600,
        overtime_seconds=0,
        hourly_rate=Decimal("10.00"),
        overtime_multiplier=Decimal("1.5"),
        tax_rate_percent=Decimal("20"),
        other_deductions=Decimal("0"),
        payment_mode="net_payment",
    )
    assert out["gross_amount"] == Decimal("10.0000")
    assert out["tax_amount"] == Decimal("2.00")
    assert out["net_amount"] == Decimal("8.00")


def test_monthly_paye_report_shell_returns_not_enabled_state() -> None:
    company_id = uuid.uuid4()
    employee = _user(SystemRole.EMPLOYEE, company_id=company_id)
    profile = SimpleNamespace(first_name="Ann", last_name="Example", payroll_type="paye_employee")
    settings = SimpleNamespace(tax_code="1257L", ni_category="A")
    db = MagicMock()
    db.get.return_value = SimpleNamespace(company_id=company_id, paye_reference=None, accounts_office_reference=None, pension_provider_name=None)
    db.execute.return_value.all.return_value = [(employee, profile, settings)]
    actor = _user(SystemRole.ADMINISTRATOR)
    with patch("app.modules.paye_payroll.service.get_company_by_id", return_value=SimpleNamespace(id=company_id)):
        response = monthly_paye_report_shell(
            db,
            actor,
            company_id=company_id,
            year=2026,
            month=5,
            employee_user_id=None,
        )
    assert response.calculation_enabled is False
    assert "PAYE calculation engine is not enabled yet" in response.message
    assert response.rows[0].tax_code == "1257L"
    assert response.rows[0].status == "not_calculated"


def test_administrator_can_access_monthly_paye_report_shell() -> None:
    actor = _user(SystemRole.ADMINISTRATOR)
    client = TestClient(app)
    app.dependency_overrides[get_authenticated_user] = lambda: actor
    try:
        with patch("app.modules.paye_payroll.router.monthly_paye_report_shell") as shell:
            shell.return_value = {
                "company_id": str(uuid.uuid4()),
                "year": 2026,
                "month": 5,
                "calculation_enabled": False,
                "message": "PAYE calculation engine is not enabled yet. Configure employee and company PAYE settings first.",
                "company_settings_configured": False,
                "rows": [],
            }
            response = client.get(f"/api/paye-payroll/monthly-report?company_id={uuid.uuid4()}&year=2026&month=5")
        assert response.status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_company_admin_can_access_only_own_company_settings() -> None:
    own_company = uuid.uuid4()
    other_company = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, company_id=own_company)
    db = MagicMock()
    db.get.return_value = None
    with patch("app.modules.paye_payroll.service.get_company_by_id", return_value=SimpleNamespace(id=own_company)):
        own_read = read_company_paye_settings(db, actor, None)
        own = patch_company_paye_settings(
            db,
            actor,
            CompanyPayeSettingsPatchRequest(company_id=own_company, pension_provider_name="Own Pension"),
        )
    assert own_read.company_id == own_company
    assert own.company_id == own_company
    try:
        patch_company_paye_settings(
            db,
            actor,
            CompanyPayeSettingsPatchRequest(company_id=other_company, pension_provider_name="Other Pension"),
        )
        raise AssertionError("Expected permission error")
    except PayePayrollPermissionError:
        pass


def test_employee_cannot_access_admin_paye_report_or_settings() -> None:
    employee = _user(SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    client = TestClient(app)
    app.dependency_overrides[get_authenticated_user] = lambda: employee
    try:
        report = client.get("/api/paye-payroll/monthly-report?year=2026&month=5")
        settings = client.get(f"/api/paye-payroll/employee-settings/{employee.id}")
        company_settings = client.get("/api/paye-payroll/company-settings")
        patch_company = client.patch("/api/paye-payroll/company-settings", json={"paye_reference": "123/AB456"})
        assert report.status_code == 403
        assert settings.status_code == 403
        assert company_settings.status_code == 403
        assert patch_company.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_paye_employee_keeps_same_company_assignment_when_profile_type_changes() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    target = _user(SystemRole.EMPLOYEE, company_id=company_id)
    profile = EmployeeProfile(user_id=target.id, company_id=company_id, payroll_type="cis_subcontractor")
    with (
        patch("app.modules.employee_profiles.service.get_user_by_id", return_value=target),
        patch("app.modules.employee_profiles.service.get_or_create_profile_for_user", return_value=profile),
        patch("app.modules.employee_profiles.service.can_manage_user", return_value=True),
        patch("app.modules.employee_profiles.service.update_employee_profile", side_effect=lambda _db, p: p),
    ):
        updated = update_profile_for_actor_or_user_id(
            MagicMock(),
            actor,
            EmployeeProfileUpdateRequest(payroll_type="paye_employee"),
            user_id=target.id,
        )
    assert updated.payroll_type == "paye_employee"
    assert updated.company_id == company_id
