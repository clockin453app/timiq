"""Finance extensions for CIS, PAYE, customers, commercial control, and funding.

Revision ID: f5c6d7e8f9a0
Revises: f4b5c6d7e8f9
Create Date: 2026-10-10 23:40:00.000000

Additive only. Does not alter payroll, attendance, or existing Finance tables.
Source payroll ids are copied UUIDs with no foreign key into operational payroll.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f5c6d7e8f9a0"
down_revision: Union[str, Sequence[str], None] = "f4b5c6d7e8f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = sa.Numeric(18, 4)


def _money(name: str, *, nullable: bool = False):
    return sa.Column(name, MONEY, nullable=nullable)


def _timestamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    ]


def _posted_columns():
    return [
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("posted_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        "finance_cis_payroll_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_payroll_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_payroll_period_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("timezone_name", sa.String(64), nullable=False),
        sa.Column("supersedes_snapshot_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        _money("gross_amount"),
        _money("tax_amount", nullable=True),
        _money("net_amount", nullable=True),
        _money("display_tax_amount", nullable=True),
        _money("display_net_amount", nullable=True),
        _money("other_deductions_amount"),
        sa.Column("payment_mode", sa.String(32), nullable=False),
        _money("effective_cis_deduction"),
        _money("effective_payable_amount"),
        sa.Column("amounts_do_not_reconcile", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("source_status", sa.String(16), nullable=False),
        sa.Column("source_approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_hash", sa.String(64), nullable=False),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("company_id", "id", name="uq_fin_cis_snap_company_id"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_cis_snap_status"),
        sa.CheckConstraint("revision_number >= 1", name="ck_fin_cis_snap_revision"),
        sa.CheckConstraint(
            "payment_mode IN ('net_payment', 'gross_payment')",
            name="ck_fin_cis_snap_mode",
        ),
        sa.CheckConstraint(
            "payment_mode <> 'gross_payment' OR effective_cis_deduction = 0",
            name="ck_fin_cis_snap_gross_cis",
        ),
        sa.CheckConstraint(
            "status <> 'posted' OR posted_at IS NOT NULL",
            name="ck_fin_cis_snap_posted",
        ),
    )
    op.create_foreign_key(
        "fk_fin_cis_snap_supersedes",
        "finance_cis_payroll_snapshots",
        "finance_cis_payroll_snapshots",
        ["company_id", "supersedes_snapshot_id"],
        ["company_id", "id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "uq_fin_cis_snap_root",
        "finance_cis_payroll_snapshots",
        ["company_id", "source_payroll_item_id"],
        unique=True,
        postgresql_where=sa.text("supersedes_snapshot_id IS NULL"),
    )
    op.create_index(
        "uq_fin_cis_snap_successor",
        "finance_cis_payroll_snapshots",
        ["company_id", "supersedes_snapshot_id"],
        unique=True,
        postgresql_where=sa.text("supersedes_snapshot_id IS NOT NULL"),
    )
    op.create_index(
        "uq_fin_cis_snap_revision",
        "finance_cis_payroll_snapshots",
        ["company_id", "source_payroll_item_id", "revision_number"],
        unique=True,
    )

    op.create_table(
        "finance_paye_payroll_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_paye_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_paye_period_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tax_year", sa.String(9), nullable=False),
        sa.Column("tax_month", sa.Integer(), nullable=False),
        sa.Column("supersedes_snapshot_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        _money("gross_pay"),
        _money("paye_tax"),
        _money("employee_ni"),
        _money("employer_ni"),
        _money("employee_pension"),
        _money("employer_pension"),
        _money("student_loan"),
        _money("postgraduate_loan"),
        _money("other_deductions"),
        _money("net_pay"),
        sa.Column("source_status", sa.String(16), nullable=False),
        sa.Column("source_paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_hash", sa.String(64), nullable=False),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("company_id", "id", name="uq_fin_paye_snap_company_id"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_paye_snap_status"),
        sa.CheckConstraint("revision_number >= 1", name="ck_fin_paye_snap_revision"),
        sa.CheckConstraint("tax_month BETWEEN 1 AND 12", name="ck_fin_paye_snap_month"),
        sa.CheckConstraint("status <> 'posted' OR posted_at IS NOT NULL", name="ck_fin_paye_snap_posted"),
    )
    op.create_foreign_key(
        "fk_fin_paye_snap_supersedes",
        "finance_paye_payroll_snapshots",
        "finance_paye_payroll_snapshots",
        ["company_id", "supersedes_snapshot_id"],
        ["company_id", "id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "uq_fin_paye_snap_root",
        "finance_paye_payroll_snapshots",
        ["company_id", "source_paye_item_id"],
        unique=True,
        postgresql_where=sa.text("supersedes_snapshot_id IS NULL"),
    )
    op.create_index(
        "uq_fin_paye_snap_successor",
        "finance_paye_payroll_snapshots",
        ["company_id", "supersedes_snapshot_id"],
        unique=True,
        postgresql_where=sa.text("supersedes_snapshot_id IS NOT NULL"),
    )

    op.create_table(
        "finance_worker_payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=True),
        sa.Column("payment_method", sa.String(32), nullable=True),
        sa.Column("external_reference", sa.String(120), nullable=True),
        sa.Column("normalized_reference", sa.String(120), nullable=True),
        sa.Column("currency_code", sa.String(3), nullable=False, server_default="GBP"),
        _money("amount"),
        sa.Column("notes", sa.Text(), nullable=True),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("company_id", "id", name="uq_fin_worker_pay_company_id"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_worker_pay_status"),
        sa.CheckConstraint("amount > 0", name="ck_fin_worker_pay_positive"),
        sa.CheckConstraint("currency_code = 'GBP'", name="ck_fin_worker_pay_gbp"),
        sa.CheckConstraint(
            "payment_method IS NULL OR payment_method IN ('bank_transfer', 'card', 'cash', 'cheque', 'other')",
            name="ck_fin_worker_pay_method",
        ),
        sa.CheckConstraint(
            "status <> 'posted' OR (payment_date IS NOT NULL AND posted_at IS NOT NULL)",
            name="ck_fin_worker_pay_posted",
        ),
    )
    op.create_table(
        "finance_worker_payment_allocations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cis_snapshot_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("paye_snapshot_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("allocation_number", sa.Integer(), nullable=False),
        _money("amount"),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["company_id", "payment_id"],
            ["finance_worker_payments.company_id", "finance_worker_payments.id"],
            name="fk_fin_worker_alloc_payment",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "cis_snapshot_id"],
            ["finance_cis_payroll_snapshots.company_id", "finance_cis_payroll_snapshots.id"],
            name="fk_fin_worker_alloc_cis",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "paye_snapshot_id"],
            ["finance_paye_payroll_snapshots.company_id", "finance_paye_payroll_snapshots.id"],
            name="fk_fin_worker_alloc_paye",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("company_id", "id", name="uq_fin_worker_alloc_company_id"),
        sa.UniqueConstraint("payment_id", "allocation_number", name="uq_fin_worker_alloc_number"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_worker_alloc_status"),
        sa.CheckConstraint("amount > 0", name="ck_fin_worker_alloc_positive"),
        sa.CheckConstraint("allocation_number >= 1", name="ck_fin_worker_alloc_number"),
        sa.CheckConstraint(
            "(cis_snapshot_id IS NOT NULL AND paye_snapshot_id IS NULL) OR "
            "(cis_snapshot_id IS NULL AND paye_snapshot_id IS NOT NULL)",
            name="ck_fin_worker_alloc_one_target",
        ),
        sa.CheckConstraint("status <> 'posted' OR posted_at IS NOT NULL", name="ck_fin_worker_alloc_posted"),
    )
    op.create_table(
        "finance_worker_payment_reversals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payment_id", postgresql.UUID(as_uuid=True), nullable=False),
        _money("amount"),
        sa.Column("reason", sa.Text(), nullable=True),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["company_id", "payment_id"],
            ["finance_worker_payments.company_id", "finance_worker_payments.id"],
            name="fk_fin_worker_pay_rev_payment",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("company_id", "id", name="uq_fin_worker_pay_rev_company_id"),
        sa.UniqueConstraint("payment_id", name="uq_fin_worker_pay_rev_payment"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_worker_pay_rev_status"),
        sa.CheckConstraint("amount > 0", name="ck_fin_worker_pay_rev_positive"),
        sa.CheckConstraint("status <> 'posted' OR posted_at IS NOT NULL", name="ck_fin_worker_pay_rev_posted"),
    )
    op.create_table(
        "finance_worker_payment_allocation_reversals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("allocation_id", postgresql.UUID(as_uuid=True), nullable=False),
        _money("amount"),
        sa.Column("reason", sa.Text(), nullable=True),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["company_id", "allocation_id"],
            ["finance_worker_payment_allocations.company_id", "finance_worker_payment_allocations.id"],
            name="fk_fin_worker_alloc_rev_alloc",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("company_id", "id", name="uq_fin_worker_alloc_rev_company"),
        sa.UniqueConstraint("allocation_id", name="uq_fin_worker_alloc_rev_alloc"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_worker_alloc_rev_status"),
        sa.CheckConstraint("amount > 0", name="ck_fin_worker_alloc_rev_positive"),
        sa.CheckConstraint("status <> 'posted' OR posted_at IS NOT NULL", name="ck_fin_w_alloc_rev_posted"),
    )

    _commercial_tables()
    op.execute(_FUNCTION_SQL)
    op.execute(_TRIGGER_SQL)


def _commercial_tables() -> None:
    op.create_table(
        "finance_customer_invoices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("counterparty_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("document_kind", sa.String(16), nullable=False),
        sa.Column("external_reference", sa.String(120), nullable=True),
        sa.Column("normalized_reference", sa.String(120), nullable=True),
        sa.Column("document_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("currency_code", sa.String(3), nullable=False, server_default="GBP"),
        _money("net_amount"),
        _money("tax_amount"),
        _money("gross_amount"),
        sa.Column("reverses_invoice_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("credits_invoice_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("review_required", sa.Boolean(), nullable=False, server_default=sa.false()),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["company_id", "counterparty_id"],
            ["finance_counterparties.company_id", "finance_counterparties.id"],
            name="fk_fin_cust_inv_party",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "project_id"],
            ["finance_projects.company_id", "finance_projects.id"],
            name="fk_fin_cust_inv_project",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("company_id", "id", name="uq_fin_cust_inv_company_id"),
        sa.CheckConstraint("document_kind IN ('invoice', 'credit', 'reversal')", name="ck_fin_cust_inv_kind"),
        sa.CheckConstraint("gross_amount = net_amount + tax_amount", name="ck_fin_cust_inv_gross"),
        sa.CheckConstraint("currency_code = 'GBP'", name="ck_fin_cust_inv_gbp"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_cust_inv_status"),
        sa.CheckConstraint(
            "status <> 'posted' OR ("
            "(document_kind = 'invoice' AND gross_amount > 0 AND credits_invoice_id IS NULL AND reverses_invoice_id IS NULL) OR "
            "(document_kind = 'credit' AND gross_amount < 0 AND credits_invoice_id IS NOT NULL) OR "
            "(document_kind = 'reversal' AND reverses_invoice_id IS NOT NULL)"
            ")",
            name="ck_fin_cust_inv_posted_shape",
        ),
    )
    op.create_foreign_key(
        "fk_fin_cust_inv_credits",
        "finance_customer_invoices",
        "finance_customer_invoices",
        ["company_id", "credits_invoice_id"],
        ["company_id", "id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_fin_cust_inv_reverses",
        "finance_customer_invoices",
        "finance_customer_invoices",
        ["company_id", "reverses_invoice_id"],
        ["company_id", "id"],
        ondelete="RESTRICT",
    )
    op.create_table(
        "finance_customer_invoice_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("line_number", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("taxable", sa.Boolean(), nullable=False, server_default=sa.true()),
        _money("net_amount"),
        _money("tax_amount"),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["company_id", "invoice_id"],
            ["finance_customer_invoices.company_id", "finance_customer_invoices.id"],
            name="fk_fin_cust_line_invoice",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("invoice_id", "line_number", name="uq_fin_cust_line_number"),
        sa.CheckConstraint("line_number >= 1", name="ck_fin_cust_line_number"),
    )
    op.create_table(
        "finance_customer_receipts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("counterparty_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("receipt_date", sa.Date(), nullable=True),
        sa.Column("external_reference", sa.String(120), nullable=True),
        sa.Column("currency_code", sa.String(3), nullable=False, server_default="GBP"),
        _money("amount"),
        sa.Column("notes", sa.Text(), nullable=True),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["company_id", "counterparty_id"],
            ["finance_counterparties.company_id", "finance_counterparties.id"],
            name="fk_fin_cust_rcpt_party",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("company_id", "id", name="uq_fin_cust_rcpt_company_id"),
        sa.CheckConstraint("amount > 0", name="ck_fin_cust_rcpt_positive"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_cust_rcpt_status"),
        sa.CheckConstraint("currency_code = 'GBP'", name="ck_fin_cust_rcpt_gbp"),
        sa.CheckConstraint(
            "status <> 'posted' OR (receipt_date IS NOT NULL AND posted_at IS NOT NULL)",
            name="ck_fin_cust_rcpt_posted",
        ),
    )
    op.create_table(
        "finance_customer_receipt_allocations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("receipt_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("allocation_number", sa.Integer(), nullable=False),
        _money("amount"),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["company_id", "receipt_id"],
            ["finance_customer_receipts.company_id", "finance_customer_receipts.id"],
            name="fk_fin_cust_alloc_receipt",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "invoice_id"],
            ["finance_customer_invoices.company_id", "finance_customer_invoices.id"],
            name="fk_fin_cust_alloc_invoice",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("receipt_id", "allocation_number", name="uq_fin_cust_alloc_number"),
        sa.UniqueConstraint("company_id", "id", name="uq_fin_cust_alloc_company_id"),
        sa.CheckConstraint("amount > 0", name="ck_fin_cust_alloc_positive"),
        sa.CheckConstraint("allocation_number >= 1", name="ck_fin_cust_alloc_number"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_cust_alloc_status"),
        sa.CheckConstraint("status <> 'posted' OR posted_at IS NOT NULL", name="ck_fin_cust_alloc_posted"),
    )
    op.create_table(
        "finance_customer_receipt_reversals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("receipt_id", postgresql.UUID(as_uuid=True), nullable=False),
        _money("amount"),
        sa.Column("reason", sa.Text(), nullable=True),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["company_id", "receipt_id"],
            ["finance_customer_receipts.company_id", "finance_customer_receipts.id"],
            name="fk_fin_cust_rcpt_rev",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("receipt_id", name="uq_fin_cust_rcpt_rev_receipt"),
        sa.CheckConstraint("amount > 0", name="ck_fin_cust_rcpt_rev_positive"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_cust_rcpt_rev_status"),
        sa.CheckConstraint("status <> 'posted' OR posted_at IS NOT NULL", name="ck_fin_cust_rcpt_rev_posted"),
    )
    op.create_table(
        "finance_customer_receipt_allocation_reversals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("allocation_id", postgresql.UUID(as_uuid=True), nullable=False),
        _money("amount"),
        sa.Column("reason", sa.Text(), nullable=True),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["company_id", "allocation_id"],
            ["finance_customer_receipt_allocations.company_id", "finance_customer_receipt_allocations.id"],
            name="fk_fin_cust_alloc_rev",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("allocation_id", name="uq_fin_cust_alloc_rev_alloc"),
        sa.CheckConstraint("amount > 0", name="ck_fin_cust_alloc_rev_positive"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_cust_alloc_rev_status"),
        sa.CheckConstraint("status <> 'posted' OR posted_at IS NOT NULL", name="ck_fin_c_alloc_rev_posted"),
    )
    op.create_table(
        "finance_payment_applications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("counterparty_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("application_number", sa.Integer(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        _money("applied_net"),
        sa.Column("notes", sa.Text(), nullable=True),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["company_id", "project_id"],
            ["finance_projects.company_id", "finance_projects.id"],
            name="fk_fin_application_project",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "counterparty_id"],
            ["finance_counterparties.company_id", "finance_counterparties.id"],
            name="fk_fin_application_party",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("company_id", "id", name="uq_fin_application_company_id"),
        sa.UniqueConstraint("project_id", "application_number", name="uq_fin_application_number"),
        sa.CheckConstraint("applied_net >= 0", name="ck_fin_application_applied"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_application_status"),
        sa.CheckConstraint("period_end >= period_start", name="ck_fin_application_period"),
    )
    op.create_table(
        "finance_payment_certificates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("application_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("certificate_reference", sa.String(120), nullable=False),
        _money("certified_net"),
        _money("retention_rate"),
        _money("retention_withheld"),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=True),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["company_id", "application_id"],
            ["finance_payment_applications.company_id", "finance_payment_applications.id"],
            name="fk_fin_certificate_application",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "invoice_id"],
            ["finance_customer_invoices.company_id", "finance_customer_invoices.id"],
            name="fk_fin_certificate_invoice",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("company_id", "id", name="uq_fin_certificate_company_id"),
        sa.UniqueConstraint("application_id", name="uq_fin_certificate_application"),
        sa.CheckConstraint("certified_net >= 0", name="ck_fin_certificate_certified"),
        sa.CheckConstraint("retention_rate >= 0 AND retention_rate <= 100", name="ck_fin_certificate_rate"),
        sa.CheckConstraint("retention_withheld >= 0", name="ck_fin_certificate_retention"),
        sa.CheckConstraint("retention_withheld <= certified_net", name="ck_fin_certificate_retention_cap"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_certificate_status"),
    )
    op.create_table(
        "finance_retention_releases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("certificate_id", postgresql.UUID(as_uuid=True), nullable=False),
        _money("amount"),
        sa.Column("release_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["company_id", "certificate_id"],
            ["finance_payment_certificates.company_id", "finance_payment_certificates.id"],
            name="fk_fin_retention_certificate",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("company_id", "id", name="uq_fin_retention_company_id"),
        sa.CheckConstraint("amount > 0", name="ck_fin_retention_positive"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_retention_status"),
    )
    op.create_table(
        "finance_variations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("counterparty_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reference_code", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        _money("requested_value"),
        _money("submitted_value"),
        _money("approved_value"),
        sa.Column("approval_status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["company_id", "project_id"],
            ["finance_projects.company_id", "finance_projects.id"],
            name="fk_fin_variation_project",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("company_id", "project_id", "reference_code", name="uq_fin_variation_ref"),
        sa.CheckConstraint(
            "approval_status IN ('draft', 'submitted', 'approved', 'rejected')",
            name="ck_fin_variation_status",
        ),
        sa.CheckConstraint(
            "approval_status <> 'approved' OR approved_at IS NOT NULL",
            name="ck_fin_variation_approved",
        ),
    )
    op.create_table(
        "finance_dayworks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reference_code", sa.String(120), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        _money("submitted_value"),
        _money("approved_value"),
        sa.Column("approval_status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("counts_in_contract_value", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["company_id", "project_id"],
            ["finance_projects.company_id", "finance_projects.id"],
            name="fk_fin_daywork_project",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("company_id", "project_id", "reference_code", name="uq_fin_daywork_ref"),
        sa.CheckConstraint(
            "approval_status IN ('draft', 'submitted', 'approved', 'rejected')",
            name="ck_fin_daywork_status",
        ),
        sa.CheckConstraint(
            "counts_in_contract_value = false OR approval_status = 'approved'",
            name="ck_fin_daywork_contract",
        ),
    )
    op.create_table(
        "finance_commitments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cost_code_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("counterparty_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reference_code", sa.String(120), nullable=False),
        _money("committed_amount"),
        sa.Column("commitment_status", sa.String(16), nullable=False, server_default="open"),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["company_id", "project_id"],
            ["finance_projects.company_id", "finance_projects.id"],
            name="fk_fin_commitment_project",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "cost_code_id"],
            ["finance_cost_codes.company_id", "finance_cost_codes.id"],
            name="fk_fin_commitment_code",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "counterparty_id"],
            ["finance_counterparties.company_id", "finance_counterparties.id"],
            name="fk_fin_commitment_party",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("company_id", "id", name="uq_fin_commitment_company_id"),
        sa.UniqueConstraint("company_id", "reference_code", name="uq_fin_commitment_ref"),
        sa.CheckConstraint("committed_amount >= 0", name="ck_fin_commitment_amount"),
        sa.CheckConstraint("commitment_status IN ('open', 'closed')", name="ck_fin_commitment_state"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_commitment_status"),
    )
    op.create_table(
        "finance_commitment_draws",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("commitment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cost_document_id", postgresql.UUID(as_uuid=True), nullable=False),
        _money("amount"),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["company_id", "commitment_id"],
            ["finance_commitments.company_id", "finance_commitments.id"],
            name="fk_fin_draw_commitment",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "cost_document_id"],
            ["finance_cost_documents.company_id", "finance_cost_documents.id"],
            name="fk_fin_draw_document",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("company_id", "commitment_id", "cost_document_id", name="uq_fin_draw_once"),
        sa.CheckConstraint("amount > 0", name="ck_fin_draw_positive"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_draw_status"),
    )
    op.create_table(
        "finance_cis_project_splits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("snapshot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        _money("gross_amount"),
        sa.Column("review_note", sa.Text(), nullable=True),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["company_id", "snapshot_id"],
            ["finance_cis_payroll_snapshots.company_id", "finance_cis_payroll_snapshots.id"],
            name="fk_fin_cis_split_snapshot",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "project_id"],
            ["finance_projects.company_id", "finance_projects.id"],
            name="fk_fin_cis_split_project",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("snapshot_id", "project_id", name="uq_fin_cis_split_project"),
        sa.CheckConstraint("gross_amount > 0", name="ck_fin_cis_split_positive"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_cis_split_status"),
    )
    op.create_table(
        "finance_funding_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("entry_kind", sa.String(40), nullable=False),
        sa.Column("counterparty_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("entry_date", sa.Date(), nullable=False),
        _money("amount"),
        sa.Column("external_reference", sa.String(120), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("review_required", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="RESTRICT"),
        sa.CheckConstraint("amount > 0", name="ck_fin_funding_positive"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_funding_status"),
        sa.CheckConstraint(
            "entry_kind IN ("
            "'director_introduction', 'director_withdrawal', 'loan_draw', 'loan_repayment', "
            "'loan_interest', 'worker_advance', 'worker_advance_repayment', "
            "'director_paid_supplier', 'reimbursement'"
            ")",
            name="ck_fin_funding_kind",
        ),
    )
    op.create_table(
        "finance_opening_balances",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("balance_kind", sa.String(32), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        _money("amount"),
        sa.Column("counterparty_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_reference", sa.String(120), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("review_status", sa.String(16), nullable=False, server_default="draft"),
        *_timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("company_id", "balance_kind", "source_reference", name="uq_fin_opening_ref"),
        sa.CheckConstraint(
            "balance_kind IN ("
            "'supplier_payable', 'customer_receivable', 'retention', 'cash_control', "
            "'payroll_liability', 'loan', 'other'"
            ")",
            name="ck_fin_opening_kind",
        ),
        sa.CheckConstraint("review_status IN ('draft', 'reviewed')", name="ck_fin_opening_review"),
    )
    op.create_table(
        "finance_hmrc_payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payment_kind", sa.String(16), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=False),
        _money("amount"),
        sa.Column("external_reference", sa.String(120), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        *_posted_columns(),
        *_timestamps(),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="RESTRICT"),
        sa.CheckConstraint("amount > 0", name="ck_fin_hmrc_positive"),
        sa.CheckConstraint("payment_kind IN ('cis', 'paye', 'vat', 'other')", name="ck_fin_hmrc_kind"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_hmrc_status"),
    )


_FUNCTION_SQL = r"""
CREATE FUNCTION finance_extension_posted_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'posted' THEN
            RAISE EXCEPTION 'posted finance record cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
        RAISE EXCEPTION 'finance records must be inserted as drafts';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted finance record is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION finance_cis_tail_payable(source_item uuid)
