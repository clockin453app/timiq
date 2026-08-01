"""Payable timesheet hours adjustments (and legacy non-payroll rows)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TimesheetExtraHours(Base):
    """Hours adjustment rows. Payable rows feed payroll; non-payroll rows do not."""

    __tablename__ = "timesheet_extra_hours"
    __table_args__ = (
        CheckConstraint("duration_minutes > 0", name="ck_timesheet_extra_hours_duration_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    note = mapped_column(Text, nullable=True)
    location_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("locations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    affects_payroll: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_user_id = mapped_column(
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
    deleted_at = mapped_column(DateTime(timezone=True), nullable=True, index=True)
