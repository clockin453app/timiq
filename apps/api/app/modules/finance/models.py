"""Finance tables for the D2 cost register.

Triggers that protect posted documents, approved budgets, reversals, and
append-only history live in the D2 Alembic migration. They are not CHECK
constraints, because a CHECK cannot sum child rows.

Importing this module does not register the tables with Alembic. That import
belongs in a later approved edit of app.db.models.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    false,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.modules.finance.constants import (
    MONEY_STORAGE_PRECISION,
    MONEY_STORAGE_SCALE,
    SUPPORTED_CURRENCY_CODE,
)

MONEY = Numeric(MONEY_STORAGE_PRECISION, MONEY_STORAGE_SCALE)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class FinanceProject(Base):
    __tablename__ = "finance_projects"
    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_finance_projects_company_id"),
        CheckConstraint(
            "status IN ('draft', 'active', 'closed')",
            name="ck_finance_projects_status",
        ),
        Index(
            "uq_finance_projects_company_reference",
            "company_id",
            "reference_code",
            unique=True,
            postgresql_where=text("reference_code IS NOT NULL"),
        ),
        Index(
            "uq_finance_projects_company_workplace",
            "company_id",
            "workplace_id",
            unique=True,
            postgresql_where=text("workplace_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    reference_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="draft", server_default="draft"
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    workplace_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workplaces.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
        server_default=text("now()"),
    )


class FinanceCostCode(Base):
    __tablename__ = "finance_cost_codes"
    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_finance_cost_codes_company_id"),
        UniqueConstraint("company_id", "code", name="uq_finance_cost_codes_company_code"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
        server_default=text("now()"),
    )


class FinanceCounterparty(Base):
    __tablename__ = "finance_counterparties"
    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_finance_counterparties_company_id"),
        UniqueConstraint(
            "company_id",
            "counterparty_type",
            "normalized_name",
            name="uq_finance_counterparties_company_name",
        ),
        CheckConstraint(
            "counterparty_type IN ('supplier', 'customer', 'lender', 'worker', 'director')",
            name="ck_finance_counterparties_type",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    counterparty_type: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(200), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
        server_default=text("now()"),
    )


class FinanceBudgetVersion(Base):
    __tablename__ = "finance_budget_versions"
    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_finance_budget_versions_company_id"),
        UniqueConstraint("project_id", "version_number", name="uq_finance_budget_versions_project_number"),
        ForeignKeyConstraint(
            ["company_id", "project_id"],
            ["finance_projects.company_id", "finance_projects.id"],
            name="fk_finance_budget_versions_project",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "status IN ('draft', 'approved', 'superseded')",
            name="ck_finance_budget_versions_status",
        ),
        CheckConstraint("version_number >= 1", name="ck_finance_budget_versions_number"),
        Index(
            "uq_finance_budget_versions_one_approved",
            "project_id",
            unique=True,
            postgresql_where=text("status = 'approved'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="draft", server_default="draft"
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
        server_default=text("now()"),
    )


class FinanceBudgetLine(Base):
    """Several lines may share one cost code. CVR sums amount_net by cost code."""

    __tablename__ = "finance_budget_lines"
    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_finance_budget_lines_company_id"),
        UniqueConstraint("version_id", "line_number", name="uq_finance_budget_lines_version_number"),
        ForeignKeyConstraint(
            ["company_id", "version_id"],
            ["finance_budget_versions.company_id", "finance_budget_versions.id"],
            name="fk_finance_budget_lines_version",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "cost_code_id"],
            ["finance_cost_codes.company_id", "finance_cost_codes.id"],
            name="fk_finance_budget_lines_cost_code",
            ondelete="RESTRICT",
        ),
        CheckConstraint("line_number >= 1", name="ck_finance_budget_lines_number"),
        CheckConstraint("amount_net >= 0", name="ck_finance_budget_lines_amount"),
        Index("ix_finance_budget_lines_version_cost_code", "version_id", "cost_code_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    item_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cost_code_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    amount_net: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
        server_default=text("now()"),
    )


class FinanceCostDocument(Base):
    __tablename__ = "finance_cost_documents"
    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_finance_cost_documents_company_id"),
        ForeignKeyConstraint(
            ["company_id", "counterparty_id"],
            ["finance_counterparties.company_id", "finance_counterparties.id"],
            name="fk_finance_cost_documents_counterparty",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "credited_document_id"],
            ["finance_cost_documents.company_id", "finance_cost_documents.id"],
            name="fk_finance_cost_documents_credited",
            ondelete="RESTRICT",
            use_alter=True,
        ),
        ForeignKeyConstraint(
            ["company_id", "reverses_document_id"],
            ["finance_cost_documents.company_id", "finance_cost_documents.id"],
            name="fk_finance_cost_documents_reverses",
            ondelete="RESTRICT",
            use_alter=True,
        ),
        CheckConstraint("status IN ('draft', 'posted')", name="ck_finance_cost_documents_status"),
        CheckConstraint(
            "document_type IN ("
            "'supplier_invoice', 'expense_receipt', 'supplier_credit', "
            "'reversal', 'direct_cash', 'accrual'"
            ")",
            name="ck_finance_cost_documents_type",
        ),
        CheckConstraint(
            f"currency_code = '{SUPPORTED_CURRENCY_CODE}'",
            name="ck_finance_cost_documents_gbp",
        ),
        CheckConstraint("tax_notional_amount = 0", name="ck_finance_cost_documents_no_notional"),
        CheckConstraint(
            "gross_amount = net_amount + tax_amount",
            name="ck_finance_cost_documents_gross",
        ),
        CheckConstraint(
            "non_recoverable_amount = tax_amount - recoverable_amount",
            name="ck_finance_cost_documents_non_recoverable",
        ),
        CheckConstraint(
            "eligible_amount = net_amount + non_recoverable_amount",
            name="ck_finance_cost_documents_eligible",
        ),
        CheckConstraint(
            "status <> 'posted' OR ("
            "counterparty_id IS NOT NULL AND service_date IS NOT NULL "
            "AND document_date IS NOT NULL AND tax_point_date IS NOT NULL"
            ")",
            name="ck_finance_cost_documents_posted_required",
        ),
        CheckConstraint(
            "status <> 'posted' OR ("
            "(tax_amount >= 0 AND recoverable_amount >= 0 AND recoverable_amount <= tax_amount) "
            "OR (tax_amount < 0 AND recoverable_amount <= 0 AND recoverable_amount >= tax_amount)"
            ")",
            name="ck_finance_cost_documents_recoverable_bounds",
        ),
        CheckConstraint(
            "status <> 'posted' OR document_type NOT IN "
            "('supplier_invoice', 'expense_receipt', 'direct_cash', 'accrual') OR "
            "(net_amount >= 0 AND tax_amount >= 0 AND gross_amount > 0)",
            name="ck_finance_cost_documents_posted_positive",
        ),
        CheckConstraint(
            "status <> 'posted' OR document_type <> 'supplier_credit' OR "
            "(net_amount <= 0 AND tax_amount <= 0 AND gross_amount < 0 AND credited_document_id IS NOT NULL)",
            name="ck_finance_cost_documents_posted_credit",
        ),
        CheckConstraint(
            "status <> 'posted' OR document_type <> 'reversal' OR reverses_document_id IS NOT NULL",
            name="ck_finance_cost_documents_posted_reversal_link",
        ),
        CheckConstraint(
            "status <> 'posted' OR ("
            "(document_type = 'supplier_credit' AND credited_document_id IS NOT NULL "
            "AND reverses_document_id IS NULL) OR "
            "(document_type = 'reversal' AND reverses_document_id IS NOT NULL "
            "AND credited_document_id IS NULL) OR "
            "(document_type NOT IN ('supplier_credit', 'reversal') "
            "AND credited_document_id IS NULL AND reverses_document_id IS NULL)"
            ")",
            name="ck_finance_cost_documents_posted_links",
        ),
        Index(
            "uq_finance_posted_supplier_invoice_ref",
            "company_id",
            "counterparty_id",
            "normalized_reference",
            unique=True,
            postgresql_where=text(
                "document_type = 'supplier_invoice' AND status = 'posted'"
            ),
        ),
        Index(
            "uq_finance_posted_supplier_credit_ref",
            "company_id",
            "counterparty_id",
            "normalized_reference",
            unique=True,
            postgresql_where=text(
                "document_type = 'supplier_credit' AND status = 'posted'"
            ),
        ),
        Index(
            "uq_finance_posted_reversal_source",
            "reverses_document_id",
            unique=True,
            postgresql_where=text(
                "document_type = 'reversal' AND status = 'posted' AND reverses_document_id IS NOT NULL"
            ),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    counterparty_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    document_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="draft", server_default="draft"
    )
    external_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    normalized_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    service_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    document_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    tax_point_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    currency_code: Mapped[str] = mapped_column(
        String(3), nullable=False, default=SUPPORTED_CURRENCY_CODE, server_default="GBP"
    )
    net_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"), server_default="0")
    tax_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"), server_default="0")
    recoverable_amount: Mapped[Decimal] = mapped_column(
        MONEY, nullable=False, default=Decimal("0"), server_default="0"
    )
    non_recoverable_amount: Mapped[Decimal] = mapped_column(
        MONEY, nullable=False, default=Decimal("0"), server_default="0"
    )
    eligible_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"), server_default="0")
    gross_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"), server_default="0")
    tax_notional_amount: Mapped[Decimal] = mapped_column(
        MONEY, nullable=False, default=Decimal("0"), server_default="0"
    )
    credited_document_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    reverses_document_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    posted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
        server_default=text("now()"),
    )


class FinanceCostLine(Base):
    __tablename__ = "finance_cost_lines"
    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_finance_cost_lines_company_id"),
        UniqueConstraint("document_id", "line_number", name="uq_finance_cost_lines_document_number"),
        ForeignKeyConstraint(
            ["company_id", "document_id"],
            ["finance_cost_documents.company_id", "finance_cost_documents.id"],
            name="fk_finance_cost_lines_document",
            ondelete="RESTRICT",
        ),
        CheckConstraint("line_number >= 1", name="ck_finance_cost_lines_number"),
        CheckConstraint(
            "tax_treatment IS NULL OR tax_treatment IN "
            "('standard', 'reduced', 'zero', 'exempt', 'outside_scope')",
            name="ck_finance_cost_lines_tax_treatment",
        ),
        CheckConstraint("tax_notional_amount = 0", name="ck_finance_cost_lines_no_notional"),
        CheckConstraint(
            "non_recoverable_amount = tax_amount - recoverable_amount",
            name="ck_finance_cost_lines_non_recoverable",
        ),
        CheckConstraint(
            "eligible_amount = net_amount + non_recoverable_amount",
            name="ck_finance_cost_lines_eligible",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    net_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"), server_default="0")
    tax_treatment: Mapped[str | None] = mapped_column(String(32), nullable=True)
    tax_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"), server_default="0")
    recoverable_amount: Mapped[Decimal] = mapped_column(
        MONEY, nullable=False, default=Decimal("0"), server_default="0"
    )
    non_recoverable_amount: Mapped[Decimal] = mapped_column(
        MONEY, nullable=False, default=Decimal("0"), server_default="0"
    )
    eligible_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"), server_default="0")
    tax_notional_amount: Mapped[Decimal] = mapped_column(
        MONEY, nullable=False, default=Decimal("0"), server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
        server_default=text("now()"),
    )


class FinanceCostAllocation(Base):
    __tablename__ = "finance_cost_allocations"
    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_finance_cost_allocations_company_id"),
        UniqueConstraint("line_id", "allocation_number", name="uq_finance_cost_allocations_line_number"),
        ForeignKeyConstraint(
            ["company_id", "line_id"],
            ["finance_cost_lines.company_id", "finance_cost_lines.id"],
            name="fk_finance_cost_allocations_line",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "project_id"],
            ["finance_projects.company_id", "finance_projects.id"],
            name="fk_finance_cost_allocations_project",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "cost_code_id"],
            ["finance_cost_codes.company_id", "finance_cost_codes.id"],
            name="fk_finance_cost_allocations_cost_code",
            ondelete="RESTRICT",
        ),
        CheckConstraint("allocation_number >= 1", name="ck_finance_cost_allocations_number"),
        CheckConstraint(
            "amount_eligible = amount_net + amount_non_recoverable",
            name="ck_finance_cost_allocations_eligible",
        ),
        Index("ix_finance_cost_allocations_project_id", "project_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    line_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    allocation_number: Mapped[int] = mapped_column(Integer, nullable=False)
    project_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    cost_code_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    is_overhead: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    amount_net: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"), server_default="0")
    amount_non_recoverable: Mapped[Decimal] = mapped_column(
        MONEY, nullable=False, default=Decimal("0"), server_default="0"
    )
    amount_eligible: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0"), server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
        server_default=text("now()"),
    )


class FinanceAuditEvent(Base):
    """Append-only. actor_user_id is a copied UUID with no users foreign key."""

    __tablename__ = "finance_audit_events"
    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_finance_audit_events_company_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    before_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("now()")
    )


class FinanceDuplicateException(Base):
    __tablename__ = "finance_duplicate_exceptions"
    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_finance_duplicate_exceptions_company_id"),
        ForeignKeyConstraint(
            ["company_id", "document_id"],
            ["finance_cost_documents.company_id", "finance_cost_documents.id"],
            name="fk_finance_duplicate_exceptions_document",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "conflicts_with_document_id"],
            ["finance_cost_documents.company_id", "finance_cost_documents.id"],
            name="fk_finance_duplicate_exceptions_conflict",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "document_id <> conflicts_with_document_id",
            name="ck_finance_duplicate_exceptions_distinct",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    conflicts_with_document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("now()")
    )
