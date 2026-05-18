from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text
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
