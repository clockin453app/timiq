from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

LeaveType = Literal["annual_leave", "sick_leave", "unpaid_leave", "other"]
LeaveStatus = Literal["pending", "approved", "rejected", "cancelled"]
HalfDay = Literal["morning", "afternoon"]


class LeavePolicyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    company_id: uuid.UUID
    annual_leave_year_start_month: int
    annual_leave_year_start_day: int
    default_annual_allowance_days: Decimal | None
    allow_half_days: bool
    paid_annual_leave: bool
    paid_sick_leave: bool
    sick_leave_requires_note: bool


class LeavePolicyPatchRequest(BaseModel):
    annual_leave_year_start_month: int | None = Field(default=None, ge=1, le=12)
    annual_leave_year_start_day: int | None = Field(default=None, ge=1, le=31)
    default_annual_allowance_days: Decimal | None = Field(default=None, ge=0)
    allow_half_days: bool | None = None
    paid_annual_leave: bool | None = None
    paid_sick_leave: bool | None = None
    sick_leave_requires_note: bool | None = None


class LeaveRequestCreate(BaseModel):
    user_id: uuid.UUID | None = Field(
        default=None,
        description="Admin only: create for this employee. Employees omit.",
    )
    leave_type: LeaveType
    date_from: date
    date_to: date
    start_half_day: HalfDay | None = None
    end_half_day: HalfDay | None = None
    reason: str | None = Field(default=None, max_length=2000)
    employee_note: str | None = Field(default=None, max_length=4000)
    force_overlap: bool = Field(
        default=False,
        description="Admin-only: allow overlapping pending/approved leave when true.",
    )


class LeaveRequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    user_id: uuid.UUID
    leave_type: str
    status: str
    date_from: date
    date_to: date
    start_half_day: str | None
    end_half_day: str | None
    total_days: Decimal
    reason: str | None
    employee_note: str | None
    admin_note: str | None
    approved_by_user_id: uuid.UUID | None
    approved_at: datetime | None
    rejected_by_user_id: uuid.UUID | None
    rejected_at: datetime | None
    cancelled_at: datetime | None
    created_at: datetime
    updated_at: datetime
    warnings: list[str] = Field(default_factory=list)
    balance_warning: str | None = None


class LeaveRequestRejectBody(BaseModel):
    admin_note: str | None = Field(default=None, max_length=4000)


class LeaveBalanceAdjustmentCreate(BaseModel):
    user_id: uuid.UUID
    leave_year: str = Field(min_length=4, max_length=16)
    adjustment_days: Decimal = Field(description="Positive adds allowance, negative subtracts.")
    reason: str = Field(min_length=1, max_length=4000)


class LeaveBalanceAdjustmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    user_id: uuid.UUID
    leave_year: str
    adjustment_days: Decimal
    reason: str
    created_by_user_id: uuid.UUID | None
    created_at: datetime


class LeaveMeSummaryResponse(BaseModel):
    leave_year: str
    allowance_days: Decimal | None
    used_annual_days: Decimal
    pending_annual_days: Decimal
    remaining_days: Decimal | None
    adjustment_sum_days: Decimal
    allow_half_days: bool = True
    sick_leave_requires_note: bool = False


class LeaveAdminSummaryResponse(BaseModel):
    company_id: uuid.UUID
    pending_count: int
    approved_count: int
    rejected_count: int


class WeekLeaveRow(BaseModel):
    """Overlapping leave for a payroll/timesheet week (informational)."""

    request_id: uuid.UUID
    user_id: uuid.UUID
    leave_type: str
    status: str
    date_from: date
    date_to: date
    total_days: Decimal
    start_half_day: str | None = None
    end_half_day: str | None = None