RETURNS numeric(18, 4)
LANGUAGE plpgsql
AS $$
DECLARE
    payable numeric(18, 4);
BEGIN
    SELECT snapshot.effective_payable_amount
    INTO payable
    FROM finance_cis_payroll_snapshots snapshot
    WHERE snapshot.source_payroll_item_id = source_item
      AND snapshot.status = 'posted'
      AND NOT EXISTS (
          SELECT 1
          FROM finance_cis_payroll_snapshots child
          WHERE child.supersedes_snapshot_id = snapshot.id
            AND child.status = 'posted'
      );
    RETURN COALESCE(payable, 0);
END;
$$;

CREATE FUNCTION finance_cis_allocated(source_item uuid)
RETURNS numeric(18, 4)
LANGUAGE plpgsql
AS $$
DECLARE
    allocated numeric(18, 4);
BEGIN
    SELECT COALESCE(SUM(allocation.amount), 0)
    INTO allocated
    FROM finance_worker_payment_allocations allocation
    JOIN finance_cis_payroll_snapshots snapshot
      ON snapshot.id = allocation.cis_snapshot_id
     AND snapshot.company_id = allocation.company_id
    JOIN finance_worker_payments payment
      ON payment.id = allocation.payment_id
     AND payment.company_id = allocation.company_id
    WHERE snapshot.source_payroll_item_id = source_item
      AND allocation.status = 'posted'
      AND payment.status = 'posted'
      AND NOT EXISTS (
          SELECT 1 FROM finance_worker_payment_allocation_reversals reversal_row
          WHERE reversal_row.allocation_id = allocation.id
            AND reversal_row.status = 'posted'
      )
      AND NOT EXISTS (
          SELECT 1 FROM finance_worker_payment_reversals payment_reversal
          WHERE payment_reversal.payment_id = payment.id
            AND payment_reversal.status = 'posted'
      );
    RETURN allocated;
