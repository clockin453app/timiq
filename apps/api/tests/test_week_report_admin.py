"""Admin week report scope and export permissions (mocked database)."""

import uuid
from datetime import date
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole, User
from app.modules.time_records.schemas import (
    AdminWeekReportAllEmployeesResponse,
    AdminWeekReportCompanyTotals,
    AdminWeekReportEmployeeSummary,
)
from app.modules.time_records.service import (
    TimeRecordsPermissionError,
    _resolve_timesheet_company_scope,
    export_admin_employee_week_report_csv,
)


def _user(role: SystemRole, company_id: uuid.UUID | None, user_id: uuid.UUID | None = None) -> User:
    u = MagicMock(spec=User)
    u.system_role = role
    u.company_id = company_id
    u.id = user_id or uuid.uuid4()
    return u


def test_employee_cannot_resolve_timesheet_company_scope() -> None:
    db = MagicMock()
    emp = _user(SystemRole.EMPLOYEE, uuid.uuid4())
    with pytest.raises(TimeRecordsPermissionError, match="cannot view"):
        _resolve_timesheet_company_scope(db, emp, None)


def test_admin_cannot_view_other_company() -> None:
    db = MagicMock()
    own = uuid.uuid4()
    other = uuid.uuid4()
    admin = _user(SystemRole.ADMIN, own)
    with pytest.raises(TimeRecordsPermissionError, match="another company"):
        _resolve_timesheet_company_scope(db, admin, other)


def test_administrator_requires_company_id() -> None:
    db = MagicMock()
    admin = _user(SystemRole.ADMINISTRATOR, None)
    with pytest.raises(TimeRecordsPermissionError, match="company_id is required"):
        _resolve_timesheet_company_scope(db, admin, None)


def test_export_employee_week_report_denied_wrong_company() -> None:
    db = MagicMock()
    cid = uuid.uuid4()
    other_cid = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, cid)
    subject_id = uuid.uuid4()
    subject = MagicMock(spec=User)
    subject.id = subject_id
    subject.company_id = other_cid

    with patch("app.modules.time_records.service.get_user_by_id", return_value=subject):
        with patch(
            "app.modules.time_records.service.can_view_time_record_shift_owner",
            return_value=True,
        ):
            with patch(
                "app.modules.time_records.service._resolve_timesheet_company_scope",
                return_value=cid,
            ):
                with pytest.raises(TimeRecordsPermissionError, match="not in this company"):
                    export_admin_employee_week_report_csv(
                        db,
                        actor,
                        subject_user_id=subject_id,
                        week_start=date(2026, 5, 11),
                        company_id=None,
                    )


def test_export_employee_week_report_writes_single_row() -> None:
    db = MagicMock()
    cid = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, cid)
    subject_id = uuid.uuid4()
    subject = MagicMock(spec=User)
    subject.id = subject_id
    subject.company_id = cid

    emp_summary = AdminWeekReportEmployeeSummary(
        user_id=subject_id,
        employee_name="Alex",
        employee_email="alex@example.com",
        completed_shifts_count=2,
        clocked_seconds=7200,
        payable_seconds=7000,
        payroll_seconds=6900,
        break_seconds=1800,
        locations_worked=["Site A"],
        open_shift_in_week=False,
    )
    report = AdminWeekReportAllEmployeesResponse(
        week_start=date(2026, 5, 11),
        company_id=cid,
        company_timezone="Europe/London",
        employees=[emp_summary],
        totals=AdminWeekReportCompanyTotals(completed_shifts_count=2),
    )

    with patch("app.modules.time_records.service.get_user_by_id", return_value=subject):
        with patch(
            "app.modules.time_records.service.can_view_time_record_shift_owner",
            return_value=True,
        ):
            with patch(
                "app.modules.time_records.service._resolve_timesheet_company_scope",
                return_value=cid,
            ):
                with patch(
                    "app.modules.time_records.service.week_report_all_employees_for_company",
                    return_value=report,
                ):
                    with patch(
                        "app.modules.time_records.service.create_internal_audit_event",
                    ):
                        body, fname = export_admin_employee_week_report_csv(
                            db,
                            actor,
                            subject_user_id=subject_id,
                            week_start=date(2026, 5, 11),
                            company_id=None,
                        )

    assert "alex@example.com" in body
    assert "Site A" in body
    assert fname.endswith(".csv")
    assert body.count("\n") == 2
