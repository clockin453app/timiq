"""Tests for non-payroll timesheet extra hours."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from app.modules.auth.models import SystemRole, User
from app.modules.timesheet_extra_hours.models import TimesheetExtraHours
from app.modules.timesheet_extra_hours.repository import sum_duration_minutes
from app.modules.timesheet_extra_hours.schemas import TimesheetExtraHoursCreate, TimesheetExtraHoursPatch
from app.modules.timesheet_extra_hours.service import (
    ExtraHoursError,
    ExtraHoursPermissionError,
    create_extra_hours,
    delete_extra_hours,
    list_extra_hours_for_me,
    patch_extra_hours,
)


def _user(role: SystemRole, company_id: uuid.UUID | None, user_id: uuid.UUID | None = None) -> User:
    u = MagicMock(spec=User)
    u.system_role = role
    u.company_id = company_id
    u.id = user_id or uuid.uuid4()
    u.email = f"{u.id}@example.com"
    return u


def test_schema_rejects_zero_and_negative_duration() -> None:
    with pytest.raises(ValidationError):
        TimesheetExtraHoursCreate(
            user_id=uuid.uuid4(),
            work_date=date(2026, 8, 1),
            duration_minutes=0,
            reason="training",
        )
    with pytest.raises(ValidationError):
        TimesheetExtraHoursCreate(
            user_id=uuid.uuid4(),
            work_date=date(2026, 8, 1),
            duration_minutes=-15,
            reason="training",
        )
    with pytest.raises(ValidationError):
        TimesheetExtraHoursPatch(duration_minutes=0)


def test_schema_accepts_positive_duration() -> None:
    body = TimesheetExtraHoursCreate(
        user_id=uuid.uuid4(),
        work_date=date(2026, 8, 1),
        duration_minutes=60,
        reason="saturday_bonus_hour",
        note="  bonus  ",
    )
    assert body.duration_minutes == 60
    assert body.note == "bonus"


def test_employee_cannot_create() -> None:
    db = MagicMock()
    emp = _user(SystemRole.EMPLOYEE, uuid.uuid4())
    body = TimesheetExtraHoursCreate(
        user_id=emp.id,
        work_date=date(2026, 8, 1),
        duration_minutes=60,
        reason="training",
    )
    with pytest.raises(ExtraHoursPermissionError):
        create_extra_hours(db, emp, body)


def test_employee_cannot_patch_or_delete() -> None:
    db = MagicMock()
    emp = _user(SystemRole.EMPLOYEE, uuid.uuid4())
    with pytest.raises(ExtraHoursPermissionError):
        patch_extra_hours(db, emp, uuid.uuid4(), TimesheetExtraHoursPatch(duration_minutes=30))
    with pytest.raises(ExtraHoursPermissionError):
        delete_extra_hours(db, emp, uuid.uuid4())


def test_admin_can_create(monkeypatch: pytest.MonkeyPatch) -> None:
    db = MagicMock()
    company_id = uuid.uuid4()
    admin = _user(SystemRole.ADMIN, company_id)
    employee_id = uuid.uuid4()
    employee = _user(SystemRole.EMPLOYEE, company_id, employee_id)
    body = TimesheetExtraHoursCreate(
        user_id=employee_id,
        work_date=date(2026, 8, 1),
        duration_minutes=60,
        reason="saturday_bonus_hour",
    )

    saved = TimesheetExtraHours(
        id=uuid.uuid4(),
        company_id=company_id,
        user_id=employee_id,
        work_date=body.work_date,
        duration_minutes=60,
        reason=body.reason,
        note=None,
        location_id=None,
        affects_payroll=True,
        created_by_user_id=admin.id,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    with (
        patch("app.modules.timesheet_extra_hours.service.resolve_operational_company_id", return_value=company_id),
        patch("app.modules.timesheet_extra_hours.service.get_user_by_id", return_value=employee),
        patch("app.modules.timesheet_extra_hours.service.repo.add", return_value=saved) as add_mock,
        patch("app.modules.timesheet_extra_hours.service.create_internal_audit_event") as audit_mock,
        patch("app.modules.timesheet_extra_hours.service.get_employee_profile_by_user_id", return_value=None),
        patch("app.modules.timesheet_extra_hours.service.get_period_by_company_week", return_value=None),
        patch("app.modules.timesheet_extra_hours.service.mark_payroll_period_needs_recalculation"),
    ):
        result = create_extra_hours(db, admin, body)

    assert result.duration_minutes == 60
    assert result.affects_payroll is True
    assert result.reason == "saturday_bonus_hour"
    add_mock.assert_called_once()
    audit_mock.assert_called_once()
    assert audit_mock.call_args.kwargs["action"] == "timesheet_extra_hours.created"
    assert audit_mock.call_args.kwargs["details"]["affects_payroll"] is True


def test_company_isolation_for_admin() -> None:
    db = MagicMock()
    company_a = uuid.uuid4()
    company_b = uuid.uuid4()
    admin = _user(SystemRole.ADMIN, company_a)
    other_employee = _user(SystemRole.EMPLOYEE, company_b)
    body = TimesheetExtraHoursCreate(
        company_id=company_b,
        user_id=other_employee.id,
        work_date=date(2026, 8, 1),
        duration_minutes=30,
        reason="training",
    )
    with (
        patch(
            "app.modules.timesheet_extra_hours.service.resolve_operational_company_id",
            side_effect=ExtraHoursPermissionError("You cannot access another company's data."),
        ),
    ):
        # Service wraps CompanyScopeError; simulate permission path via resolve raising Permission-like
        with pytest.raises(ExtraHoursPermissionError):
            # Force CompanyScopeError path
            from app.core.company_scope import CompanyScopeError

            with patch(
                "app.modules.timesheet_extra_hours.service.resolve_operational_company_id",
                side_effect=CompanyScopeError("You cannot access another company's data."),
            ):
                create_extra_hours(db, admin, body)


def test_employee_list_me_scoped_to_self() -> None:
    db = MagicMock()
    company_id = uuid.uuid4()
    emp = _user(SystemRole.EMPLOYEE, company_id)
    with patch("app.modules.timesheet_extra_hours.service.repo.list_entries", return_value=[]) as list_mock:
        list_extra_hours_for_me(db, emp, start_date=date(2026, 8, 1), end_date=date(2026, 8, 7))
    list_mock.assert_called_once()
    kwargs = list_mock.call_args.kwargs
    assert kwargs["company_id"] == company_id
    assert kwargs["user_id"] == emp.id


def test_sum_duration_minutes_multiple_entries() -> None:
    rows = [
        MagicMock(duration_minutes=60, deleted_at=None),
        MagicMock(duration_minutes=90, deleted_at=None),
        MagicMock(duration_minutes=30, deleted_at=datetime.now(timezone.utc)),
    ]
    assert sum_duration_minutes(rows) == 150


def test_service_marks_stale_without_recalculating_or_writing_money() -> None:
    service_path = Path(__file__).resolve().parents[1] / "app" / "modules" / "timesheet_extra_hours" / "service.py"
    source = service_path.read_text(encoding="utf-8")
    assert "recalculate_payroll" not in source
    assert "compute_money_bundle" not in source
    assert "TimeShift" not in source
    assert "admin_manual_service" not in source
    assert "mark_payroll_period_needs_recalculation" in source


def test_create_does_not_call_recalculate_payroll() -> None:
    db = MagicMock()
    company_id = uuid.uuid4()
    admin = _user(SystemRole.ADMIN, company_id)
    employee_id = uuid.uuid4()
    employee = _user(SystemRole.EMPLOYEE, company_id, employee_id)
    body = TimesheetExtraHoursCreate(
        user_id=employee_id,
        work_date=date(2026, 8, 1),
        duration_minutes=45,
        reason="goodwill_adjustment",
    )
    saved = TimesheetExtraHours(
        id=uuid.uuid4(),
        company_id=company_id,
        user_id=employee_id,
        work_date=body.work_date,
        duration_minutes=45,
        reason=body.reason,
        note=None,
        location_id=None,
        affects_payroll=True,
        created_by_user_id=admin.id,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    with (
        patch("app.modules.timesheet_extra_hours.service.resolve_operational_company_id", return_value=company_id),
        patch("app.modules.timesheet_extra_hours.service.get_user_by_id", return_value=employee),
        patch("app.modules.timesheet_extra_hours.service.repo.add", return_value=saved),
        patch("app.modules.timesheet_extra_hours.service.create_internal_audit_event"),
        patch("app.modules.timesheet_extra_hours.service.get_employee_profile_by_user_id", return_value=None),
        patch("app.modules.timesheet_extra_hours.service.get_period_by_company_week", return_value=None),
        patch("app.modules.timesheet_extra_hours.service.mark_payroll_period_needs_recalculation") as mark,
        patch("app.modules.payroll.service.recalculate_payroll") as recalc,
    ):
        create_extra_hours(db, admin, body)
        recalc.assert_not_called()
        mark.assert_called_once()


def test_delete_soft_deletes_and_marks_stale_for_payable() -> None:
    db = MagicMock()
    company_id = uuid.uuid4()
    admin = _user(SystemRole.ADMIN, company_id)
    entry_id = uuid.uuid4()
    row = TimesheetExtraHours(
        id=entry_id,
        company_id=company_id,
        user_id=uuid.uuid4(),
        work_date=date(2026, 8, 1),
        duration_minutes=60,
        reason="training",
        note=None,
        location_id=None,
        affects_payroll=True,
        created_by_user_id=admin.id,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    with (
        patch("app.modules.timesheet_extra_hours.service.repo.get_by_id", return_value=row),
        patch("app.modules.timesheet_extra_hours.service.resolve_operational_company_id", return_value=company_id),
        patch("app.modules.timesheet_extra_hours.service.repo.soft_delete", return_value=row) as soft,
        patch("app.modules.timesheet_extra_hours.service.create_internal_audit_event"),
        patch("app.modules.timesheet_extra_hours.service.get_period_by_company_week", return_value=None),
        patch("app.modules.timesheet_extra_hours.service.mark_payroll_period_needs_recalculation") as mark,
        patch("app.modules.payroll.service.recalculate_payroll") as recalc,
    ):
        delete_extra_hours(db, admin, entry_id)
        soft.assert_called_once()
        recalc.assert_not_called()
        mark.assert_called_once()


def test_affects_payroll_true_on_create_row() -> None:
    db = MagicMock()
    company_id = uuid.uuid4()
    admin = _user(SystemRole.ADMIN, company_id)
    employee_id = uuid.uuid4()
    employee = _user(SystemRole.EMPLOYEE, company_id, employee_id)
    body = TimesheetExtraHoursCreate(
        user_id=employee_id,
        work_date=date(2026, 8, 1),
        duration_minutes=15,
        reason="other",
    )

    captured: dict = {}

    def _add(_db, row):
        captured["affects_payroll"] = row.affects_payroll
        row.id = uuid.uuid4()
        row.created_at = datetime.now(timezone.utc)
        row.updated_at = datetime.now(timezone.utc)
        return row

    with (
        patch("app.modules.timesheet_extra_hours.service.resolve_operational_company_id", return_value=company_id),
        patch("app.modules.timesheet_extra_hours.service.get_user_by_id", return_value=employee),
        patch("app.modules.timesheet_extra_hours.service.repo.add", side_effect=_add),
        patch("app.modules.timesheet_extra_hours.service.create_internal_audit_event"),
        patch("app.modules.timesheet_extra_hours.service.get_employee_profile_by_user_id", return_value=None),
        patch("app.modules.timesheet_extra_hours.service.get_period_by_company_week", return_value=None),
        patch("app.modules.timesheet_extra_hours.service.mark_payroll_period_needs_recalculation"),
    ):
        create_extra_hours(db, admin, body)
    assert captured["affects_payroll"] is True
