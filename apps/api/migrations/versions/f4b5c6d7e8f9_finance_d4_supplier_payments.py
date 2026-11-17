"""Finance D4 supplier payments.

Revision ID: f4b5c6d7e8f9
Revises: f2a3b4c5d6e7
Create Date: 2026-10-10 20:50:00.000000

Adds supplier payment, allocation, and reversal tables. Does not alter D2
cost amounts or D2 trigger functions. A deferred constraint trigger on
finance_cost_documents rejects a later credit or invoice reversal that would
leave a negative supplier outstanding balance. That trigger does not replace
the D2 cost checks.

Payments settle gross payable. They do not create project cost, eligible cost,
or input VAT. Opening balances are left for D10: a later migration can add
finance_supplier_opening_balances and a second nullable composite foreign key,
with a check that exactly one target is set.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f4b5c6d7e8f9"
down_revision: Union[str, Sequence[str], None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = sa.Numeric(18, 4)

FINANCE_D4_FUNCTION_SQL = """
CREATE FUNCTION finance_supplier_gross_liability(doc_id uuid)
RETURNS numeric(18, 4)
LANGUAGE plpgsql
AS $$
DECLARE
    doc finance_cost_documents%ROWTYPE;
    credit_gross numeric(18, 4);
BEGIN
    SELECT * INTO doc FROM finance_cost_documents WHERE id = doc_id;
    IF NOT FOUND OR doc.status IS DISTINCT FROM 'posted' THEN
        RETURN 0;
    END IF;
    IF doc.document_type NOT IN ('supplier_invoice', 'expense_receipt') THEN
        RETURN 0;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM finance_cost_documents reversal_row
        WHERE reversal_row.reverses_document_id = doc.id
          AND reversal_row.document_type = 'reversal'
          AND reversal_row.status = 'posted'
    ) THEN
        RETURN 0;
    END IF;
    SELECT COALESCE(SUM(credit.gross_amount), 0)
    INTO credit_gross
    FROM finance_cost_documents credit
    WHERE credit.credited_document_id = doc.id
      AND credit.company_id = doc.company_id
      AND credit.document_type = 'supplier_credit'
      AND credit.status = 'posted'
      AND NOT EXISTS (
          SELECT 1
          FROM finance_cost_documents credit_reversal
          WHERE credit_reversal.reverses_document_id = credit.id
            AND credit_reversal.document_type = 'reversal'
            AND credit_reversal.status = 'posted'
      );
    RETURN doc.gross_amount + credit_gross;
END;
$$;

CREATE FUNCTION finance_supplier_allocated_to_document(doc_id uuid)
RETURNS numeric(18, 4)
LANGUAGE plpgsql
AS $$
DECLARE
    allocated numeric(18, 4);
BEGIN
    SELECT COALESCE(SUM(allocation.amount), 0)
    INTO allocated
    FROM finance_supplier_payment_allocations allocation
    JOIN finance_supplier_payments payment
      ON payment.id = allocation.payment_id
     AND payment.company_id = allocation.company_id
    WHERE allocation.cost_document_id = doc_id
      AND allocation.status = 'posted'
      AND payment.status = 'posted'
      AND NOT EXISTS (
          SELECT 1
          FROM finance_supplier_payment_allocation_reversals allocation_reversal
          WHERE allocation_reversal.allocation_id = allocation.id
            AND allocation_reversal.status = 'posted'
      )
      AND NOT EXISTS (
          SELECT 1
          FROM finance_supplier_payment_reversals payment_reversal
          WHERE payment_reversal.payment_id = payment.id
            AND payment_reversal.status = 'posted'
      );
    RETURN allocated;
END;
$$;

CREATE FUNCTION finance_supplier_allocated_from_payment(source_payment_id uuid)
RETURNS numeric(18, 4)
LANGUAGE plpgsql
AS $$
DECLARE
    allocated numeric(18, 4);
