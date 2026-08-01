"""Schemas for payable timesheet hours adjustments."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ExtraHoursReason = Literal[
    "shift_correction",
    "saturday_bonus_hour",
    "training",
    "travel",
    "goodwill_adjustment",
    "other",
]

EXTRA_HOURS_REASONS: tuple[str, ...] = (
    "shift_correction",
    "saturday_bonus_hour",
    "training",
    "travel",
    "goodwill_adjustment",
    "other",
)


class TimesheetExtraHoursCreate(BaseModel):
    """Create body. Clients cannot set affects_payroll; service forces payable=true."""

    model_config = ConfigDict(extra="forbid")

    company_id: uuid.UUID | None = None
    user_id: uuid.UUID
    work_date: date
    duration_minutes: int = Field(..., ge=1, le=24 * 60)
    reason: ExtraHoursReason
    note: str | None = Field(default=None, max_length=500)
    location_id: uuid.UUID | None = None

    @field_validator("note")
    @classmethod
    def strip_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None


class TimesheetExtraHoursPatch(BaseModel):
    """Patch body. Clients cannot set affects_payroll or money fields."""

    model_config = ConfigDict(extra="forbid")

    work_date: date | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=24 * 60)
    reason: ExtraHoursReason | None = None
    note: str | None = Field(default=None, max_length=500)
    location_id: uuid.UUID | None = None

    @field_validator("note")
    @classmethod
    def strip_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None


class TimesheetExtraHoursResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    user_id: uuid.UUID
    work_date: date
    duration_minutes: int
    reason: ExtraHoursReason
    note: str | None
    location_id: uuid.UUID | None
    affects_payroll: bool = True
    created_by_user_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
    employee_name: str | None = None
    employee_email: str | None = None
    location_name: str | None = None
    created_by_name: str | None = None
    created_by_email: str | None = None
