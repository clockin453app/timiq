from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

BUDGET_STATUSES = ("draft", "active", "completed", "archived")
EXPENSE_CATEGORIES = (
    "materials",
    "tools",
    "equipment",
    "subcontractor",
    "plant_hire",
    "transport",
    "other",
)


class LabourCostEmployeeBreakdown(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    employee_name: str | None = None
    employee_email: str
    job_title: str | None = None
    total_payroll_seconds: int = 0
    hourly_rate: Decimal | None = None
    labour_cost: Decimal = Field(default=Decimal("0.00"))
    rate_missing: bool = False
    shift_count: int = 0


class LabourCostLocationBreakdown(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    location_id: uuid.UUID
    location_name: str
    workplace_name: str | None = None
    total_payroll_seconds: int = 0
    labour_cost: Decimal = Field(default=Decimal("0.00"))
    shift_count: int = 0


class LabourCostResponse(BaseModel):
    company_id: uuid.UUID
    company_name: str
    date_from: date
    date_to: date
    planned_budget_amount: Decimal | None = None
    actual_labour_cost: Decimal = Field(default=Decimal("0.00"))
    remaining_budget: Decimal | None = None
    over_budget_amount: Decimal | None = None
    budget_used_percent: Decimal | None = None
    total_clocked_seconds: int = 0
    total_payable_seconds: int = 0
    total_payroll_seconds: int = 0
    total_break_seconds: int = 0
    average_hourly_cost: Decimal | None = None
    rate_missing_count: int = 0
    open_shift_count: int = 0
    is_estimated: bool = True
    estimate_note: str
    payroll_available: bool = False
    payroll_gross_total: Decimal | None = None
    breakdown_by_employee: list[LabourCostEmployeeBreakdown]
    breakdown_by_location: list[LabourCostLocationBreakdown]


class BudgetProjectCreateRequest(BaseModel):
    company_id: uuid.UUID | None = None
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    workplace_id: uuid.UUID | None = None
    location_id: uuid.UUID | None = None
    client_name: str | None = Field(default=None, max_length=200)
    reference_code: str | None = Field(default=None, max_length=120)
    status: str = Field(default="draft", max_length=20)
    start_date: date | None = None
    end_date: date | None = None
    planned_budget_amount: Decimal = Field(..., ge=0)
    notes: str | None = Field(default=None, max_length=8000)

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        s = v.strip().lower()
        if s not in BUDGET_STATUSES:
            raise ValueError("Invalid status.")
        return s


class BudgetProjectPatchRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    workplace_id: uuid.UUID | None = None
    location_id: uuid.UUID | None = None
    client_name: str | None = Field(default=None, max_length=200)
    reference_code: str | None = Field(default=None, max_length=120)
    status: str | None = Field(default=None, max_length=20)
    start_date: date | None = None
    end_date: date | None = None
    planned_budget_amount: Decimal | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=8000)

    @field_validator("status")
    @classmethod
    def _status(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip().lower()
        if s not in BUDGET_STATUSES:
            raise ValueError("Invalid status.")
        return s


class BudgetProjectSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    name: str
    description: str | None = None
    client_name: str | None = None
    reference_code: str | None = None
    location_id: uuid.UUID | None = None
    location_name: str | None = None
    workplace_id: uuid.UUID | None = None
    workplace_name: str | None = None
    status: str
    start_date: date | None = None
    end_date: date | None = None
    planned_budget_amount: Decimal
    notes: str | None = None
    total_spent: Decimal
    remaining_budget: Decimal
    budget_used_percent: Decimal | None = None


class BudgetEmployeeLabourBreakdown(BaseModel):
    user_id: uuid.UUID
    employee_name: str | None = None
    employee_email: str
    job_title: str | None = None
    shift_count: int = 0
    total_payroll_seconds: int = 0
    finalized_labour_cost: Decimal = Field(default=Decimal("0.00"))
    estimated_labour_cost: Decimal = Field(default=Decimal("0.00"))
    total_labour_cost: Decimal = Field(default=Decimal("0.00"))


class BudgetCategoryTotals(BaseModel):
    materials: Decimal = Field(default=Decimal("0.00"))
    tools: Decimal = Field(default=Decimal("0.00"))
    equipment: Decimal = Field(default=Decimal("0.00"))
    subcontractor: Decimal = Field(default=Decimal("0.00"))
    plant_hire: Decimal = Field(default=Decimal("0.00"))
    transport: Decimal = Field(default=Decimal("0.00"))
    other: Decimal = Field(default=Decimal("0.00"))


class BudgetExpenseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    budget_id: uuid.UUID
    company_id: uuid.UUID
    category: str
    description: str
    supplier: str | None = None
    purchase_date: date
    amount: Decimal
    vat_amount: Decimal | None = None
    invoice_ref: str | None = None
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


class BudgetExpenseCreateRequest(BaseModel):
    category: str = Field(..., max_length=32)
    description: str = Field(..., min_length=1, max_length=500)
    supplier: str | None = Field(default=None, max_length=200)
    purchase_date: date
    amount: Decimal = Field(..., ge=0)
    vat_amount: Decimal | None = Field(default=None, ge=0)
    invoice_ref: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=8000)

    @field_validator("category")
    @classmethod
    def _cat(cls, v: str) -> str:
        s = v.strip().lower()
        if s not in EXPENSE_CATEGORIES:
            raise ValueError("Invalid category.")
        return s


class BudgetExpensePatchRequest(BaseModel):
    category: str | None = Field(default=None, max_length=32)
    description: str | None = Field(default=None, min_length=1, max_length=500)
    supplier: str | None = Field(default=None, max_length=200)
    purchase_date: date | None = None
    amount: Decimal | None = Field(default=None, ge=0)
    vat_amount: Decimal | None = Field(default=None, ge=0)
    invoice_ref: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=8000)

    @field_validator("category")
    @classmethod
    def _cat(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip().lower()
        if s not in EXPENSE_CATEGORIES:
            raise ValueError("Invalid category.")
        return s


class BudgetLiveTotals(BaseModel):
    planned_budget_amount: Decimal
    finalized_labour_cost: Decimal
    estimated_labour_cost: Decimal
    total_labour_cost: Decimal
    total_expenses: Decimal
    total_spent: Decimal
    remaining_budget: Decimal
    over_budget_amount: Decimal
    budget_used_percent: Decimal | None = None
    labour_percent_of_budget: Decimal | None = None
    expenses_percent_of_budget: Decimal | None = None
    total_materials: Decimal
    total_tools: Decimal
    total_equipment: Decimal
    total_subcontractor: Decimal
    total_plant_hire: Decimal
    total_transport: Decimal
    total_other: Decimal
    total_clocked_seconds: int
    total_payable_seconds: int
    total_payroll_seconds: int
    total_break_seconds: int
    open_shift_count: int
    missing_rate_count: int
    warnings: list[str]
    estimate_note: str


class BudgetProjectDetailResponse(BaseModel):
    budget: BudgetProjectSummary
    totals: BudgetLiveTotals
    breakdown_by_employee: list[BudgetEmployeeLabourBreakdown]
    breakdown_by_category: BudgetCategoryTotals
    recent_expenses: list[BudgetExpenseResponse]


INVOICE_STORED_STATUSES = ("draft", "issued", "void")
INVOICE_DISPLAY_STATUSES = ("draft", "issued", "part_paid", "paid", "overdue", "void")
PAYMENT_METHODS = ("bank_transfer", "card", "cash", "cheque", "other")


class ContractValueUpdateRequest(BaseModel):
    contract_value_net: Decimal | None = Field(default=None)
    billing_currency: str | None = Field(default=None, max_length=3)

    @field_validator("billing_currency")
    @classmethod
    def _currency(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip().upper()
        if not s:
            return None
        if len(s) != 3 or not s.isalpha():
            raise ValueError("billing_currency must be a 3-letter ISO 4217 code.")
        return s


class InvoiceCreateRequest(BaseModel):
    client_action_id: uuid.UUID
    customer_name: str = Field(..., min_length=1, max_length=200)
    invoice_number: str | None = Field(default=None, max_length=120)
    invoice_date: date | None = None
    due_date: date | None = None
    currency: str = Field(default="GBP", max_length=3)
    net_amount: Decimal = Field(..., ge=0)
    vat_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    gross_amount: Decimal = Field(..., ge=0)
    description: str | None = Field(default=None, max_length=8000)
    reference: str | None = Field(default=None, max_length=200)
    payment_terms: str | None = Field(default=None, max_length=200)

    @field_validator("currency")
    @classmethod
    def _currency(cls, v: str) -> str:
        s = (v or "GBP").strip().upper()
        if len(s) != 3 or not s.isalpha():
            raise ValueError("currency must be a 3-letter ISO 4217 code.")
        return s

    @field_validator("customer_name")
    @classmethod
    def _customer_name(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("customer_name is required.")
        return s


class InvoicePatchRequest(BaseModel):
    customer_name: str | None = Field(default=None, min_length=1, max_length=200)
    invoice_number: str | None = Field(default=None, max_length=120)
    invoice_date: date | None = None
    due_date: date | None = None
    currency: str | None = Field(default=None, max_length=3)
    net_amount: Decimal | None = Field(default=None, ge=0)
    vat_amount: Decimal | None = Field(default=None, ge=0)
    gross_amount: Decimal | None = Field(default=None, ge=0)
    description: str | None = Field(default=None, max_length=8000)
    reference: str | None = Field(default=None, max_length=200)
    payment_terms: str | None = Field(default=None, max_length=200)

    @field_validator("currency")
    @classmethod
    def _currency(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip().upper()
        if len(s) != 3 or not s.isalpha():
            raise ValueError("currency must be a 3-letter ISO 4217 code.")
        return s

    @field_validator("customer_name")
    @classmethod
    def _customer_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        if not s:
            raise ValueError("customer_name cannot be empty.")
        return s


class InvoiceIssueRequest(BaseModel):
    """Optional body for issue; all required fields must already be on the draft."""

    model_config = ConfigDict(extra="forbid")


class InvoiceVoidRequest(BaseModel):
    confirm: bool
    reason: str = Field(..., min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("reason is required.")
        return s


class InvoiceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    budget_id: uuid.UUID
    client_action_id: uuid.UUID | None = None
    customer_name: str
    invoice_number: str | None = None
    invoice_date: date | None = None
    due_date: date | None = None
    status: str
    display_status: str
    currency: str
    net_amount: Decimal
    vat_amount: Decimal
    gross_amount: Decimal
    payments_received_gross: Decimal = Field(default=Decimal("0.00"))
    outstanding_gross: Decimal = Field(default=Decimal("0.00"))
    description: str | None = None
    reference: str | None = None
    payment_terms: str | None = None
    issued_at: datetime | None = None
    voided_at: datetime | None = None
    void_reason: str | None = None
    created_at: datetime
    updated_at: datetime
    has_document: bool = False
    document_filename: str | None = None
    document_content_type: str | None = None
    document_version: int | None = None


class PaymentCreateRequest(BaseModel):
    client_action_id: uuid.UUID
    payment_date: date
    amount: Decimal = Field(..., gt=0)
    payment_method: str = Field(..., max_length=40)
    currency: str | None = Field(default=None, max_length=3)
    reference: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=8000)

    @field_validator("payment_method")
    @classmethod
    def _method(cls, v: str) -> str:
        s = v.strip().lower()
        if s not in PAYMENT_METHODS:
            raise ValueError(
                f"payment_method must be one of: {', '.join(PAYMENT_METHODS)}.",
            )
        return s

    @field_validator("currency")
    @classmethod
    def _currency(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip().upper()
        if len(s) != 3 or not s.isalpha():
            raise ValueError("currency must be a 3-letter ISO 4217 code.")
        return s


class PaymentReverseRequest(BaseModel):
    confirm: bool
    reason: str = Field(..., min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("reason is required.")
        return s


class PaymentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    budget_id: uuid.UUID
    invoice_id: uuid.UUID
    client_action_id: uuid.UUID | None = None
    payment_date: date
    amount: Decimal
    currency: str
    payment_method: str
    reference: str | None = None
    notes: str | None = None
    created_by_user_id: uuid.UUID | None = None
    created_by_display: str | None = None
    created_at: datetime
    reversed_at: datetime | None = None
    reversed_by_user_id: uuid.UUID | None = None
    reversal_reason: str | None = None
    is_reversed: bool = False


class BillingSummaryResponse(BaseModel):
    budget_id: uuid.UUID
    company_id: uuid.UUID
    contract_value_net: Decimal | None = None
    billing_currency: str | None = None
    active_invoiced_net: Decimal = Field(default=Decimal("0.00"))
    vat_invoiced: Decimal = Field(default=Decimal("0.00"))
    gross_invoiced: Decimal = Field(default=Decimal("0.00"))
    payments_received_gross: Decimal = Field(default=Decimal("0.00"))
    outstanding_gross: Decimal = Field(default=Decimal("0.00"))
    overdue_outstanding_gross: Decimal = Field(default=Decimal("0.00"))
    remaining_to_invoice: Decimal | None = None
    over_invoiced: Decimal | None = None
    draft_count: int = 0
    issued_count: int = 0
    part_paid_count: int = 0
    paid_count: int = 0
    overdue_count: int = 0
    void_count: int = 0
    active_count: int = 0