BEGIN
    SELECT COALESCE(SUM(allocation.amount), 0)
    INTO allocated
    FROM finance_supplier_payment_allocations allocation
    JOIN finance_supplier_payments payment
      ON payment.id = allocation.payment_id
     AND payment.company_id = allocation.company_id
    WHERE allocation.payment_id = source_payment_id
      AND allocation.status = 'posted'
      AND payment.status = 'posted'
      AND NOT EXISTS (
          SELECT 1
          FROM finance_supplier_payment_allocation_reversals allocation_reversal
          WHERE allocation_reversal.allocation_id = allocation.id
            AND allocation_reversal.status = 'posted'
      )
      AND NOT EXISTS (
          SELECT 1
          FROM finance_supplier_payment_reversals payment_reversal
          WHERE payment_reversal.payment_id = payment.id
            AND payment_reversal.status = 'posted'
      );
    RETURN allocated;
END;
$$;

CREATE FUNCTION finance_supplier_payment_available(source_payment_id uuid)
RETURNS numeric(18, 4)
LANGUAGE plpgsql
AS $$
DECLARE
    payment finance_supplier_payments%ROWTYPE;
    allocated numeric(18, 4);
BEGIN
    SELECT * INTO payment
    FROM finance_supplier_payments
    WHERE id = source_payment_id;
    IF NOT FOUND OR payment.status IS DISTINCT FROM 'posted' THEN
        RETURN 0;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM finance_supplier_payment_reversals payment_reversal
        WHERE payment_reversal.payment_id = payment.id
          AND payment_reversal.status = 'posted'
    ) THEN
        RETURN 0;
    END IF;
    allocated := finance_supplier_allocated_from_payment(payment.id);
    RETURN payment.amount - allocated;
END;
$$;

