from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


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
