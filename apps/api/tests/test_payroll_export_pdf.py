"""Payroll report PDF export permissions and response headers."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import SystemRole, User
from app.modules.payroll.pdf_export import build_payroll_report_pdf
from app.modules.payroll.permissions import PayrollPermissionError
from app.modules.payroll.schemas import PayrollPaySplit, PayrollPeriodSummary, PayrollReportAlerts, PayrollReportResponse
from app.modules.payroll.service import export_pdf_report


def _user(*, role: SystemRole, company_id: uuid.UUID | None = None) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id,
        email="user@example.com",
        password_hash="hashed",
        system_role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_build_payroll_report_pdf_returns_pdf_bytes() -> None:
    body = build_payroll_report_pdf(
        company_name="Acme Ltd",
        week_start=date(2025, 1, 6),
        week_end=date(2025, 1, 12),
        timezone_name="Europe/London",
        rows=[],
        total_hours_seconds=0,
        total_gross=None,
        total_cis_tax=None,
        total_net=None,
        alert_lines=["Payroll not calculated for this week yet."],
    )
    assert body.startswith(b"%PDF")
    assert len(body) > 200


def test_admin_cannot_export_other_company_pdf() -> None:
    own_company = uuid.uuid4()
    other_company = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=own_company)
    with pytest.raises(PayrollPermissionError):
        export_pdf_report(
            None,  # type: ignore[arg-type]
            actor,
            company_id=other_company,
            week_start=date(2025, 1, 6),
        )


@patch("app.modules.payroll.router.export_pdf_report")
def test_export_pdf_response_headers(mock_export: object, client: TestClient) -> None:
    company_id = uuid.uuid4()
    admin = _user(role=SystemRole.ADMIN, company_id=company_id)
    mock_export.return_value = b"%PDF-1.4 payroll"  # type: ignore[attr-defined]

    app.dependency_overrides[require_admin_or_administrator] = lambda: admin
    try:
        response = client.get(
            f"/api/payroll/export.pdf?company_id={company_id}&week_start=2025-01-06",
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        disposition = response.headers.get("content-disposition", "")
        assert "attachment" in disposition
        assert "timiq-payroll-report-2025-01-06.pdf" in disposition
        assert len(response.content) > 0
        assert response.content.startswith(b"%PDF")
    finally:
        app.dependency_overrides.clear()


def test_employee_cannot_access_payroll_export_pdf(client: TestClient) -> None:
    employee = _user(role=SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    app.dependency_overrides[require_admin_or_administrator] = lambda: employee
    try:
        response = client.get(
            f"/api/payroll/export.pdf?company_id={employee.company_id}&week_start=2025-01-06",
        )
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_administrator_export_pdf_requires_company_id(client: TestClient) -> None:
    admin = _user(role=SystemRole.ADMINISTRATOR, company_id=None)
    app.dependency_overrides[require_admin_or_administrator] = lambda: admin
    try:
        response = client.get("/api/payroll/export.pdf?week_start=2025-01-06")
        assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()


@patch("app.modules.payroll.service.get_payroll_report")
@patch("app.modules.payroll.service.get_company_by_id")
@patch("app.modules.payroll.service.create_internal_audit_event")
def test_export_pdf_report_company_admin_own_company(
    mock_audit: object,
    mock_company: object,
    mock_report: object,
) -> None:
    company_id = uuid.uuid4()
    actor = _user(role=SystemRole.ADMIN, company_id=company_id)
    mock_company.return_value = SimpleNamespace(name="Own Co")  # type: ignore[attr-defined]
    empty_period = PayrollPeriodSummary(
        id=uuid.uuid4(),
        company_id=company_id,
        week_start=date(2025, 1, 6),
        timezone_name="UTC",
        calculated_at=None,
        calculated_by_user_id=None,
        total_items=0,
        pending_count=0,
        approved_count=0,
        paid_count=0,
        total_regular_seconds=0,
        total_overtime_seconds=0,
        total_rounded_seconds=0,
        total_gross=None,
        total_tax=None,
        total_net=None,
        total_other_deductions=Decimal(0),
    )
    mock_report.return_value = PayrollReportResponse(  # type: ignore[attr-defined]
        period=empty_period,
        items=[],
        alerts=PayrollReportAlerts(
            pending_approval_count=0,
            open_shifts_started_in_week_count=0,
            rate_missing_employees_count=0,
            zero_rounded_hours_employees_count=0,
            payroll_period_not_calculated=True,
        ),
        split=PayrollPaySplit(
            regular_pay=Decimal(0),
            overtime_pay=Decimal(0),
            other_pay=Decimal(0),
            total_gross=None,
        ),
    )
    body = export_pdf_report(
        None,  # type: ignore[arg-type]
        actor,
        company_id=company_id,
        week_start=date(2025, 1, 6),
    )
    assert body.startswith(b"%PDF")
    assert len(body) > 100