END;
$$;

CREATE FUNCTION finance_paye_tail_net(source_item uuid)
RETURNS numeric(18, 4)
LANGUAGE plpgsql
AS $$
DECLARE
    payable numeric(18, 4);
BEGIN
    SELECT snapshot.net_pay
    INTO payable
    FROM finance_paye_payroll_snapshots snapshot
    WHERE snapshot.source_paye_item_id = source_item
      AND snapshot.status = 'posted'
      AND NOT EXISTS (
          SELECT 1 FROM finance_paye_payroll_snapshots child
          WHERE child.supersedes_snapshot_id = snapshot.id
            AND child.status = 'posted'
      );
    RETURN COALESCE(payable, 0);
END;
$$;

CREATE FUNCTION finance_paye_allocated(source_item uuid)
RETURNS numeric(18, 4)
LANGUAGE plpgsql
AS $$
DECLARE
    allocated numeric(18, 4);
BEGIN
    SELECT COALESCE(SUM(allocation.amount), 0)
    INTO allocated
    FROM finance_worker_payment_allocations allocation
    JOIN finance_paye_payroll_snapshots snapshot
      ON snapshot.id = allocation.paye_snapshot_id
     AND snapshot.company_id = allocation.company_id
    JOIN finance_worker_payments payment
      ON payment.id = allocation.payment_id
     AND payment.company_id = allocation.company_id
    WHERE snapshot.source_paye_item_id = source_item
      AND allocation.status = 'posted'
      AND payment.status = 'posted'
      AND NOT EXISTS (
          SELECT 1 FROM finance_worker_payment_allocation_reversals reversal_row
          WHERE reversal_row.allocation_id = allocation.id AND reversal_row.status = 'posted'
      )
      AND NOT EXISTS (
          SELECT 1 FROM finance_worker_payment_reversals payment_reversal
          WHERE payment_reversal.payment_id = payment.id AND payment_reversal.status = 'posted'
      );
    RETURN allocated;
