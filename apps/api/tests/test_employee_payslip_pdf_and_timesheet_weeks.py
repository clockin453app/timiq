"""Employee payslip PDF download and recent timesheet weeks."""

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
from app.modules.payroll.permissions import PayrollPermissionError
from app.modules.time_records.schemas import TimesheetWeekResponse
from app.modules.time_records.service import TimeRecordsPermissionError, list_my_recent_timesheet_weeks


def _user(*, role: SystemRole = SystemRole.EMPLOYEE, user_id: uuid.UUID | None = None) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=user_id or uuid.uuid4(),
        company_id=uuid.uuid4(),
        email="employee@example.com",
        password_hash="hashed",
        system_role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@patch("app.modules.payroll.router.render_payroll_item_payslip_pdf")
def test_employee_can_download_own_payslip_pdf(mock_render: MagicMock, client: TestClient) -> None:
    employee = _user()
    item_id = uuid.uuid4()
    mock_render.return_value = (b"%PDF-1.4 payslip", date(2026, 5, 11))
    app.dependency_overrides[require_authenticated_employee_self_service] = lambda: employee
    try:
        response = client.get(f"/api/payroll/items/{item_id}/payslip.pdf")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert "attachment" in response.headers.get("content-disposition", "")
        assert "timiq-payslip-week-2026-05-11.pdf" in response.headers.get("content-disposition", "")
        assert response.content.startswith(b"%PDF")
    finally:
        app.dependency_overrides.clear()


@patch("app.modules.payroll.router.render_payroll_item_payslip_pdf")
def test_employee_cannot_download_forbidden_payslip_pdf(mock_render: MagicMock, client: TestClient) -> None:
    employee = _user()
    mock_render.side_effect = PayrollPermissionError("You cannot view this payroll item.")
    app.dependency_overrides[require_authenticated_employee_self_service] = lambda: employee
    try:
        response = client.get(f"/api/payroll/items/{uuid.uuid4()}/payslip.pdf")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


@patch("app.modules.payroll.router.render_payroll_item_payslip_html")
def test_existing_html_payslip_still_works(mock_render: MagicMock, client: TestClient) -> None:
    employee = _user()
    mock_render.return_value = "<html>payslip</html>"
    app.dependency_overrides[require_authenticated_employee_self_service] = lambda: employee
    try:
        response = client.get(f"/api/payroll/items/{uuid.uuid4()}/payslip")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/html")
        assert b"payslip" in response.content
    finally:
        app.dependency_overrides.clear()


def test_recent_timesheet_weeks_requires_employee_role() -> None:
    with pytest.raises(TimeRecordsPermissionError):
        list_my_recent_timesheet_weeks(MagicMock(), _user(role=SystemRole.ADMIN), limit=12)


def test_recent_timesheet_weeks_returns_current_employee_weeks() -> None:
    employee = _user()
    db_session = MagicMock()
    db_session.execute.return_value.all.return_value = []

    week_response = TimesheetWeekResponse(
        week_start=date(2026, 5, 11),
        company_timezone="UTC",
        days=[],
        week_actual_seconds=3600,
        week_counted_seconds=3500,
        week_rounded_seconds=3600,
        week_break_seconds=100,
        open_shift_in_week=False,
        shift_count=1,
        completed_shift_count=1,
        open_shifts=[],
        locations_worked=[],
        week_leave=[],
    )

    with (
        patch("app.modules.time_records.service.ensure_company_time_policy", return_value=SimpleNamespace(timezone_name="UTC")),
        patch("app.modules.time_records.service.datetime") as mock_datetime,
        patch("app.modules.time_records.service.timesheet_week_for_user", return_value=week_response) as week_service,
    ):
        mock_datetime.now.return_value = datetime(2026, 5, 18, 12, 0, tzinfo=timezone.utc)
        mock_datetime.combine = datetime.combine
        rows = list_my_recent_timesheet_weeks(db_session, employee, limit=1)

    assert len(rows.weeks) == 1
    assert rows.weeks[0].week_start == date(2026, 5, 11)
    assert rows.weeks[0].has_completed_shifts is True
    kwargs = week_service.call_args.kwargs
    assert kwargs["subject_user_id"] == employee.id


@patch("app.modules.time_records.router.list_my_recent_timesheet_weeks")
def test_timesheet_weeks_endpoint_returns_recent_weeks(mock_list: MagicMock, client: TestClient) -> None:
    employee = _user()
    mock_list.return_value = {
        "weeks": [
            {
                "week_start": "2026-05-11",
                "week_end": "2026-05-17",
                "clocked_seconds": 3600,
                "payable_seconds": 3500,
                "payroll_seconds": 3600,
                "gross_amount": None,
                "paid_at": None,
                "status": "timesheet_completed",
                "has_completed_shifts": True,
            },
        ],
    }
    app.dependency_overrides[require_authenticated_employee_self_service] = lambda: employee
    try:
        response = client.get("/api/timesheets/me/weeks?limit=12")
        assert response.status_code == 200
        assert response.json()["weeks"][0]["week_start"] == "2026-05-11"
        assert mock_list.call_args.kwargs["limit"] == 12
    finally:
        app.dependency_overrides.clear()
