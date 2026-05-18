import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PayrollPeriod(Base):
    __tablename__ = "payroll_periods"

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
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    timezone_name: Mapped[str] = mapped_column(String(64), nullable=False)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    calculated_by_user_id: Mapped[uuid.UUID] = mapped_column(
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


class PayrollItem(Base):
    __tablename__ = "payroll_items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("payroll_periods.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    regular_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    overtime_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rounded_total_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    hourly_rate_snapshot: Mapped[float] = mapped_column(Numeric(12, 4), nullable=True)
    tax_rate_snapshot: Mapped[float] = mapped_column(Numeric(10, 4), nullable=True)
    overtime_multiplier_snapshot: Mapped[float] = mapped_column(Numeric(10, 4), nullable=True)
    gross_amount: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    tax_amount: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    net_amount: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    other_deductions_amount: Mapped[float] = mapped_column(Numeric(14, 4), nullable=False, default=0)
    display_tax_amount: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    display_net_amount: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    payment_mode: Mapped[str] = mapped_column(String(64), nullable=True)
    payment_mode_source: Mapped[str] = mapped_column(String(32), nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    policy_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
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
    rate_missing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
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