CREATE FUNCTION finance_supplier_payment_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    counterparty_type text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'posted' THEN
            RAISE EXCEPTION 'posted supplier payment cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
        RAISE EXCEPTION 'supplier payments must be inserted as drafts';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted supplier payment is immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
        SELECT finance_counterparties.counterparty_type
        INTO counterparty_type
        FROM finance_counterparties
        WHERE finance_counterparties.id = NEW.counterparty_id
          AND finance_counterparties.company_id = NEW.company_id
        FOR UPDATE;
        IF NOT FOUND OR counterparty_type IS DISTINCT FROM 'supplier' THEN
            RAISE EXCEPTION 'supplier payment requires a supplier counterparty';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION finance_supplier_payment_allocation_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    payment finance_supplier_payments%ROWTYPE;
    doc finance_cost_documents%ROWTYPE;
    counterparty_type text;
    liability numeric(18, 4);
    allocated numeric(18, 4);
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'posted' THEN
            RAISE EXCEPTION 'posted supplier payment allocation cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
        RAISE EXCEPTION 'supplier payment allocations must be inserted as drafts';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted supplier payment allocation is immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
        SELECT * INTO payment
        FROM finance_supplier_payments
        WHERE id = NEW.payment_id
        FOR UPDATE;
        IF NOT FOUND OR payment.company_id IS DISTINCT FROM NEW.company_id THEN
            RAISE EXCEPTION 'supplier payment allocation must stay in its company';
        END IF;
        IF payment.status IS DISTINCT FROM 'posted' THEN
            RAISE EXCEPTION 'supplier payment allocations require a posted payment';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM finance_supplier_payment_reversals payment_reversal
            WHERE payment_reversal.payment_id = payment.id
              AND payment_reversal.status = 'posted'
        ) THEN
            RAISE EXCEPTION 'cannot allocate a reversed supplier payment';
        END IF;
        SELECT * INTO doc
        FROM finance_cost_documents
        WHERE id = NEW.cost_document_id
        FOR UPDATE;
        IF NOT FOUND
            OR doc.company_id IS DISTINCT FROM NEW.company_id
            OR doc.company_id IS DISTINCT FROM payment.company_id
        THEN
            RAISE EXCEPTION 'supplier payment allocation must stay in its company';
        END IF;
        IF doc.status IS DISTINCT FROM 'posted'
            OR doc.document_type NOT IN ('supplier_invoice', 'expense_receipt')
        THEN
            RAISE EXCEPTION 'supplier payments allocate only to posted supplier invoices and expense receipts';
        END IF;
        IF doc.counterparty_id IS DISTINCT FROM payment.counterparty_id THEN
            RAISE EXCEPTION 'supplier payment allocation must use the same supplier';
        END IF;
        SELECT finance_counterparties.counterparty_type
        INTO counterparty_type
        FROM finance_counterparties
        WHERE finance_counterparties.id = payment.counterparty_id
          AND finance_counterparties.company_id = payment.company_id
        FOR UPDATE;
        IF NOT FOUND OR counterparty_type IS DISTINCT FROM 'supplier' THEN
            RAISE EXCEPTION 'supplier payment requires a supplier counterparty';
        END IF;
        PERFORM 1
        FROM finance_supplier_payment_allocations
        WHERE payment_id = NEW.payment_id
          AND id <> NEW.id
        ORDER BY id
        FOR UPDATE;
        PERFORM 1
        FROM finance_supplier_payment_allocations
        WHERE cost_document_id = NEW.cost_document_id
          AND id <> NEW.id
        ORDER BY id
        FOR UPDATE;
        IF NEW.amount > finance_supplier_payment_available(payment.id) THEN
            RAISE EXCEPTION 'payment allocation exceeds the unallocated payment amount';
        END IF;
        liability := finance_supplier_gross_liability(doc.id);
        allocated := finance_supplier_allocated_to_document(doc.id);
        IF allocated + NEW.amount > liability THEN
            RAISE EXCEPTION 'payment allocation exceeds the supplier outstanding balance';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION finance_supplier_payment_reversal_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    payment finance_supplier_payments%ROWTYPE;
    still_allocated numeric(18, 4);
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'posted' THEN
            RAISE EXCEPTION 'posted supplier payment reversal cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
        RAISE EXCEPTION 'supplier payment reversals must be inserted as drafts';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted supplier payment reversal is immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
        SELECT * INTO payment
        FROM finance_supplier_payments
        WHERE id = NEW.payment_id
        FOR UPDATE;
        IF NOT FOUND OR payment.company_id IS DISTINCT FROM NEW.company_id THEN
            RAISE EXCEPTION 'supplier payment reversal must stay in its company';
        END IF;
        IF payment.status IS DISTINCT FROM 'posted' THEN
            RAISE EXCEPTION 'only a posted supplier payment can be reversed';
        END IF;
        IF NEW.amount IS DISTINCT FROM payment.amount THEN
            RAISE EXCEPTION 'supplier payment reversal must match the payment amount';
        END IF;
        PERFORM 1
        FROM finance_supplier_payment_allocations
        WHERE payment_id = payment.id
        ORDER BY id
        FOR UPDATE;
        still_allocated := finance_supplier_allocated_from_payment(payment.id);
        IF still_allocated > 0 THEN
            RAISE EXCEPTION 'reverse supplier payment allocations before reversing the payment';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION finance_supplier_payment_allocation_reversal_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    allocation finance_supplier_payment_allocations%ROWTYPE;
    payment finance_supplier_payments%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'posted' THEN
            RAISE EXCEPTION 'posted supplier payment allocation reversal cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
        RAISE EXCEPTION 'supplier payment allocation reversals must be inserted as drafts';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted supplier payment allocation reversal is immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
        SELECT * INTO allocation
        FROM finance_supplier_payment_allocations
        WHERE id = NEW.allocation_id;
        IF NOT FOUND OR allocation.company_id IS DISTINCT FROM NEW.company_id THEN
            RAISE EXCEPTION 'supplier payment allocation reversal must stay in its company';
        END IF;
        SELECT * INTO payment
        FROM finance_supplier_payments
        WHERE id = allocation.payment_id
        FOR UPDATE;
        IF NOT FOUND OR payment.company_id IS DISTINCT FROM allocation.company_id THEN
            RAISE EXCEPTION 'supplier payment allocation reversal must stay in its company';
        END IF;
        PERFORM 1
        FROM finance_supplier_payment_allocations
        WHERE id = allocation.id
        FOR UPDATE;
        IF allocation.status IS DISTINCT FROM 'posted' THEN
            RAISE EXCEPTION 'only a posted supplier payment allocation can be reversed';
        END IF;
        IF NEW.amount IS DISTINCT FROM allocation.amount THEN
            RAISE EXCEPTION 'supplier payment allocation reversal must match the allocation amount';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM finance_supplier_payment_reversals payment_reversal
            WHERE payment_reversal.payment_id = payment.id
              AND payment_reversal.status = 'posted'
        ) THEN
            RAISE EXCEPTION 'cannot reverse an allocation after the supplier payment is reversed';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION finance_supplier_payable_document_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    source finance_cost_documents%ROWTYPE;
    source_id uuid;
    liability numeric(18, 4);
    allocated numeric(18, 4);