END;
$$;

CREATE FUNCTION finance_worker_payment_available(source_payment uuid)
RETURNS numeric(18, 4)
LANGUAGE plpgsql
AS $$
DECLARE
    payment finance_worker_payments%ROWTYPE;
    allocated numeric(18, 4);
BEGIN
    SELECT * INTO payment FROM finance_worker_payments WHERE id = source_payment;
    IF NOT FOUND OR payment.status IS DISTINCT FROM 'posted' THEN
        RETURN 0;
    END IF;
    IF EXISTS (
        SELECT 1 FROM finance_worker_payment_reversals payment_reversal
        WHERE payment_reversal.payment_id = payment.id AND payment_reversal.status = 'posted'
    ) THEN
        RETURN 0;
    END IF;
    SELECT COALESCE(SUM(allocation.amount), 0)
    INTO allocated
    FROM finance_worker_payment_allocations allocation
    WHERE allocation.payment_id = payment.id
      AND allocation.status = 'posted'
      AND NOT EXISTS (
          SELECT 1 FROM finance_worker_payment_allocation_reversals reversal_row
          WHERE reversal_row.allocation_id = allocation.id AND reversal_row.status = 'posted'
      );
    RETURN payment.amount - allocated;
END;
$$;

CREATE FUNCTION finance_worker_allocation_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    payment finance_worker_payments%ROWTYPE;
    cis finance_cis_payroll_snapshots%ROWTYPE;
    paye finance_paye_payroll_snapshots%ROWTYPE;
    source_item uuid;
    still_owed numeric(18, 4);
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'posted' THEN
            RAISE EXCEPTION 'posted finance record cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
        RAISE EXCEPTION 'finance records must be inserted as drafts';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted finance record is immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
        SELECT * INTO payment FROM finance_worker_payments WHERE id = NEW.payment_id FOR UPDATE;
        IF NOT FOUND OR payment.company_id IS DISTINCT FROM NEW.company_id OR payment.status IS DISTINCT FROM 'posted' THEN
            RAISE EXCEPTION 'worker payment allocation requires a posted payment in the same company';
        END IF;
        IF EXISTS (
            SELECT 1 FROM finance_worker_payment_reversals payment_reversal
            WHERE payment_reversal.payment_id = payment.id AND payment_reversal.status = 'posted'
        ) THEN
            RAISE EXCEPTION 'cannot allocate a reversed worker payment';
        END IF;
        IF NEW.cis_snapshot_id IS NOT NULL THEN
            SELECT * INTO cis FROM finance_cis_payroll_snapshots WHERE id = NEW.cis_snapshot_id FOR UPDATE;
            IF NOT FOUND OR cis.company_id IS DISTINCT FROM NEW.company_id OR cis.status IS DISTINCT FROM 'posted' THEN
                RAISE EXCEPTION 'worker payment allocation must use a posted CIS snapshot in the same company';
            END IF;
            IF cis.source_user_id IS DISTINCT FROM payment.source_user_id THEN
                RAISE EXCEPTION 'worker payment allocation must use the same worker';
            END IF;
            source_item := cis.source_payroll_item_id;
            PERFORM 1 FROM finance_cis_payroll_snapshots
            WHERE source_payroll_item_id = source_item ORDER BY id FOR UPDATE;
            still_owed := finance_cis_tail_payable(source_item) - finance_cis_allocated(source_item);
        ELSE
            SELECT * INTO paye FROM finance_paye_payroll_snapshots WHERE id = NEW.paye_snapshot_id FOR UPDATE;
            IF NOT FOUND OR paye.company_id IS DISTINCT FROM NEW.company_id OR paye.status IS DISTINCT FROM 'posted' THEN
                RAISE EXCEPTION 'worker payment allocation must use a posted PAYE snapshot in the same company';
            END IF;
            IF paye.source_user_id IS DISTINCT FROM payment.source_user_id THEN
                RAISE EXCEPTION 'worker payment allocation must use the same worker';
            END IF;
            source_item := paye.source_paye_item_id;
            PERFORM 1 FROM finance_paye_payroll_snapshots
            WHERE source_paye_item_id = source_item ORDER BY id FOR UPDATE;
            still_owed := finance_paye_tail_net(source_item) - finance_paye_allocated(source_item);
        END IF;
        PERFORM 1 FROM finance_worker_payment_allocations
        WHERE payment_id = NEW.payment_id AND id <> NEW.id ORDER BY id FOR UPDATE;
        IF NEW.amount > finance_worker_payment_available(payment.id) THEN
            RAISE EXCEPTION 'worker payment allocation exceeds the unallocated payment amount';
        END IF;
        IF NEW.amount > still_owed THEN
            RAISE EXCEPTION 'worker payment allocation exceeds the outstanding obligation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION finance_customer_invoice_outstanding(invoice uuid)
