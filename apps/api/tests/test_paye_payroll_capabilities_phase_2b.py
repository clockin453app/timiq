from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import get_authenticated_user
from app.modules.auth.models import SystemRole, User
from app.modules.paye_payroll.capabilities import list_paye_capabilities
from app.modules.paye_payroll.service import read_paye_capabilities


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


def test_capability_catalog_has_stable_phase_2b_keys() -> None:
    keys = {capability.key for capability in list_paye_capabilities()}
    assert "tax_codes.numeric_l" in keys
    assert "ni.category_a" in keys
    assert "pay_type.fixed_monthly_salary" in keys
    assert "pension.salary_sacrifice" in keys
    assert "reporting.rti_fps_eps" in keys


def test_phase_2a_capabilities_are_enabled() -> None:
    capabilities = {capability.key: capability for capability in list_paye_capabilities()}
    for key in {
        "tax_codes.numeric_l",
        "tax_basis.cumulative",
        "tax_basis.month1",
        "ni.category_a",
        "pay_type.fixed_monthly_salary",
        "pay_type.hourly",
        "pay_type.overtime",
        "pension.qualifying_earnings",
        "pension.total_earnings",
        "pension.relief_at_source",
        "pension.net_pay_arrangement",
        "loans.student_plan_1",
        "loans.student_plan_2",
        "loans.student_plan_4",
        "loans.student_plan_5",
        "loans.postgraduate",
        "ytd.paye_items_only",
    }:
        assert capabilities[key].status == "enabled"
        assert capabilities[key].tax_years_supported == ("2026-2027",)


def test_unsupported_capabilities_are_not_marked_enabled() -> None:
    capabilities = {capability.key: capability for capability in list_paye_capabilities()}
    for key in {
        "tax_codes.br",
        "tax_codes.d0",
        "tax_codes.k",
        "tax_codes.scottish_s",
        "tax_codes.welsh_c",
        "ni.category_b",
        "ni.freeport",
        "ni.investment_zone",
        "pension.salary_sacrifice",
        "statutory_pay.ssp",
        "deductions.attachment_of_earnings",
        "benefits.payrolled_benefits",
        "reporting.rti_fps_eps",
    }:
        assert capabilities[key].status != "enabled"
        assert capabilities[key].unsupported_message


def test_admin_can_read_capabilities_grouped_by_category() -> None:
    response = read_paye_capabilities(_user(SystemRole.ADMIN, company_id=uuid.uuid4()))
    categories = {category.category for category in response.categories}
    assert response.tax_year == "2026-2027"
    assert "tax_codes" in categories
    assert "national_insurance" in categories
    assert "reporting" in categories


def test_employee_cannot_access_capabilities_endpoint() -> None:
    employee = _user(SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    client = TestClient(app)
    app.dependency_overrides[get_authenticated_user] = lambda: employee
    try:
        response = client.get("/api/paye-payroll/capabilities")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_admin_can_access_capabilities_endpoint() -> None:
    admin = _user(SystemRole.ADMIN, company_id=uuid.uuid4())
    client = TestClient(app)
    app.dependency_overrides[get_authenticated_user] = lambda: admin
    try:
        response = client.get("/api/paye-payroll/capabilities")
        assert response.status_code == 200
        body = response.json()
        assert body["tax_year"] == "2026-2027"
        assert any(category["category"] == "tax_codes" for category in body["categories"])
    finally:
        app.dependency_overrides.clear()
