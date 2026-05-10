import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# TODO: Allow workplace-level time policy override when workplace payroll scope is built.


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(
        String(160),
        unique=True,
        index=True,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
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
    default_tax_rate: Mapped[float] = mapped_column(Numeric(10, 4), nullable=True)


class CompanyTimePolicy(Base):
    """Company-level payroll time rules (legacy-aligned). Workplace override not implemented yet."""

    __tablename__ = "company_time_policies"

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        primary_key=True,
    )
    standard_start_time: Mapped[str] = mapped_column(
        String(5),
        nullable=False,
        default="08:00",
    )
    overtime_after_hours: Mapped[float] = mapped_column(Float, nullable=False, default=8.5)
    overtime_multiplier: Mapped[float] = mapped_column(Float, nullable=False, default=1.5)
    rounding_increment_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    rounding_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="nearest")
    break_deduction_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    rule_effective_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    rule_note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    timezone_name: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="Europe/London",
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