"""Attendance notification settings permissions and schema tests."""

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.modules.attendance_notifications.models import AttendanceNotificationSettings
from app.modules.attendance_notifications.schemas import AttendanceNotificationSettingsPatchRequest
from app.modules.attendance_notifications.service import (
    AttendanceNotificationPermissionError,
    get_attendance_notification_settings,
)
from app.modules.auth.models import SystemRole


def _user(role: SystemRole, company_id: uuid.UUID | None = None) -> MagicMock:
    user = MagicMock()
    user.id = uuid.uuid4()
    user.system_role = role
    user.company_id = company_id
    return user


def _settings(company_id: uuid.UUID) -> AttendanceNotificationSettings:
    now = datetime.now(timezone.utc)
    return AttendanceNotificationSettings(
        id=uuid.uuid4(),
        company_id=company_id,
        late_arrival_enabled=False,
        late_arrival_grace_minutes=15,
        late_arrival_notify_employee=False,
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
        created_at=now,
        updated_at=now,
    )


def test_attendance_notification_settings_route_registered() -> None:
    paths = [getattr(r, "path", "") for r in app.routes if hasattr(r, "path")]
    assert "/api/attendance-notification-settings" in paths


def test_attendance_notification_settings_requires_authentication() -> None:
    client = TestClient(app)
    response = client.get("/api/attendance-notification-settings")
    assert response.status_code == 401


def test_company_admin_can_read_own_settings() -> None:
    cid = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, cid)
    session = MagicMock()
    with (
        patch("app.modules.attendance_notifications.service.get_company_by_id", return_value=MagicMock()),
        patch("app.modules.attendance_notifications.service.ensure_settings_row", return_value=_settings(cid)),
    ):
        response = get_attendance_notification_settings(session, actor, company_id=None)
    assert response.company_id == cid


def test_company_admin_cannot_read_other_company_settings() -> None:
    actor = _user(SystemRole.ADMIN, uuid.uuid4())
    with pytest.raises(AttendanceNotificationPermissionError):
        get_attendance_notification_settings(MagicMock(), actor, company_id=uuid.uuid4())


def test_administrator_requires_company_id() -> None:
    actor = _user(SystemRole.ADMINISTRATOR)
    with pytest.raises(AttendanceNotificationPermissionError):
        get_attendance_notification_settings(MagicMock(), actor, company_id=None)


def test_employee_cannot_read_company_attendance_settings() -> None:
    actor = _user(SystemRole.EMPLOYEE, uuid.uuid4())
    with pytest.raises(AttendanceNotificationPermissionError):
        get_attendance_notification_settings(MagicMock(), actor, company_id=None)


def test_patch_schema_rejects_bad_check_time() -> None:
    with pytest.raises(ValidationError):
        AttendanceNotificationSettingsPatchRequest(forgot_clock_in_check_time="25:99")


def test_patch_schema_accepts_weekdays() -> None:
    body = AttendanceNotificationSettingsPatchRequest(active_weekdays=[4, 0, 1])
    assert body.active_weekdays == [0, 1, 4]