BEGIN
    IF NEW.status IS DISTINCT FROM 'posted' THEN
        RETURN NEW;
    END IF;
    IF NEW.document_type = 'supplier_credit' THEN
        source_id := NEW.credited_document_id;
    ELSIF NEW.document_type = 'reversal' THEN
        source_id := NEW.reverses_document_id;
    ELSE
        RETURN NEW;
    END IF;
    SELECT * INTO source
    FROM finance_cost_documents
    WHERE id = source_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'finance cost document parent was not found';
    END IF;
    IF NEW.document_type = 'reversal' AND source.document_type = 'supplier_credit' THEN
        source_id := source.credited_document_id;
        SELECT * INTO source
        FROM finance_cost_documents
        WHERE id = source_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'finance cost document parent was not found';
        END IF;
    END IF;
    IF source.document_type NOT IN ('supplier_invoice', 'expense_receipt') THEN
        RETURN NEW;
    END IF;
    PERFORM 1
    FROM finance_supplier_payment_allocations
    WHERE cost_document_id = source.id
    ORDER BY id
    FOR UPDATE;
    allocated := finance_supplier_allocated_to_document(source.id);
    IF NEW.document_type = 'reversal'
        AND NEW.reverses_document_id = source.id
        AND allocated > 0
    THEN
        RAISE EXCEPTION 'cannot reverse a supplier document that still has payment allocations';
    END IF;
    liability := finance_supplier_gross_liability(source.id);
    IF liability < allocated THEN
        RAISE EXCEPTION 'supplier credit exceeds the unpaid supplier balance';
    END IF;
    RETURN NEW;
END;
$$;
"""

FINANCE_D4_TRIGGER_SQL = """
CREATE TRIGGER trg_finance_supplier_payments_before_write
    BEFORE INSERT OR UPDATE OR DELETE ON finance_supplier_payments
    FOR EACH ROW EXECUTE FUNCTION finance_supplier_payment_before_write();

CREATE TRIGGER trg_finance_supplier_payment_allocations_before_write
    BEFORE INSERT OR UPDATE OR DELETE ON finance_supplier_payment_allocations
    FOR EACH ROW EXECUTE FUNCTION finance_supplier_payment_allocation_before_write();

CREATE TRIGGER trg_finance_supplier_payment_reversals_before_write
    BEFORE INSERT OR UPDATE OR DELETE ON finance_supplier_payment_reversals
    FOR EACH ROW EXECUTE FUNCTION finance_supplier_payment_reversal_before_write();

CREATE TRIGGER trg_finance_supplier_payment_allocation_reversals_before_write
    BEFORE INSERT OR UPDATE OR DELETE ON finance_supplier_payment_allocation_reversals
    FOR EACH ROW EXECUTE FUNCTION finance_supplier_payment_allocation_reversal_before_write();

