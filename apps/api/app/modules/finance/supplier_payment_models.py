"""Supplier payment tables for the D4-A settlement foundation.

A payment settles an existing supplier liability. It does not create project
cost, eligible cost, or input VAT. Gross on a cost document is not evidence
that a payment happened.

Historical opening balances are D10 and have no table yet. This allocation
table therefore has a required cost_document_id and no opening-balance column.
A later additive migration can add finance_supplier_opening_balances with
UNIQUE (company_id, id), then add a nullable opening_balance_id composite
foreign key and a check that exactly one of cost_document_id or
opening_balance_id is set. That is two typed foreign keys, not one polymorphic
type and id pair.

Posted rows are immutable. Corrections are new reversal rows. A posted
payment reversal leaves zero available money: reversing allocations restores
that money only while the payment itself remains effective. Audit rows for
these records continue to use finance_audit_events; this module does not add
an audit table. Suggested entity_type values for a later service are
supplier_payment, supplier_payment_allocation, supplier_payment_reversal, and
supplier_payment_allocation_reversal.

Importing this module registers the tables on the shared Finance metadata.
The canonical app.db.models registry also imports it.

The posted payment-reference unique index is created in the D4 migration.
It is partial, so it is not declared as an ORM Index on this table.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
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


class FinanceSupplierPayment(Base):
    __tablename__ = "finance_supplier_payments"
    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_finance_supplier_payments_company_id"),
        ForeignKeyConstraint(
            ["company_id", "counterparty_id"],
            ["finance_counterparties.company_id", "finance_counterparties.id"],
            name="fk_finance_supplier_payments_counterparty",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "status IN ('draft', 'posted')",
            name="ck_finance_supplier_payments_status",
        ),
        CheckConstraint("amount > 0", name="ck_finance_supplier_payments_positive"),
        CheckConstraint(
            f"currency_code = '{SUPPORTED_CURRENCY_CODE}'",
            name="ck_finance_supplier_payments_gbp",
        ),
        CheckConstraint(
            "payment_method IS NULL OR payment_method IN "
            "('bank_transfer', 'card', 'cash', 'cheque', 'other')",
            name="ck_finance_supplier_payments_method",
        ),
        CheckConstraint(
            "status <> 'posted' OR ("
            "counterparty_id IS NOT NULL AND payment_date IS NOT NULL AND posted_at IS NOT NULL"
            ")",
            name="ck_finance_supplier_payments_posted_required",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
    )
    counterparty_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    external_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    normalized_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    currency_code: Mapped[str] = mapped_column(
        String(3), nullable=False, default=SUPPORTED_CURRENCY_CODE, server_default="GBP"
    )
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
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


class FinanceSupplierPaymentAllocation(Base):
    """Settles gross payable on one posted supplier invoice or expense receipt.

    cost_document_id stays required until D10 adds a separate opening-balance
    foreign key. There is no project, cost code, or VAT column on this table.
    """

    __tablename__ = "finance_supplier_payment_allocations"
    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_finance_supplier_payment_allocations_company_id"),
        UniqueConstraint(
            "payment_id",
            "allocation_number",
            name="uq_finance_supplier_payment_allocations_number",
        ),
        ForeignKeyConstraint(
            ["company_id", "payment_id"],
            ["finance_supplier_payments.company_id", "finance_supplier_payments.id"],
            name="fk_finance_supplier_payment_allocations_payment",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "cost_document_id"],
            ["finance_cost_documents.company_id", "finance_cost_documents.id"],
            name="fk_finance_supplier_payment_allocations_document",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "status IN ('draft', 'posted')",
            name="ck_finance_supplier_payment_allocations_status",
        ),
        CheckConstraint("allocation_number >= 1", name="ck_finance_supplier_payment_allocations_number"),
        CheckConstraint("amount > 0", name="ck_finance_supplier_payment_allocations_positive"),
        CheckConstraint(
            "status <> 'posted' OR posted_at IS NOT NULL",
            name="ck_finance_supplier_payment_allocations_posted_required",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
    )
    payment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    cost_document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    allocation_number: Mapped[int] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
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


class FinanceSupplierPaymentReversal(Base):
    """Exact reversal of one supplier payment. The payment row is not edited."""

    __tablename__ = "finance_supplier_payment_reversals"
    __table_args__ = (
        UniqueConstraint("company_id", "id", name="uq_finance_supplier_payment_reversals_company_id"),
        UniqueConstraint("payment_id", name="uq_finance_supplier_payment_reversals_payment"),
        ForeignKeyConstraint(
            ["company_id", "payment_id"],
            ["finance_supplier_payments.company_id", "finance_supplier_payments.id"],
            name="fk_finance_supplier_payment_reversals_payment",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "status IN ('draft', 'posted')",
            name="ck_finance_supplier_payment_reversals_status",
        ),
        CheckConstraint("amount > 0", name="ck_finance_supplier_payment_reversals_positive"),
        CheckConstraint(
            "status <> 'posted' OR posted_at IS NOT NULL",
            name="ck_finance_supplier_payment_reversals_posted_required",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
    )
    payment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
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


class FinanceSupplierPaymentAllocationReversal(Base):
    """Exact reversal of one payment allocation. The allocation row is not edited."""

    __tablename__ = "finance_supplier_payment_allocation_reversals"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "id",
            name="uq_finance_supplier_payment_allocation_reversals_company_id",
        ),
        UniqueConstraint(
            "allocation_id",
            name="uq_finance_supplier_payment_allocation_reversals_allocation",
        ),
        ForeignKeyConstraint(
            ["company_id", "allocation_id"],
            [
                "finance_supplier_payment_allocations.company_id",
                "finance_supplier_payment_allocations.id",
            ],
            name="fk_finance_supplier_payment_allocation_reversals_allocation",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "status IN ('draft', 'posted')",
            name="ck_finance_supplier_payment_allocation_reversals_status",
        ),
        CheckConstraint("amount > 0", name="ck_finance_supplier_payment_allocation_reversals_positive"),
        CheckConstraint(
            "status <> 'posted' OR posted_at IS NOT NULL",
            name="ck_fin_sup_pay_alloc_rev_posted_req",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
    )
    allocation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
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