RETURNS numeric(18, 4)
LANGUAGE plpgsql
AS $$
DECLARE
    base numeric(18, 4);
    credits numeric(18, 4);
    received numeric(18, 4);
BEGIN
    SELECT gross_amount INTO base
    FROM finance_customer_invoices
    WHERE id = invoice AND status = 'posted' AND document_kind = 'invoice';
    IF base IS NULL THEN
        RETURN 0;
    END IF;
    IF EXISTS (
        SELECT 1 FROM finance_customer_invoices reversal_row
        WHERE reversal_row.reverses_invoice_id = invoice
          AND reversal_row.document_kind = 'reversal'
          AND reversal_row.status = 'posted'
    ) THEN
        RETURN 0;
    END IF;
    SELECT COALESCE(SUM(credit.gross_amount), 0) INTO credits
    FROM finance_customer_invoices credit
    WHERE credit.credits_invoice_id = invoice
      AND credit.document_kind = 'credit'
      AND credit.status = 'posted';
    SELECT COALESCE(SUM(allocation.amount), 0) INTO received
    FROM finance_customer_receipt_allocations allocation
    JOIN finance_customer_receipts receipt
      ON receipt.id = allocation.receipt_id AND receipt.company_id = allocation.company_id
    WHERE allocation.invoice_id = invoice
      AND allocation.status = 'posted'
      AND receipt.status = 'posted'
      AND NOT EXISTS (
          SELECT 1 FROM finance_customer_receipt_allocation_reversals reversal_row
          WHERE reversal_row.allocation_id = allocation.id AND reversal_row.status = 'posted'
      )
      AND NOT EXISTS (
          SELECT 1 FROM finance_customer_receipt_reversals receipt_reversal
          WHERE receipt_reversal.receipt_id = receipt.id AND receipt_reversal.status = 'posted'
      );
    RETURN base + credits - received;
