import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.modules.leave.schemas import WeekLeaveRow


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
    break_deducted_seconds: int = 0
    actual_seconds: int | None = None
    running_actual_seconds: int | None = None
    counted_clock_in_at: datetime
    counted_clock_out_at: datetime | None = None
    counted_seconds: int | None = None
    rounded_seconds: int | None = None
    time_policy_source: str = "company"
    face_check_status: str | None = None
    face_match_confidence: float | None = None
    face_check_reason: str | None = None


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
    week_leave: list[WeekLeaveRow] = Field(default_factory=list)


class AdminTimesheetEmployeeDayRow(BaseModel):
    """One calendar day per employee (company timezone) with completed-shift aggregates."""

    user_id: uuid.UUID
    employee_name: str | None = None
    employee_email: str
    employee_job_title: str | None = None
    date: date
    clocked_seconds: int = 0
    payable_seconds: int = 0
    payroll_seconds: int = 0
    break_seconds: int = 0
    locations: list[str] = Field(default_factory=list)
    completed_shifts_count: int = 0


class AdminTimesheetOpenShiftRow(BaseModel):
    user_id: uuid.UUID
    employee_name: str | None = None
    employee_email: str
    employee_job_title: str | None = None
    shift_id: uuid.UUID
    clock_in_at: datetime
    location_id: uuid.UUID
    location_name: str
    running_actual_seconds: int | None = None
    break_seconds: int = 0


class AdminTimesheetWeekAllEmployeesResponse(BaseModel):
    week_start: date
    company_id: uuid.UUID
    company_timezone: str
    day_rows: list[AdminTimesheetEmployeeDayRow]
    open_shifts: list[AdminTimesheetOpenShiftRow] = Field(default_factory=list)
    week_clocked_seconds: int = 0
    week_payable_seconds: int = 0
    week_payroll_seconds: int = 0
    week_break_seconds: int = 0
    completed_shift_count: int = 0


class AdminWeekReportEmployeeSummary(BaseModel):
    user_id: uuid.UUID
    employee_name: str | None = None
    employee_email: str
    employee_job_title: str | None = None
    completed_shifts_count: int = 0
    clocked_seconds: int = 0
    payable_seconds: int = 0
    payroll_seconds: int = 0
    break_seconds: int = 0
    locations_worked: list[str] = Field(default_factory=list)
    open_shift_in_week: bool = False
    week_leave: list[WeekLeaveRow] = Field(default_factory=list)


class AdminWeekReportCompanyTotals(BaseModel):
    completed_shifts_count: int = 0
    clocked_seconds: int = 0
    payable_seconds: int = 0
    payroll_seconds: int = 0
    break_seconds: int = 0
    employees_with_open_shift: int = 0


class AdminWeekReportAllEmployeesResponse(BaseModel):
    week_start: date
    company_id: uuid.UUID
    company_timezone: str
    employees: list[AdminWeekReportEmployeeSummary]
    totals: AdminWeekReportCompanyTotals


class AdminCreateCompletedShiftRequest(BaseModel):
    user_id: uuid.UUID
    location_id: uuid.UUID
    clock_in_at: datetime
    clock_out_at: datetime
    break_seconds: int | None = Field(default=None, ge=0)
    break_minutes: int | None = Field(default=None, ge=0)
    reason: str = Field(..., min_length=1, max_length=2000)


class AdminPatchCompletedShiftRequest(BaseModel):
    clock_in_at: datetime | None = None
    clock_out_at: datetime | None = None
    location_id: uuid.UUID | None = None
    break_seconds: int | None = Field(default=None, ge=0)
    break_minutes: int | None = Field(default=None, ge=0)
    reason: str = Field(..., min_length=1, max_length=2000)


class AdminForceClockOutRequest(BaseModel):
    clock_out_at: datetime
    break_seconds: int | None = Field(default=None, ge=0)
    break_minutes: int | None = Field(default=None, ge=0)
    reason: str = Field(..., min_length=1, max_length=2000)


class AdminManualShiftMutationResponse(BaseModel):
    shift: TimeRecordShiftRow
    payroll_recalculation_required: bool
    affected_week_start: date | None = None
    affected_company_id: uuid.UUID
