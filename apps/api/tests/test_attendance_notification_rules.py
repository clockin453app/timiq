"""Attendance notification job unit checks."""

import uuid
from datetime import timedelta

from app.modules.attendance_notifications.models import AttendanceNotificationSettings
from app.modules.attendance_notifications.service import _forgot_clock_out_dedupe_key


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
