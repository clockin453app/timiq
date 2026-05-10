import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EmployeeProfile(Base):
    __tablename__ = "employee_profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        unique=True,
        index=True,
        nullable=False,
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id"),
        index=True,
        nullable=True,
    )
    first_name: Mapped[str] = mapped_column(String(120), nullable=True)
    last_name: Mapped[str] = mapped_column(String(120), nullable=True)
    phone: Mapped[str] = mapped_column(String(30), nullable=True)
    job_title: Mapped[str] = mapped_column(String(120), nullable=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=True)
    emergency_contact_name: Mapped[str] = mapped_column(String(120), nullable=True)
    emergency_contact_phone: Mapped[str] = mapped_column(String(30), nullable=True)
    is_onboarded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    early_access_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    hourly_rate: Mapped[float] = mapped_column(Numeric(12, 4), nullable=True)
    tax_rate: Mapped[float] = mapped_column(Numeric(10, 4), nullable=True)
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
