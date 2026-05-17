import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field
from typing import Literal


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
    payment_mode: Literal["net_payment", "gross_payment"] | None = None


class PayrollItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    period_id: uuid.UUID
    user_id: uuid.UUID
    company_id: uuid.UUID
    employee_email: str | None = None
    employee_name: str | None = None
    employee_job_title: str | None = None
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


class PayrollPaySplit(BaseModel):
    """Pre-tax wage components derived from stored seconds and rate snapshots (same basis as payroll items)."""

    regular_pay: Decimal
    overtime_pay: Decimal
    other_pay: Decimal
    total_gross: Decimal | None


class PayrollReportAlerts(BaseModel):
    pending_approval_count: int
    open_shifts_started_in_week_count: int
    rate_missing_employees_count: int
    zero_rounded_hours_employees_count: int
    payroll_period_not_calculated: bool
    payroll_needs_recalculation: bool = False
    can_auto_recalculate: bool = Field(
        default=False,
        description="True when GET /report may safely run server-side recalculation (no approved/paid rows).",
    )


class PayrollLateShiftRow(BaseModel):
    shift_id: uuid.UUID
    clock_in_at: datetime
    clock_out_at: datetime | None
    rounded_seconds: int
    reason: str = Field(description="completed_after_paid when clock-out after paid_at (v1 heuristic).")
    reference_paid_item_id: uuid.UUID | None = None


class PayrollLateUnpaidEmployee(BaseModel):
    user_id: uuid.UUID
    employee_email: str | None = None
    employee_name: str | None = None
    total_late_rounded_seconds: int
    shifts: list[PayrollLateShiftRow]
    estimated_gross_amount: Decimal | None = None
    estimated_net_amount: Decimal | None = None
    estimated_cis_tax_amount: Decimal | None = None


class PayrollUndoPaidRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
    confirm: bool = Field(description="Must be true.")
    acknowledge_accounting_export: bool = Field(
        default=False,
        description="Set true when an accounting payroll export overlaps this week and you still want to undo paid.",
    )


class PayrollLateAdjustmentRequest(BaseModel):
    confirm: bool = Field(default=True)
    shift_ids: list[uuid.UUID] | None = Field(
        default=None,
        description="Optional subset of detected late shifts; default is all non-reserved late shifts.",
    )


class PayrollApprovedLeaveRow(BaseModel):
    user_id: uuid.UUID
    employee_email: str | None = None
    employee_name: str | None = None
    leave_type: str
    date_from: date
    date_to: date
    total_days: Decimal


class PayrollReportResponse(BaseModel):
    period: PayrollPeriodSummary
    items: list[PayrollItemResponse]
    alerts: PayrollReportAlerts
    split: PayrollPaySplit
    payroll_auto_recalculated: bool = Field(
        default=False,
        description="True when this payload was returned immediately after an automatic safe recalculation.",
    )
    has_late_unpaid_shifts: bool = False
    late_shift_count: int = 0
    late_shift_count_detected: int = Field(
        default=0,
        description="Late completed shifts after paid_at (same as late_shift_count for backward compatibility).",
    )
    late_shift_count_payable: int = Field(
        default=0,
        description="Subset of detected late shifts with payroll-rounded duration > 0.",
    )
    late_unpaid_total_rounded_seconds: int = 0
    has_payable_late_unpaid_shifts: bool = Field(
        default=False,
        description="True when an adjustment row would carry payable rounded time.",
    )
    late_unpaid_employees: list[PayrollLateUnpaidEmployee] = Field(default_factory=list)
    accounting_payroll_export_overlaps: bool = Field(
        default=False,
        description="True when a recorded accounting payroll export run overlaps this payroll week.",
    )
    approved_leave_in_week: list[PayrollApprovedLeaveRow] = Field(default_factory=list)
    payroll_leave_review_note: str = Field(
        default="Leave is shown for review only. Automatic paid leave in gross totals is not enabled in this batch.",
        description="Explains that clocked payroll totals are unchanged by leave rows.",
    )


class PayrollMonthSummaryResponse(BaseModel):
    company_id: uuid.UUID
    year: int
    month: int
    payroll_weeks: int
    distinct_employees: int
    total_regular_seconds: int
    total_overtime_seconds: int
    total_rounded_seconds: int
    total_gross: Decimal | None
    total_tax: Decimal | None
    total_net: Decimal | None
    total_other_deductions: Decimal
    total_days: int | None = None


class PayrollPaymentHistoryRow(BaseModel):
    item_id: uuid.UUID
    user_id: uuid.UUID
    employee_email: str | None = None
    employee_name: str | None = None
    paid_at: datetime
    week_start: date
    week_end: date
    gross_amount: Decimal | None
    cis_tax_amount: Decimal | None
    net_paid_amount: Decimal | None
    payment_mode: str | None = None
    payment_mode_label: str
    status: str
    can_open_payslip: bool = True
    can_undo_paid: bool = True


class PayHistoryEntry(BaseModel):
    id: uuid.UUID
    company_id: uuid.UUID
    week_start: date
    week_end: date
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
    company_name: str = ""
    payment_mode: str | None = None
    can_open_payslip: bool = True
    effective_cis_tax_amount: Decimal | None = None
    effective_net_amount: Decimal | None = None
    timezone_name: str = ""


class PayrollItemCompanySnippet(BaseModel):
    id: uuid.UUID
    name: str


class PayrollItemSummaryResponse(BaseModel):
    item_id: uuid.UUID
    company: PayrollItemCompanySnippet
    employee_display_name: str
    employee_email: str | None = None
    timezone_name: str
    week_start: date
    week_end: date
    status: str
    approved_at: datetime | None
    paid_at: datetime | None
    payment_mode: str | None
    payment_mode_label: str
    regular_seconds: int
    overtime_seconds: int
    rounded_total_seconds: int
    gross_amount: Decimal | None
    cis_tax_amount: Decimal | None
    net_amount: Decimal | None
    other_deductions_amount: Decimal
    hourly_rate_snapshot: Decimal | None
    rate_missing: bool
    ytd_taxable_pay: Decimal
    ytd_cis_deducted: Decimal
    can_open_payslip: bool = True
    national_insurance_number: str | None = None
    utr_number: str | None = None
