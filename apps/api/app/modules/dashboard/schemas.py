import uuid
from datetime import date, datetime
from typing import Literal

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


class NeedsAttentionItem(BaseModel):
    """Single actionable row for the Needs Attention panel (count > 0 when shown)."""

    code: str
    label: str
    count: int
    severity: Literal["info", "warning", "critical"]
    href: str


class TodayLiveRow(BaseModel):
    display_name: str
    email: str | None = None
    location_name: str | None = None
    clock_in_at: datetime
    running_seconds: int
    href: str = "/live-attendance"


class PayrollReadinessPanel(BaseModel):
    payroll_status: str
    week_start: date | None = None
    week_end: date | None = None
    total_items: int
    pending_count: int
    approved_count: int
    paid_count: int
    rate_missing_count: int
    payroll_period_not_calculated: bool
    payroll_needs_recalculation: bool
    open_shifts_started_in_week_count: int
    total_gross: float | None = None
    total_hours_seconds: int = 0
    href: str = "/payroll-report"
    scope_note: str | None = None


class SetupHealthPanel(BaseModel):
    active_employee_count: int
    active_location_count: int
    active_workplace_count: int
    employees_missing_hourly_rate_count: int
    employees_without_site_access_count: int
    time_policy_row_present: bool = True
    time_policy_configured: bool
    scope_note: str | None = None


class OverviewResponse(ManagementSummaryResponse):
    attendance_trend: list[AttendanceTrendPoint] = Field(default_factory=list)
    payroll_trend: list[PayrollTrendPoint] = Field(default_factory=list)
    recent_activity: list[ActivityFeedItem] = Field(default_factory=list)

    long_open_shift_threshold_hours: int = Field(
        default=12,
        description="UTC elapsed hours since clock-in; open shifts at or beyond this appear in Needs Attention.",
    )
    needs_attention: list[NeedsAttentionItem] = Field(default_factory=list)
    needs_attention_scope_note: str | None = None
    today_live: list[TodayLiveRow] = Field(default_factory=list)
    payroll_readiness: PayrollReadinessPanel | None = None
    setup_health: SetupHealthPanel | None = None
