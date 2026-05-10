import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Workplace(Base):
    __tablename__ = "workplaces"

    __table_args__ = (
        UniqueConstraint("company_id", "name", name="uq_workplaces_company_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id"),
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(
        String(160),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(
        String(60),
        nullable=True,
    )
    address: Mapped[str] = mapped_column(
        String(300),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )
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
