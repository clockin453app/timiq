import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class PayrollRecalculateRequest(BaseModel):
    company_id: uuid.UUID
    week_start: date


class PayrollApproveAllRequest(BaseModel):
    company_id: uuid.UUID
    week_start: date


class PayrollReportQuery(BaseModel):
    company_id: uuid.UUID
    week_start: date


class PayrollItemPatchRequest(BaseModel):
    notes: str | None = Field(default=None, max_length=8000)
    other_deductions_amount: Decimal | None = Field(default=None, ge=0)
    display_tax_amount: Decimal | None = None
    display_net_amount: Decimal | None = None
    payment_mode: str | None = Field(default=None, max_length=64)


class PayrollItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    period_id: uuid.UUID
    user_id: uuid.UUID
    company_id: uuid.UUID
    employee_email: str | None = None
    employee_name: str | None = None
    regular_seconds: int
    overtime_seconds: int
    rounded_total_seconds: int
    hourly_rate_snapshot: Decimal | None
    tax_rate_snapshot: Decimal | None
    overtime_multiplier_snapshot: Decimal | None
    gross_amount: Decimal | None
    tax_amount: Decimal | None
    net_amount: Decimal | None
    other_deductions_amount: Decimal
    display_tax_amount: Decimal | None
    display_net_amount: Decimal | None
    payment_mode: str | None
    notes: str | None
    policy_snapshot: dict
    status: str
    approved_at: datetime | None
    approved_by_user_id: uuid.UUID | None
    paid_at: datetime | None
    paid_by_user_id: uuid.UUID | None
    rate_missing: bool


class PayrollPeriodSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    week_start: date
    timezone_name: str
    calculated_at: datetime | None
    calculated_by_user_id: uuid.UUID | None
    total_items: int
    pending_count: int
    approved_count: int
    paid_count: int
    total_regular_seconds: int
    total_overtime_seconds: int
    total_rounded_seconds: int
    total_gross: Decimal | None
    total_tax: Decimal | None
    total_net: Decimal | None
    total_other_deductions: Decimal


class PayrollReportResponse(BaseModel):
    period: PayrollPeriodSummary
    items: list[PayrollItemResponse]


class PayHistoryEntry(BaseModel):
    id: uuid.UUID
    company_id: uuid.UUID
    week_start: date
    period_id: uuid.UUID
    regular_seconds: int
    overtime_seconds: int
    rounded_total_seconds: int
    gross_amount: Decimal | None
    tax_amount: Decimal | None
    net_amount: Decimal | None
    display_tax_amount: Decimal | None
    display_net_amount: Decimal | None
    other_deductions_amount: Decimal
    status: str
    approved_at: datetime | None
    paid_at: datetime | None
    rate_missing: bool
