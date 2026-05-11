import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class TimeRecordShiftRow(BaseModel):
    shift_id: uuid.UUID
    user_id: uuid.UUID
    status: str
    location_id: uuid.UUID
    location_name: str
    company_id: uuid.UUID | None = None
    company_name: str | None = None
    employee_email: str | None = None
    employee_name: str | None = None
    employee_job_title: str | None = None
    clock_in_at: datetime
    clock_out_at: datetime | None
    break_seconds: int
    actual_seconds: int | None = None
    running_actual_seconds: int | None = None
    counted_clock_in_at: datetime
    counted_clock_out_at: datetime | None = None
    counted_seconds: int | None = None
    rounded_seconds: int | None = None


class TimeRecordQueryParams(BaseModel):
    """Parsed query helpers (built in service)."""

    start_utc: datetime | None = None
    end_utc: datetime | None = None
    location_id: uuid.UUID | None = None
    status: Literal["open", "completed"] | None = None
    user_id: uuid.UUID | None = None
    company_id: uuid.UUID | None = None


class TimesheetDayTotals(BaseModel):
    date: date
    actual_seconds: int = 0
    counted_seconds: int = 0
    rounded_seconds: int = 0
    break_seconds: int = 0


class TimesheetOpenShiftSummary(BaseModel):
    shift_id: uuid.UUID
    clock_in_at: datetime
    location_id: uuid.UUID
    location_name: str
    running_actual_seconds: int | None = None
    break_seconds: int = 0


class TimesheetWeekResponse(BaseModel):
    week_start: date
    company_timezone: str
    days: list[TimesheetDayTotals]
    week_actual_seconds: int
    week_counted_seconds: int
    week_rounded_seconds: int
    week_break_seconds: int
    open_shift_in_week: bool
    shift_count: int = 0
    completed_shift_count: int = 0
    open_shifts: list[TimesheetOpenShiftSummary] = Field(default_factory=list)
    locations_worked: list[str] = Field(default_factory=list)
