from __future__ import annotations

import uuid
from datetime import date, datetime
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


class MonthlyPayeRecalculateRequest(BaseModel):
    tax_year: str = Field(..., max_length=9)
    tax_month: int = Field(..., ge=1, le=12)
    company_id: uuid.UUID | None = None


class MonthlyPayePeriodResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    tax_year: str
    tax_month: int
    period_start: date
    period_end: date
    pay_date: date
    status: str
    calculated_at: datetime | None = None
    calculated_by_user_id: uuid.UUID | None = None
    approved_at: datetime | None = None
    approved_by_user_id: uuid.UUID | None = None
    paid_at: datetime | None = None
    paid_by_user_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class MonthlyPayeItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    period_id: uuid.UUID
    company_id: uuid.UUID
    user_id: uuid.UUID
    employee_email: str | None = None
    employee_name: str | None = None
    payroll_type: str
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
    gross_pay: Decimal | None = None
    taxable_pay: Decimal | None = None
    niable_pay: Decimal | None = None
    pensionable_pay: Decimal | None = None
    paye_tax: Decimal | None = None
    employee_ni: Decimal | None = None
    employer_ni: Decimal | None = None
    employee_pension: Decimal | None = None
    employer_pension: Decimal | None = None
    student_loan: Decimal | None = None
    postgraduate_loan_deduction: Decimal | None = None
    other_deductions: Decimal
    additions: Decimal
    total_deductions: Decimal | None = None
    net_pay: Decimal | None = None
    ytd_gross_pay: Decimal | None = None
    ytd_taxable_pay: Decimal | None = None
    ytd_paye_tax: Decimal | None = None
    ytd_employee_ni: Decimal | None = None
    ytd_employer_ni: Decimal | None = None
    ytd_employee_pension: Decimal | None = None
    ytd_employer_pension: Decimal | None = None
    ytd_student_loan: Decimal | None = None
    ytd_postgraduate_loan: Decimal | None = None
    ytd_net_pay: Decimal | None = None
    status: str
    approved_at: datetime | None = None
    approved_by_user_id: uuid.UUID | None = None
    paid_at: datetime | None = None
    paid_by_user_id: uuid.UUID | None = None
    calculation_snapshot: dict
    unsupported_reason: str | None = None
    created_at: datetime
    updated_at: datetime


class MonthlyPayeSummaryResponse(BaseModel):
    employees: int
    total_gross: Decimal
    taxable_pay: Decimal
    paye_tax: Decimal
    employee_ni: Decimal
    employer_ni: Decimal
    employee_pension: Decimal
    employer_pension: Decimal
    student_loans: Decimal
    postgraduate_loans: Decimal
    total_deductions: Decimal
    net_pay: Decimal
    unsupported_count: int


class MonthlyPayeReportResponse(BaseModel):
    company_id: uuid.UUID
    tax_year: str
    tax_month: int
    calculation_enabled: bool = True
    message: str
    company_settings_configured: bool
    period: MonthlyPayePeriodResponse | None = None
    rows: list[MonthlyPayeItemResponse]
    summary: MonthlyPayeSummaryResponse