END;
$$;

CREATE FUNCTION finance_customer_receipt_available(source_receipt uuid)
RETURNS numeric(18, 4)
LANGUAGE plpgsql
AS $$
DECLARE
    receipt finance_customer_receipts%ROWTYPE;
    allocated numeric(18, 4);
BEGIN
    SELECT * INTO receipt FROM finance_customer_receipts WHERE id = source_receipt;
    IF NOT FOUND OR receipt.status IS DISTINCT FROM 'posted' THEN
        RETURN 0;
    END IF;
    IF EXISTS (
        SELECT 1 FROM finance_customer_receipt_reversals receipt_reversal
        WHERE receipt_reversal.receipt_id = receipt.id AND receipt_reversal.status = 'posted'
    ) THEN
        RETURN 0;
    END IF;
    SELECT COALESCE(SUM(allocation.amount), 0) INTO allocated
    FROM finance_customer_receipt_allocations allocation
    WHERE allocation.receipt_id = receipt.id
      AND allocation.status = 'posted'
      AND NOT EXISTS (
          SELECT 1 FROM finance_customer_receipt_allocation_reversals reversal_row
          WHERE reversal_row.allocation_id = allocation.id AND reversal_row.status = 'posted'
      );
    RETURN receipt.amount - allocated;
END;
$$;

