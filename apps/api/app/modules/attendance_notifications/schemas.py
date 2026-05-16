from __future__ import annotations

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

_HHMM = re.compile(r"^\d{2}:\d{2}$")
_WEEKDAYS = frozenset(range(7))


def _validate_hhmm(value: str) -> str:
    clean = value.strip()
    if not _HHMM.match(clean):
        raise ValueError("Time must be HH:MM.")
    hour, minute = int(clean[:2]), int(clean[3:])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError("Time must be HH:MM.")
    return f"{hour:02d}:{minute:02d}"


def _validate_weekdays(value: list[int]) -> list[int]:
    days = sorted(set(int(v) for v in value))
    if not days:
        raise ValueError("At least one active weekday is required.")
    if any(day not in _WEEKDAYS for day in days):
        raise ValueError("Weekdays must be integers from 0 (Monday) to 6 (Sunday).")
    return days


class AttendanceNotificationSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    company_id: uuid.UUID
    late_arrival_enabled: bool
    late_arrival_grace_minutes: int
    late_arrival_notify_employee: bool
    late_arrival_notify_admins: bool
    forgot_clock_in_enabled: bool
    forgot_clock_in_check_time: str
    forgot_clock_in_notify_employee: bool
    forgot_clock_in_notify_admins: bool
    forgot_clock_out_enabled: bool
    forgot_clock_out_threshold_hours: int
    forgot_clock_out_repeat_hours: int | None
    forgot_clock_out_notify_employee: bool
    forgot_clock_out_notify_admins: bool
    ignore_approved_leave: bool
    active_weekdays: list[int]
    created_at: datetime
    updated_at: datetime


class AttendanceNotificationSettingsPatchRequest(BaseModel):
    late_arrival_enabled: bool | None = None
    late_arrival_grace_minutes: int | None = Field(default=None, ge=0, le=240)
    late_arrival_notify_employee: bool | None = None
    late_arrival_notify_admins: bool | None = None
    forgot_clock_in_enabled: bool | None = None
    forgot_clock_in_check_time: str | None = None
    forgot_clock_in_notify_employee: bool | None = None
    forgot_clock_in_notify_admins: bool | None = None
    forgot_clock_out_enabled: bool | None = None
    forgot_clock_out_threshold_hours: int | None = Field(default=None, ge=1, le=48)
    forgot_clock_out_repeat_hours: int | None = Field(default=None, ge=1, le=48)
    forgot_clock_out_notify_employee: bool | None = None
    forgot_clock_out_notify_admins: bool | None = None
    ignore_approved_leave: bool | None = None
    active_weekdays: list[int] | None = None

    @field_validator("forgot_clock_in_check_time")
    @classmethod
    def _check_time(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _validate_hhmm(value)

    @field_validator("active_weekdays")
    @classmethod
    def _weekdays(cls, value: list[int] | None) -> list[int] | None:
        if value is None:
            return None
        return _validate_weekdays(value)
