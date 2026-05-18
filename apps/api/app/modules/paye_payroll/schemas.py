from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

PayFrequency = Literal["monthly"]
SalaryType = Literal["fixed_monthly_salary", "hourly"]
TaxBasis = Literal["cumulative", "month1"]
StudentLoanPlan = Literal["none", "plan_1", "plan_2", "plan_4", "plan_5"]
PensionStatus = Literal["eligible", "enrolled", "opted_out", "postponed", "not_eligible"]
PensionBasis = Literal["qualifying_earnings", "total_earnings"]
PensionReliefMethod = Literal["relief_at_source", "net_pay_arrangement", "salary_sacrifice"]
RtiStatus = Literal["not_ready", "ready", "exported", "submitted", "accepted", "rejected"]


class EmployeePayeSettingsPatchRequest(BaseModel):
    pay_frequency: PayFrequency | None = None
    salary_type: SalaryType | None = None
    monthly_salary: Decimal | None = Field(default=None, ge=0)
    tax_code: str | None = Field(default=None, max_length=32)
    tax_basis: TaxBasis | None = None
    ni_category: str | None = Field(default=None, max_length=8)
    student_loan_plan: StudentLoanPlan | None = None
    postgraduate_loan: bool | None = None
    pension_enrolment_status: PensionStatus | None = None
    employee_pension_percent: Decimal | None = Field(default=None, ge=0, le=100)
    employer_pension_percent: Decimal | None = Field(default=None, ge=0, le=100)
    pension_scheme_basis: PensionBasis | None = None
    pension_relief_method: PensionReliefMethod | None = None


class EmployeePayeSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    company_id: uuid.UUID
    pay_frequency: str
    salary_type: str
    monthly_salary: Decimal | None = None
    tax_code: str | None = None
    tax_basis: str
    ni_category: str | None = None
    student_loan_plan: str
    postgraduate_loan: bool
    pension_enrolment_status: str
    employee_pension_percent: Decimal | None = None
    employer_pension_percent: Decimal | None = None
    pension_scheme_basis: str
    pension_relief_method: str
    created_at: datetime
    updated_at: datetime


class CompanyPayeSettingsPatchRequest(BaseModel):
    company_id: uuid.UUID | None = None
    paye_reference: str | None = Field(default=None, max_length=64)
    accounts_office_reference: str | None = Field(default=None, max_length=64)
    pension_provider_name: str | None = Field(default=None, max_length=160)
    default_employee_pension_percent: Decimal | None = Field(default=None, ge=0, le=100)
    default_employer_pension_percent: Decimal | None = Field(default=None, ge=0, le=100)
    default_pension_basis: PensionBasis | None = None
    monthly_payday_rule: str | None = Field(default=None, max_length=64)
    pay_period_closing_day: int | None = Field(default=None, ge=1, le=31)
    default_tax_year: str | None = Field(default=None, max_length=9)
    rti_status: RtiStatus | None = None


class CompanyPayeSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    company_id: uuid.UUID
    paye_reference: str | None = None
    accounts_office_reference: str | None = None
    pension_provider_name: str | None = None
    default_employee_pension_percent: Decimal | None = None
    default_employer_pension_percent: Decimal | None = None
    default_pension_basis: str
    monthly_payday_rule: str | None = None
    pay_period_closing_day: int | None = None
    default_tax_year: str | None = None
    rti_status: str
    created_at: datetime
    updated_at: datetime


class MonthlyPayeReportShellRow(BaseModel):
    user_id: uuid.UUID
    employee_email: str
    employee_name: str | None = None
    payroll_type: str
    tax_code: str | None = None
    ni_category: str | None = None
    status: str = "not_calculated"


class MonthlyPayeReportShellResponse(BaseModel):
    company_id: uuid.UUID
    year: int
    month: int
    calculation_enabled: bool = False
    message: str
    company_settings_configured: bool
    rows: list[MonthlyPayeReportShellRow]