CREATE FUNCTION finance_customer_allocation_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    receipt finance_customer_receipts%ROWTYPE;
    invoice finance_customer_invoices%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'posted' THEN
            RAISE EXCEPTION 'posted finance record cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
        RAISE EXCEPTION 'finance records must be inserted as drafts';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted finance record is immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
        SELECT * INTO receipt FROM finance_customer_receipts WHERE id = NEW.receipt_id FOR UPDATE;
        IF NOT FOUND OR receipt.company_id IS DISTINCT FROM NEW.company_id THEN
            RAISE EXCEPTION 'customer receipt allocation must stay in its company';
        END IF;
        SELECT * INTO invoice FROM finance_customer_invoices WHERE id = NEW.invoice_id FOR UPDATE;
        IF NOT FOUND OR invoice.company_id IS DISTINCT FROM NEW.company_id THEN
            RAISE EXCEPTION 'customer receipt allocation must stay in its company';
        END IF;
        IF receipt.status IS DISTINCT FROM 'posted' OR invoice.status IS DISTINCT FROM 'posted' OR invoice.document_kind IS DISTINCT FROM 'invoice' THEN
            RAISE EXCEPTION 'customer receipts allocate only to posted customer invoices';
        END IF;
        IF receipt.counterparty_id IS DISTINCT FROM invoice.counterparty_id THEN
            RAISE EXCEPTION 'customer receipt allocation must use the same customer';
        END IF;
        IF NEW.amount > finance_customer_receipt_available(receipt.id) THEN
            RAISE EXCEPTION 'customer receipt allocation exceeds the unallocated receipt amount';
        END IF;
        IF NEW.amount > finance_customer_invoice_outstanding(invoice.id) THEN
            RAISE EXCEPTION 'customer receipt allocation exceeds the outstanding invoice';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION finance_retention_release_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    certificate finance_payment_certificates%ROWTYPE;
    released numeric(18, 4);
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
        SELECT * INTO certificate FROM finance_payment_certificates WHERE id = NEW.certificate_id FOR UPDATE;
        IF NOT FOUND OR certificate.company_id IS DISTINCT FROM NEW.company_id OR certificate.status IS DISTINCT FROM 'posted' THEN
            RAISE EXCEPTION 'retention release requires a posted certificate in the same company';
        END IF;
        SELECT COALESCE(SUM(release_row.amount), 0) INTO released
        FROM finance_retention_releases release_row
        WHERE release_row.certificate_id = certificate.id
          AND release_row.status = 'posted'
          AND release_row.id <> NEW.id;
        IF released + NEW.amount > certificate.retention_withheld THEN
            RAISE EXCEPTION 'retention release exceeds retention withheld';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted finance record cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
        RAISE EXCEPTION 'finance records must be inserted as drafts';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted finance record is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION finance_commitment_draw_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    commitment finance_commitments%ROWTYPE;
    drawn numeric(18, 4);
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
        SELECT * INTO commitment FROM finance_commitments WHERE id = NEW.commitment_id FOR UPDATE;
        IF NOT FOUND OR commitment.company_id IS DISTINCT FROM NEW.company_id OR commitment.status IS DISTINCT FROM 'posted' THEN
            RAISE EXCEPTION 'commitment draw requires a posted commitment in the same company';
        END IF;
        SELECT COALESCE(SUM(draw_row.amount), 0) INTO drawn
        FROM finance_commitment_draws draw_row
        WHERE draw_row.commitment_id = commitment.id
          AND draw_row.status = 'posted'
          AND draw_row.id <> NEW.id;
        IF drawn + NEW.amount > commitment.committed_amount THEN
            RAISE EXCEPTION 'commitment draw exceeds the remaining commitment';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted finance record cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
        RAISE EXCEPTION 'finance records must be inserted as drafts';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted finance record is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION finance_cis_split_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    snapshot finance_cis_payroll_snapshots%ROWTYPE;
    split_total numeric(18, 4);
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
        SELECT * INTO snapshot FROM finance_cis_payroll_snapshots WHERE id = NEW.snapshot_id FOR UPDATE;
        IF NOT FOUND OR snapshot.company_id IS DISTINCT FROM NEW.company_id OR snapshot.status IS DISTINCT FROM 'posted' THEN
            RAISE EXCEPTION 'CIS project split requires a posted snapshot in the same company';
        END IF;
        SELECT COALESCE(SUM(split_row.gross_amount), 0) INTO split_total
        FROM finance_cis_project_splits split_row
        WHERE split_row.snapshot_id = snapshot.id
          AND split_row.status = 'posted'
          AND split_row.id <> NEW.id;
        IF split_total + NEW.gross_amount > snapshot.gross_amount THEN
            RAISE EXCEPTION 'CIS project split exceeds snapshot gross';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted finance record cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
        RAISE EXCEPTION 'finance records must be inserted as drafts';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted finance record is immutable';
    END IF;
    RETURN NEW;
