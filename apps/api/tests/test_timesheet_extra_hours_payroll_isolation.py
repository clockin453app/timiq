"""Secondary mock checks for Extra hours (not primary payroll isolation proof)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.modules.auth.models import SystemRole, User
from app.modules.timesheet_extra_hours.repository import list_entries as repo_list_entries
from app.modules.timesheet_extra_hours.router import router as extra_hours_router
from app.modules.timesheet_extra_hours.schemas import TimesheetExtraHoursCreate, TimesheetExtraHoursPatch
from app.modules.timesheet_extra_hours.service import (
    ExtraHoursPermissionError,
    create_extra_hours,
    delete_extra_hours,
    list_extra_hours_for_admin,
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


def _saved_row(*, company_id, user_id, admin_id, minutes=60, reason="saturday_bonus_hour"):
    return SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        user_id=user_id,
        work_date=date(2026, 8, 1),
        duration_minutes=minutes,
        reason=reason,
        note=None,
        location_id=None,
        affects_payroll=False,
        created_by_user_id=admin_id,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        deleted_at=None,
    )


def test_create_update_delete_do_not_call_payroll_mutators() -> None:
    """Secondary guard: Extra hours service never invokes payroll mutators."""
    db = MagicMock()
    company_id = uuid.uuid4()
    admin = _user(SystemRole.ADMIN, company_id)
    employee_id = uuid.uuid4()
    employee = _user(SystemRole.EMPLOYEE, company_id, employee_id)
    saved = _saved_row(company_id=company_id, user_id=employee_id, admin_id=admin.id)
    body = TimesheetExtraHoursCreate(
        user_id=employee_id,
        work_date=date(2026, 8, 1),
        duration_minutes=60,
        reason="saturday_bonus_hour",
    )
    with (
        patch("app.modules.timesheet_extra_hours.service.resolve_operational_company_id", return_value=company_id),
        patch("app.modules.timesheet_extra_hours.service.get_user_by_id", return_value=employee),
        patch("app.modules.timesheet_extra_hours.service.repo.add", return_value=saved),
        patch("app.modules.timesheet_extra_hours.service.repo.get_by_id", return_value=saved),
        patch("app.modules.timesheet_extra_hours.service.repo.save", return_value=saved),
        patch("app.modules.timesheet_extra_hours.service.repo.soft_delete", return_value=saved),
        patch("app.modules.timesheet_extra_hours.service.create_internal_audit_event"),
        patch("app.modules.timesheet_extra_hours.service.get_employee_profile_by_user_id", return_value=None),
        patch("app.modules.payroll.service.recalculate_payroll") as recalc,
        patch("app.modules.payroll.service.approve_item") as approve,
        patch("app.modules.payroll.service.approve_all_pending") as approve_all,
    ):
        create_extra_hours(db, admin, body)
        patch_extra_hours(db, admin, saved.id, TimesheetExtraHoursPatch(duration_minutes=90))
        delete_extra_hours(db, admin, saved.id)
        recalc.assert_not_called()
        approve.assert_not_called()
        approve_all.assert_not_called()


def test_schema_forbids_affects_payroll_and_overflow() -> None:
    with pytest.raises(ValidationError):
        TimesheetExtraHoursCreate.model_validate(
            {
                "user_id": str(uuid.uuid4()),
                "work_date": "2026-08-01",
                "duration_minutes": 60,
                "reason": "training",
                "affects_payroll": True,
            }
        )
    with pytest.raises(ValidationError):
        TimesheetExtraHoursCreate(
            user_id=uuid.uuid4(),
            work_date=date(2026, 8, 1),
            duration_minutes=24 * 60 + 1,
            reason="training",
        )


def test_exclusive_end_date_filter_sql_contract() -> None:
    import inspect
    from app.modules.timesheet_extra_hours import repository as repo

    source = inspect.getsource(repo.list_entries)
    assert "work_date < end_date" in source
    assert "work_date <= end_date" not in source


def test_soft_deleted_excluded_from_list_default() -> None:
    source = __import__("inspect").getsource(repo_list_entries)
    assert "deleted_at.is_(None)" in source


def test_employee_cannot_list_admin_endpoint_logic() -> None:
    db = MagicMock()
    emp = _user(SystemRole.EMPLOYEE, uuid.uuid4())
    with pytest.raises(ExtraHoursPermissionError):
        list_extra_hours_for_admin(db, emp, company_id=emp.company_id)


def test_employee_me_cannot_see_other_user_rows() -> None:
    db = MagicMock()
    company_id = uuid.uuid4()
    emp = _user(SystemRole.EMPLOYEE, company_id)
    with patch("app.modules.timesheet_extra_hours.service.repo.list_entries", return_value=[]) as list_mock:
        list_extra_hours_for_me(db, emp)
    assert list_mock.call_args.kwargs["user_id"] == emp.id


def test_delete_http_204_empty_body() -> None:
    app = FastAPI()
    app.include_router(extra_hours_router)
    entry_id = uuid.uuid4()
    admin = _user(SystemRole.ADMIN, uuid.uuid4())

    from app.db.session import get_db_session
    from app.modules.auth.dependencies import get_current_user, require_admin_or_administrator

    app.dependency_overrides[require_admin_or_administrator] = lambda: admin
    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_db_session] = lambda: MagicMock()

    with patch("app.modules.timesheet_extra_hours.router.delete_extra_hours") as delete_mock:
        client = TestClient(app)
        response = client.delete(f"/api/timesheet-extra-hours/{entry_id}")
        assert response.status_code == 204
        assert response.content == b""
        delete_mock.assert_called_once()


def test_repository_flush_only_no_commit() -> None:
    import inspect
    from app.modules.timesheet_extra_hours import repository as repo

    add_src = inspect.getsource(repo.add)
    save_src = inspect.getsource(repo.save)
    assert "flush()" in add_src and "commit()" not in add_src
    assert "flush()" in save_src and "commit()" not in save_src
