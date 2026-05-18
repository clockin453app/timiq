"""Attendance notification job unit checks."""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.modules.attendance_notifications.models import AttendanceNotificationSettings
from app.modules.attendance_notifications.service import _forgot_clock_out_dedupe_key, run_attendance_notification_check_once
from app.modules.auth.models import SystemRole


def _settings(repeat_hours: int | None) -> AttendanceNotificationSettings:
    return AttendanceNotificationSettings(
        company_id=uuid.uuid4(),
        forgot_clock_out_threshold_hours=12,
        forgot_clock_out_repeat_hours=repeat_hours,
    )


def test_forgot_clock_out_dedupe_key_without_repeat_is_shift_scoped() -> None:
    employee_id = uuid.uuid4()
    shift_id = uuid.uuid4()
    key = _forgot_clock_out_dedupe_key(
        settings=_settings(None),
        employee_id=employee_id,
        shift_id=shift_id,
        elapsed=timedelta(hours=20),
    )
    assert key.endswith(f"{employee_id}:{shift_id}")
    assert ":repeat:" not in key


def test_forgot_clock_out_dedupe_key_uses_repeat_bucket() -> None:
    employee_id = uuid.uuid4()
    shift_id = uuid.uuid4()
    key = _forgot_clock_out_dedupe_key(
        settings=_settings(2),
        employee_id=employee_id,
        shift_id=shift_id,
        elapsed=timedelta(hours=17),
    )
    assert key.endswith(":repeat:2")


def _user(company_id: uuid.UUID, role: SystemRole = SystemRole.EMPLOYEE) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        company_id=company_id,
        system_role=role,
        email=f"{role.value}-{uuid.uuid4()}@example.com",
        is_active=True,
    )


def _base_settings(company_id: uuid.UUID) -> AttendanceNotificationSettings:
    return AttendanceNotificationSettings(
        company_id=company_id,
        late_arrival_enabled=False,
        late_arrival_grace_minutes=15,
        late_arrival_notify_employee=True,
        late_arrival_notify_admins=True,
        forgot_clock_in_enabled=False,
        forgot_clock_in_check_time="09:30",
        forgot_clock_in_notify_employee=True,
        forgot_clock_in_notify_admins=True,
        forgot_clock_out_enabled=False,
        forgot_clock_out_threshold_hours=12,
        forgot_clock_out_repeat_hours=None,
        forgot_clock_out_notify_employee=True,
        forgot_clock_out_notify_admins=True,
        ignore_approved_leave=True,
        active_weekdays=[0, 1, 2, 3, 4],
    )


def _run_with_settings(settings: AttendanceNotificationSettings, *, employee: SimpleNamespace | None = None, admin: SimpleNamespace | None = None, open_shift=None, approved_leave=False):
    company_id = settings.company_id
    employee = employee or _user(company_id)
    admin = admin or _user(company_id, SystemRole.ADMIN)
    created: list[dict] = []

    def create_record(_db, **kwargs):
        created.append(kwargs)
        return True

    with (
        patch("app.modules.attendance_notifications.service.list_active_enabled_settings", return_value=[settings]),
        patch(
            "app.modules.attendance_notifications.service.ensure_company_time_policy",
            return_value=SimpleNamespace(timezone_name="UTC", standard_start_time="09:00"),
        ),
        patch("app.modules.attendance_notifications.service.list_active_company_employees", return_value=[(employee, None)]),
        patch("app.modules.attendance_notifications.service.list_active_company_admins", return_value=[admin]),
        patch("app.modules.attendance_notifications.service.list_active_assigned_locations_with_policy", return_value=[]),
        patch("app.modules.attendance_notifications.service.user_has_clock_in_between", return_value=False),
        patch("app.modules.attendance_notifications.service.has_approved_leave_on_date", return_value=approved_leave),
        patch("app.modules.attendance_notifications.service.list_open_shifts_for_company", return_value=open_shift or []),
        patch("app.modules.attendance_notifications.service.create_notification_record_once", side_effect=create_record),
    ):
        result = run_attendance_notification_check_once(
            MagicMock(),
            now_utc=datetime(2026, 5, 18, 10, 0, tzinfo=timezone.utc),
        )
    return created, result


def test_late_arrival_creates_internal_notification() -> None:
    settings = _base_settings(uuid.uuid4())
    settings.late_arrival_enabled = True
    created, result = _run_with_settings(settings)

    assert result.notifications_created == 2
    assert {row["kind"] for row in created} == {"attendance_late_arrival"}


def test_forgot_clock_in_creates_internal_notification() -> None:
    settings = _base_settings(uuid.uuid4())
    settings.forgot_clock_in_enabled = True
    created, result = _run_with_settings(settings)

    assert result.notifications_created == 2
    assert {row["kind"] for row in created} == {"attendance_forgot_clock_in"}


def test_forgot_clock_out_creates_internal_notification() -> None:
    company_id = uuid.uuid4()
    employee = _user(company_id)
    settings = _base_settings(company_id)
    settings.forgot_clock_out_enabled = True
    shift = SimpleNamespace(
        id=uuid.uuid4(),
        clock_in_at=datetime(2026, 5, 17, 20, 0, tzinfo=timezone.utc),
    )
    created, result = _run_with_settings(settings, employee=employee, open_shift=[(shift, employee, None)])

    assert result.notifications_created == 2
    assert {row["kind"] for row in created} == {"attendance_forgot_clock_out"}


def test_notify_employee_false_suppresses_employee_target() -> None:
    company_id = uuid.uuid4()
    employee = _user(company_id)
    admin = _user(company_id, SystemRole.ADMIN)
    settings = _base_settings(company_id)
    settings.late_arrival_enabled = True
    settings.late_arrival_notify_employee = False
    settings.late_arrival_notify_admins = True
    created, _result = _run_with_settings(settings, employee=employee, admin=admin)

    assert {row["recipient_user_id"] for row in created} == {admin.id}


def test_notify_company_admins_false_suppresses_admin_target() -> None:
    company_id = uuid.uuid4()
    employee = _user(company_id)
    admin = _user(company_id, SystemRole.ADMIN)
    settings = _base_settings(company_id)
    settings.late_arrival_enabled = True
    settings.late_arrival_notify_employee = True
    settings.late_arrival_notify_admins = False
    created, _result = _run_with_settings(settings, employee=employee, admin=admin)

    assert {row["recipient_user_id"] for row in created} == {employee.id}


def test_approved_leave_suppresses_late_and_forgot_in_when_enabled() -> None:
    settings = _base_settings(uuid.uuid4())
    settings.late_arrival_enabled = True
    settings.forgot_clock_in_enabled = True
    settings.ignore_approved_leave = True
    created, result = _run_with_settings(settings, approved_leave=True)

    assert created == []
    assert result.notifications_created == 0