END;
$$;
"""

_TRIGGER_SQL = r"""
CREATE FUNCTION finance_cis_successor_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent finance_cis_payroll_snapshots%ROWTYPE;
BEGIN
    IF NEW.supersedes_snapshot_id IS NULL THEN
        IF NEW.revision_number <> 1 THEN
            RAISE EXCEPTION 'CIS snapshot root revision must be 1';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO parent FROM finance_cis_payroll_snapshots WHERE id = NEW.supersedes_snapshot_id;
    IF NOT FOUND
        OR parent.company_id IS DISTINCT FROM NEW.company_id
        OR parent.source_user_id IS DISTINCT FROM NEW.source_user_id
        OR parent.source_payroll_item_id IS DISTINCT FROM NEW.source_payroll_item_id
        OR parent.revision_number + 1 IS DISTINCT FROM NEW.revision_number
    THEN
        RAISE EXCEPTION 'CIS snapshot correction must continue the same worker obligation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fin_cis_snap_chain
    BEFORE INSERT OR UPDATE ON finance_cis_payroll_snapshots
    FOR EACH ROW EXECUTE FUNCTION finance_cis_successor_guard();
CREATE TRIGGER trg_fin_cis_snap_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_cis_payroll_snapshots
    FOR EACH ROW EXECUTE FUNCTION finance_extension_posted_guard();
CREATE TRIGGER trg_fin_paye_snap_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_paye_payroll_snapshots
    FOR EACH ROW EXECUTE FUNCTION finance_extension_posted_guard();
CREATE TRIGGER trg_fin_worker_pay_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_worker_payments
    FOR EACH ROW EXECUTE FUNCTION finance_extension_posted_guard();
CREATE TRIGGER trg_fin_worker_alloc_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_worker_payment_allocations
    FOR EACH ROW EXECUTE FUNCTION finance_worker_allocation_before_write();
CREATE TRIGGER trg_fin_worker_pay_rev_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_worker_payment_reversals
    FOR EACH ROW EXECUTE FUNCTION finance_extension_posted_guard();
CREATE TRIGGER trg_fin_worker_alloc_rev_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_worker_payment_allocation_reversals
    FOR EACH ROW EXECUTE FUNCTION finance_extension_posted_guard();
CREATE TRIGGER trg_fin_cust_inv_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_customer_invoices
    FOR EACH ROW EXECUTE FUNCTION finance_extension_posted_guard();
CREATE TRIGGER trg_fin_cust_rcpt_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_customer_receipts
    FOR EACH ROW EXECUTE FUNCTION finance_extension_posted_guard();
CREATE TRIGGER trg_fin_cust_alloc_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_customer_receipt_allocations
    FOR EACH ROW EXECUTE FUNCTION finance_customer_allocation_before_write();
CREATE TRIGGER trg_fin_cust_rcpt_rev_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_customer_receipt_reversals
    FOR EACH ROW EXECUTE FUNCTION finance_extension_posted_guard();
CREATE TRIGGER trg_fin_cust_alloc_rev_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_customer_receipt_allocation_reversals
    FOR EACH ROW EXECUTE FUNCTION finance_extension_posted_guard();
CREATE TRIGGER trg_fin_application_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_payment_applications
    FOR EACH ROW EXECUTE FUNCTION finance_extension_posted_guard();
CREATE TRIGGER trg_fin_certificate_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_payment_certificates
    FOR EACH ROW EXECUTE FUNCTION finance_extension_posted_guard();
CREATE TRIGGER trg_fin_retention_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_retention_releases
    FOR EACH ROW EXECUTE FUNCTION finance_retention_release_before_write();
CREATE TRIGGER trg_fin_commitment_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_commitments
    FOR EACH ROW EXECUTE FUNCTION finance_extension_posted_guard();
CREATE TRIGGER trg_fin_draw_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_commitment_draws
    FOR EACH ROW EXECUTE FUNCTION finance_commitment_draw_before_write();
CREATE TRIGGER trg_fin_cis_split_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_cis_project_splits
    FOR EACH ROW EXECUTE FUNCTION finance_cis_split_before_write();
CREATE TRIGGER trg_fin_funding_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_funding_entries
    FOR EACH ROW EXECUTE FUNCTION finance_extension_posted_guard();
CREATE TRIGGER trg_fin_hmrc_posted
    BEFORE INSERT OR UPDATE OR DELETE ON finance_hmrc_payments
    FOR EACH ROW EXECUTE FUNCTION finance_extension_posted_guard();
"""


def downgrade() -> None:
    raise RuntimeError("Downgrade of Finance extensions is not authorised.")
