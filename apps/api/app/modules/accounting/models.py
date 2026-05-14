import uuid
from datetime import datetime, timezone

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CompanyAccountingSettings(Base):
    """Per-company placeholder for future ERP / accounting integration (no outbound sync yet)."""

    __tablename__ = "company_accounting_settings"

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        primary_key=True,
    )
    provider_key: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="none",
    )
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    updated_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class AccountingExportRun(Base):
    """Recorded accounting CSV export (no file blob; generated on demand)."""

    __tablename__ = "accounting_export_runs"

    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    provider = mapped_column(String(32), nullable=False)
    export_type = mapped_column(String(32), nullable=False)
    date_from = mapped_column(Date, nullable=False)
    date_to = mapped_column(Date, nullable=False)
    status = mapped_column(String(32), nullable=False, default="generated")
    created_by_user_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    row_count = mapped_column(Integer, nullable=False, default=0)
    total_amount = mapped_column(Numeric(16, 4), nullable=True)
    file_name = mapped_column(String(255), nullable=False)
    notes = mapped_column(Text, nullable=True)
    filters_json = mapped_column(JSONB, nullable=True)


class AccountingExportSettings(Base):
    """Per-company nominal / tax hints for export-ready CSV (no OAuth, no tokens)."""

    __tablename__ = "accounting_export_settings"
    __table_args__ = (
        UniqueConstraint("company_id", "provider", name="uq_accounting_export_settings_company_provider"),
    )

    id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    provider = mapped_column(String(32), nullable=False)
    nominal_code_wages = mapped_column(String(64), nullable=True)
    nominal_code_cis = mapped_column(String(64), nullable=True)
    nominal_code_materials = mapped_column(String(64), nullable=True)
    nominal_code_tools = mapped_column(String(64), nullable=True)
    nominal_code_equipment = mapped_column(String(64), nullable=True)
    nominal_code_subcontractor = mapped_column(String(64), nullable=True)
    tax_code = mapped_column(String(64), nullable=True)
    created_at = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
