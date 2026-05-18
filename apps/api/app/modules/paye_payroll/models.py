from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EmployeePayeSettings(Base):
    __tablename__ = "employee_paye_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    pay_frequency: Mapped[str] = mapped_column(String(32), nullable=False, default="monthly")
    salary_type: Mapped[str] = mapped_column(String(32), nullable=False, default="hourly")
    monthly_salary: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    paye_hourly_rate: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    paye_uses_time_records: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    paye_hour_source: Mapped[str] = mapped_column(String(32), nullable=False, default="completed_time_shifts")
    tax_code: Mapped[str] = mapped_column(String(32), nullable=True)
    tax_basis: Mapped[str] = mapped_column(String(32), nullable=False, default="cumulative")
    ni_category: Mapped[str] = mapped_column(String(8), nullable=True)
    student_loan_plan: Mapped[str] = mapped_column(String(16), nullable=False, default="none")
    postgraduate_loan: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    pension_enrolment_status: Mapped[str] = mapped_column(String(32), nullable=False, default="not_eligible")
    employee_pension_percent: Mapped[float] = mapped_column(Numeric(7, 4), nullable=True)
    employer_pension_percent: Mapped[float] = mapped_column(Numeric(7, 4), nullable=True)
    pension_scheme_basis: Mapped[str] = mapped_column(String(32), nullable=False, default="qualifying_earnings")
    pension_relief_method: Mapped[str] = mapped_column(String(32), nullable=False, default="relief_at_source")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class CompanyPayeSettings(Base):
    __tablename__ = "company_paye_settings"

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        primary_key=True,
    )
    paye_reference: Mapped[str] = mapped_column(String(64), nullable=True)
    accounts_office_reference: Mapped[str] = mapped_column(String(64), nullable=True)
    pension_provider_name: Mapped[str] = mapped_column(String(160), nullable=True)
    default_employee_pension_percent: Mapped[float] = mapped_column(Numeric(7, 4), nullable=True)
    default_employer_pension_percent: Mapped[float] = mapped_column(Numeric(7, 4), nullable=True)
    default_pension_basis: Mapped[str] = mapped_column(String(32), nullable=False, default="qualifying_earnings")
    monthly_payday_rule: Mapped[str] = mapped_column(String(64), nullable=True)
    pay_period_closing_day: Mapped[int] = mapped_column(Integer, nullable=True)
    paye_overtime_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    paye_overtime_threshold_hours: Mapped[float] = mapped_column(Numeric(10, 4), nullable=True)
    paye_overtime_multiplier: Mapped[float] = mapped_column(Numeric(10, 4), nullable=True)
    default_tax_year: Mapped[str] = mapped_column(String(9), nullable=True)
    rti_status: Mapped[str] = mapped_column(String(32), nullable=False, default="not_ready")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class PayeTaxYearRule(Base):
    __tablename__ = "paye_tax_year_rules"

    tax_year: Mapped[str] = mapped_column(String(9), primary_key=True)
    rules_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    source_note: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class MonthlyPayePayComponent(Base):
    __tablename__ = "monthly_paye_pay_components"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    tax_year: Mapped[str] = mapped_column(String(9), nullable=False, index=True)
    tax_month: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("monthly_paye_periods.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("monthly_paye_items.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    component_type: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(String(240), nullable=True)
    amount: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False)
    taxable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    niable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    pensionable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class MonthlyPayePeriod(Base):
    __tablename__ = "monthly_paye_periods"
    __table_args__ = (
        UniqueConstraint("company_id", "tax_year", "tax_month", name="uq_monthly_paye_period_company_tax_month"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    tax_year: Mapped[str] = mapped_column(String(9), nullable=False, index=True)
    tax_month: Mapped[int] = mapped_column(Integer, nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    pay_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    calculated_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class MonthlyPayeItem(Base):
    __tablename__ = "monthly_paye_items"
    __table_args__ = (
        UniqueConstraint("period_id", "user_id", name="uq_monthly_paye_item_period_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("monthly_paye_periods.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    payroll_type: Mapped[str] = mapped_column(String(32), nullable=False)
    pay_frequency: Mapped[str] = mapped_column(String(32), nullable=False)
    salary_type: Mapped[str] = mapped_column(String(32), nullable=False)
    monthly_salary: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    tax_code: Mapped[str] = mapped_column(String(32), nullable=True)
    tax_basis: Mapped[str] = mapped_column(String(32), nullable=False)
    ni_category: Mapped[str] = mapped_column(String(8), nullable=True)
    student_loan_plan: Mapped[str] = mapped_column(String(16), nullable=False)
    postgraduate_loan: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    pension_enrolment_status: Mapped[str] = mapped_column(String(32), nullable=False)
    employee_pension_percent: Mapped[float] = mapped_column(Numeric(7, 4), nullable=True)
    employer_pension_percent: Mapped[float] = mapped_column(Numeric(7, 4), nullable=True)
    pension_scheme_basis: Mapped[str] = mapped_column(String(32), nullable=False)
    pension_relief_method: Mapped[str] = mapped_column(String(32), nullable=False)
    bonus_pay: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False, default=0)
    commission_pay: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False, default=0)
    component_pay: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False, default=0)
    regular_hours: Mapped[float] = mapped_column(Numeric(12, 4), nullable=True)
    overtime_hours: Mapped[float] = mapped_column(Numeric(12, 4), nullable=True)
    hourly_rate: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    gross_hourly_pay: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    regular_pay: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    overtime_pay: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    gross_pay: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    taxable_pay: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    niable_pay: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    pensionable_pay: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    paye_tax: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    employee_ni: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    employer_ni: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    employee_pension: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    employer_pension: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    student_loan: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    postgraduate_loan_deduction: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    other_deductions: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False, default=0)
    additions: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False, default=0)
    total_deductions: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    net_pay: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    ytd_gross_pay: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    ytd_taxable_pay: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    ytd_paye_tax: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    ytd_employee_ni: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    ytd_employer_ni: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    ytd_employee_pension: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    ytd_employer_pension: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    ytd_student_loan: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    ytd_postgraduate_loan: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    ytd_net_pay: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    component_snapshot: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    overtime_policy_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=True)
    time_record_source_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=True)
    calculation_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    unsupported_reason: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
