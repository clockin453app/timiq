import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field


class AttendanceTrendPoint(BaseModel):
    date: str = Field(description="Local calendar date (ISO) for the company timezone.")
    present_count: int
    total_employees: int
    attendance_rate: float | None = None


class PayrollTrendPoint(BaseModel):
    week_start: str
    total_gross: float
    total_hours_seconds: int


class ActivityFeedItem(BaseModel):
    occurred_at: datetime
    summary: str
    detail: str | None = None


class ManagementSummaryResponse(BaseModel):
    generated_at: datetime
    company_id: uuid.UUID | None = None
    aggregated_companies: bool = False

    active_employee_count: int
    active_location_count: int
    active_workplace_count: int

    live_open_shifts: int
    live_total_employees: int
    live_present_today: int
    live_attendance_rate: float | None = None

    payroll_week_start: date | None = None
    payroll_week_end: date | None = None
    payroll_status: str = "not_calculated"
    payroll_total_gross: float | None = None
    payroll_total_hours_seconds: int = 0
    payroll_message: str | None = None


class OverviewResponse(ManagementSummaryResponse):
    attendance_trend: list[AttendanceTrendPoint] = Field(default_factory=list)
    payroll_trend: list[PayrollTrendPoint] = Field(default_factory=list)
    recent_activity: list[ActivityFeedItem] = Field(default_factory=list)
