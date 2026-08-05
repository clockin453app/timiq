"""Budget customer billing phase 1: contract value + customer invoices.

Revision ID: c5d6e7f8a9b0
Revises: b3c4d5e6f7a8
Create Date: 2026-08-05

Adds nullable contract_value_net / billing_currency to budget_projects without
backfilling. Creates budget_customer_invoices and budget_invoice_documents.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, Sequence[str], None] = "b3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "budget_projects",
        sa.Column("contract_value_net", sa.Numeric(precision=14, scale=2), nullable=True),
    )
    op.add_column(
        "budget_projects",
        sa.Column("billing_currency", sa.String(length=3), nullable=True),
    )

    op.create_table(
        "budget_customer_invoices",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("budget_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_action_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("customer_name", sa.String(length=200), nullable=False),
        sa.Column("invoice_number", sa.String(length=120), nullable=True),
        sa.Column("invoice_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="GBP"),
        sa.Column("net_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("vat_amount", sa.Numeric(precision=14, scale=2), nullable=False, server_default="0"),
        sa.Column("gross_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("reference", sa.String(length=200), nullable=True),
        sa.Column("payment_terms", sa.String(length=200), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("void_reason", sa.String(length=500), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("net_amount >= 0", name="ck_budget_customer_invoices_net_amount_nonneg"),
        sa.CheckConstraint("vat_amount >= 0", name="ck_budget_customer_invoices_vat_amount_nonneg"),
        sa.CheckConstraint("gross_amount >= 0", name="ck_budget_customer_invoices_gross_amount_nonneg"),
        sa.ForeignKeyConstraint(["budget_id"], ["budget_projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_budget_customer_invoices_company_id",
        "budget_customer_invoices",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        "ix_budget_customer_invoices_budget_id",
        "budget_customer_invoices",
        ["budget_id"],
        unique=False,
    )
    op.create_index(
        "ix_budget_customer_invoices_company_budget",
        "budget_customer_invoices",
        ["company_id", "budget_id"],
        unique=False,
    )
    op.create_index(
        "ix_budget_customer_invoices_invoice_date",
        "budget_customer_invoices",
        ["invoice_date"],
        unique=False,
    )
    op.create_index(
        "ix_budget_customer_invoices_due_date",
        "budget_customer_invoices",
        ["due_date"],
        unique=False,
    )
    op.create_index(
        "ix_budget_customer_invoices_status",
        "budget_customer_invoices",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_budget_customer_invoices_customer_name",
        "budget_customer_invoices",
        ["customer_name"],
        unique=False,
    )
    op.create_index(
        "uq_budget_customer_invoices_company_invoice_number",
        "budget_customer_invoices",
        ["company_id", "invoice_number"],
        unique=True,
        postgresql_where=sa.text("invoice_number IS NOT NULL"),
    )
    op.create_index(
        "uq_budget_customer_invoices_company_client_action",
        "budget_customer_invoices",
        ["company_id", "client_action_id"],
        unique=True,
        postgresql_where=sa.text("client_action_id IS NOT NULL"),
    )

    op.create_table(
        "budget_invoice_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("budget_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("original_filename", sa.String(length=200), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("replaced_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["budget_id"], ["budget_projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["invoice_id"], ["budget_customer_invoices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("invoice_id", "version", name="uq_budget_invoice_documents_invoice_version"),
    )
    op.create_index(
        "ix_budget_invoice_documents_company_id",
        "budget_invoice_documents",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        "ix_budget_invoice_documents_budget_id",
        "budget_invoice_documents",
        ["budget_id"],
        unique=False,
    )
    op.create_index(
        "ix_budget_invoice_documents_invoice_id",
        "budget_invoice_documents",
        ["invoice_id"],
        unique=False,
    )
    op.create_index(
        "uq_budget_invoice_documents_invoice_current",
        "budget_invoice_documents",
        ["invoice_id"],
        unique=True,
        postgresql_where=sa.text("is_current = true"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_budget_invoice_documents_invoice_current",
        table_name="budget_invoice_documents",
    )
    op.drop_index("ix_budget_invoice_documents_invoice_id", table_name="budget_invoice_documents")
    op.drop_index("ix_budget_invoice_documents_budget_id", table_name="budget_invoice_documents")
    op.drop_index("ix_budget_invoice_documents_company_id", table_name="budget_invoice_documents")
    op.drop_table("budget_invoice_documents")

    op.drop_index(
        "uq_budget_customer_invoices_company_client_action",
        table_name="budget_customer_invoices",
    )
    op.drop_index(
        "uq_budget_customer_invoices_company_invoice_number",
        table_name="budget_customer_invoices",
    )
    op.drop_index("ix_budget_customer_invoices_customer_name", table_name="budget_customer_invoices")
    op.drop_index("ix_budget_customer_invoices_status", table_name="budget_customer_invoices")
    op.drop_index("ix_budget_customer_invoices_due_date", table_name="budget_customer_invoices")
    op.drop_index("ix_budget_customer_invoices_invoice_date", table_name="budget_customer_invoices")
    op.drop_index("ix_budget_customer_invoices_company_budget", table_name="budget_customer_invoices")
    op.drop_index("ix_budget_customer_invoices_budget_id", table_name="budget_customer_invoices")
    op.drop_index("ix_budget_customer_invoices_company_id", table_name="budget_customer_invoices")
    op.drop_table("budget_customer_invoices")

    op.drop_column("budget_projects", "billing_currency")
    op.drop_column("budget_projects", "contract_value_net")