CREATE CONSTRAINT TRIGGER trg_finance_cost_documents_supplier_payable
    AFTER INSERT OR UPDATE ON finance_cost_documents
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION finance_supplier_payable_document_guard();
"""

FINANCE_D4_TRIGGER_DROP_SQL = """
DROP TRIGGER IF EXISTS trg_finance_cost_documents_supplier_payable ON finance_cost_documents;
DROP TRIGGER IF EXISTS trg_finance_supplier_payment_allocation_reversals_before_write ON finance_supplier_payment_allocation_reversals;
DROP TRIGGER IF EXISTS trg_finance_supplier_payment_reversals_before_write ON finance_supplier_payment_reversals;
DROP TRIGGER IF EXISTS trg_finance_supplier_payment_allocations_before_write ON finance_supplier_payment_allocations;
DROP TRIGGER IF EXISTS trg_finance_supplier_payments_before_write ON finance_supplier_payments;
DROP FUNCTION IF EXISTS finance_supplier_payable_document_guard();
DROP FUNCTION IF EXISTS finance_supplier_payment_allocation_reversal_before_write();
DROP FUNCTION IF EXISTS finance_supplier_payment_reversal_before_write();
DROP FUNCTION IF EXISTS finance_supplier_payment_allocation_before_write();
DROP FUNCTION IF EXISTS finance_supplier_payment_before_write();
DROP FUNCTION IF EXISTS finance_supplier_payment_available(uuid);
DROP FUNCTION IF EXISTS finance_supplier_allocated_from_payment(uuid);
DROP FUNCTION IF EXISTS finance_supplier_allocated_to_document(uuid);
DROP FUNCTION IF EXISTS finance_supplier_gross_liability(uuid);
"""


def _uuid() -> postgresql.UUID:
    return postgresql.UUID(as_uuid=True)


def _company_id() -> sa.Column:
    return sa.Column(
        "company_id",
        _uuid(),
        sa.ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
    )


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    ]


def upgrade() -> None:
    op.create_table(
        "finance_supplier_payments",
        sa.Column("id", _uuid(), primary_key=True),
        _company_id(),
        sa.Column("counterparty_id", _uuid(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("payment_date", sa.Date(), nullable=True),
        sa.Column("payment_method", sa.String(32), nullable=True),
        sa.Column("external_reference", sa.String(120), nullable=True),
        sa.Column("normalized_reference", sa.String(120), nullable=True),
        sa.Column("currency_code", sa.String(3), nullable=False, server_default="GBP"),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", _uuid(), nullable=True),
        sa.Column("posted_by_user_id", _uuid(), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("company_id", "id", name="uq_finance_supplier_payments_company_id"),
        sa.ForeignKeyConstraint(
            ["company_id", "counterparty_id"],
            ["finance_counterparties.company_id", "finance_counterparties.id"],
            name="fk_finance_supplier_payments_counterparty",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_finance_supplier_payments_status"),
        sa.CheckConstraint("amount > 0", name="ck_finance_supplier_payments_positive"),
        sa.CheckConstraint("currency_code = 'GBP'", name="ck_finance_supplier_payments_gbp"),
        sa.CheckConstraint(
            "payment_method IS NULL OR payment_method IN ('bank_transfer', 'card', 'cash', 'cheque', 'other')",
            name="ck_finance_supplier_payments_method",
        ),
        sa.CheckConstraint(
            "status <> 'posted' OR (counterparty_id IS NOT NULL AND payment_date IS NOT NULL AND posted_at IS NOT NULL)",
            name="ck_finance_supplier_payments_posted_required",
        ),
    )
    op.create_index("ix_finance_supplier_payments_company_id", "finance_supplier_payments", ["company_id"])
    op.create_index(
        "ix_finance_supplier_payments_counterparty_id",
        "finance_supplier_payments",
        ["counterparty_id"],
    )
    op.create_index(
        "uq_finance_supplier_payments_posted_reference",
        "finance_supplier_payments",
        ["company_id", "counterparty_id", "normalized_reference"],
        unique=True,
        postgresql_where=sa.text("status = 'posted' AND normalized_reference IS NOT NULL"),
    )

    op.create_table(
        "finance_supplier_payment_allocations",
        sa.Column("id", _uuid(), primary_key=True),
        _company_id(),
        sa.Column("payment_id", _uuid(), nullable=False),
        sa.Column("cost_document_id", _uuid(), nullable=False),
        sa.Column("allocation_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("created_by_user_id", _uuid(), nullable=True),
        sa.Column("posted_by_user_id", _uuid(), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("company_id", "id", name="uq_finance_supplier_payment_allocations_company_id"),
        sa.UniqueConstraint(
            "payment_id",
            "allocation_number",
            name="uq_finance_supplier_payment_allocations_number",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "payment_id"],
            ["finance_supplier_payments.company_id", "finance_supplier_payments.id"],
            name="fk_finance_supplier_payment_allocations_payment",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "cost_document_id"],
            ["finance_cost_documents.company_id", "finance_cost_documents.id"],
            name="fk_finance_supplier_payment_allocations_document",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'posted')",
            name="ck_finance_supplier_payment_allocations_status",
        ),
        sa.CheckConstraint("allocation_number >= 1", name="ck_finance_supplier_payment_allocations_number"),
        sa.CheckConstraint("amount > 0", name="ck_finance_supplier_payment_allocations_positive"),
        sa.CheckConstraint(
            "status <> 'posted' OR posted_at IS NOT NULL",
            name="ck_finance_supplier_payment_allocations_posted_required",
        ),
    )
    op.create_index(
        "ix_finance_supplier_payment_allocations_company_id",
        "finance_supplier_payment_allocations",
        ["company_id"],
    )
    op.create_index(
        "ix_finance_supplier_payment_allocations_payment_id",
        "finance_supplier_payment_allocations",
        ["payment_id"],
    )
    op.create_index(
        "ix_finance_supplier_payment_allocations_cost_document_id",
        "finance_supplier_payment_allocations",
        ["cost_document_id"],
    )

    op.create_table(
        "finance_supplier_payment_reversals",
        sa.Column("id", _uuid(), primary_key=True),
        _company_id(),
        sa.Column("payment_id", _uuid(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", _uuid(), nullable=True),
        sa.Column("posted_by_user_id", _uuid(), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("company_id", "id", name="uq_finance_supplier_payment_reversals_company_id"),
        sa.UniqueConstraint("payment_id", name="uq_finance_supplier_payment_reversals_payment"),
        sa.ForeignKeyConstraint(
            ["company_id", "payment_id"],
            ["finance_supplier_payments.company_id", "finance_supplier_payments.id"],
            name="fk_finance_supplier_payment_reversals_payment",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'posted')",
            name="ck_finance_supplier_payment_reversals_status",
        ),
        sa.CheckConstraint("amount > 0", name="ck_finance_supplier_payment_reversals_positive"),
        sa.CheckConstraint(
            "status <> 'posted' OR posted_at IS NOT NULL",
            name="ck_finance_supplier_payment_reversals_posted_required",
        ),
    )
    op.create_index(
        "ix_finance_supplier_payment_reversals_company_id",
        "finance_supplier_payment_reversals",
        ["company_id"],
    )
    op.create_index(
        "ix_finance_supplier_payment_reversals_payment_id",
        "finance_supplier_payment_reversals",
        ["payment_id"],
    )

    op.create_table(
        "finance_supplier_payment_allocation_reversals",
        sa.Column("id", _uuid(), primary_key=True),
        _company_id(),
        sa.Column("allocation_id", _uuid(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", _uuid(), nullable=True),
        sa.Column("posted_by_user_id", _uuid(), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint(
            "company_id",
            "id",
            name="uq_finance_supplier_payment_allocation_reversals_company_id",
        ),
        sa.UniqueConstraint(
            "allocation_id",
            name="uq_finance_supplier_payment_allocation_reversals_allocation",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "allocation_id"],
            [
                "finance_supplier_payment_allocations.company_id",
                "finance_supplier_payment_allocations.id",
            ],
            name="fk_finance_supplier_payment_allocation_reversals_allocation",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'posted')",
            name="ck_finance_supplier_payment_allocation_reversals_status",
        ),
        sa.CheckConstraint(
            "amount > 0",
            name="ck_finance_supplier_payment_allocation_reversals_positive",
        ),
        sa.CheckConstraint(
            "status <> 'posted' OR posted_at IS NOT NULL",
            name="ck_fin_sup_pay_alloc_rev_posted_req",
        ),
    )
    op.create_index(
        "ix_finance_supplier_payment_allocation_reversals_company_id",
        "finance_supplier_payment_allocation_reversals",
        ["company_id"],
    )
    op.create_index(
        "ix_finance_supplier_payment_allocation_reversals_allocation_id",
        "finance_supplier_payment_allocation_reversals",
        ["allocation_id"],
    )

    op.execute(FINANCE_D4_FUNCTION_SQL)
    op.execute(FINANCE_D4_TRIGGER_SQL)


def downgrade() -> None:
    op.execute(FINANCE_D4_TRIGGER_DROP_SQL)
    op.drop_table("finance_supplier_payment_allocation_reversals")
    op.drop_table("finance_supplier_payment_reversals")
    op.drop_table("finance_supplier_payment_allocations")
    op.drop_table("finance_supplier_payments")
