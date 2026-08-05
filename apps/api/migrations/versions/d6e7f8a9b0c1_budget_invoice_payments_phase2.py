"""Budget invoice payments phase 2.

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-08-05

Creates budget_invoice_payments for recording and reversing invoice payments.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "d6e7f8a9b0c1"
down_revision: Union[str, Sequence[str], None] = "c5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "budget_invoice_payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("budget_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_action_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("payment_method", sa.String(length=40), nullable=False),
        sa.Column("reference", sa.String(length=200), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reversed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reversed_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reversal_reason", sa.String(length=500), nullable=True),
        sa.CheckConstraint("amount > 0", name="ck_budget_invoice_payments_amount_positive"),
        sa.ForeignKeyConstraint(["budget_id"], ["budget_projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["invoice_id"], ["budget_customer_invoices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reversed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_budget_invoice_payments_invoice_id",
        "budget_invoice_payments",
        ["invoice_id"],
        unique=False,
    )
    op.create_index(
        "ix_budget_invoice_payments_company_budget",
        "budget_invoice_payments",
        ["company_id", "budget_id"],
        unique=False,
    )
    op.create_index(
        "ix_budget_invoice_payments_payment_date",
        "budget_invoice_payments",
        ["payment_date"],
        unique=False,
    )
    op.create_index(
        "ix_budget_invoice_payments_company_id",
        "budget_invoice_payments",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        "uq_budget_invoice_payments_company_client_action",
        "budget_invoice_payments",
        ["company_id", "client_action_id"],
        unique=True,
        postgresql_where=sa.text("client_action_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_budget_invoice_payments_company_client_action",
        table_name="budget_invoice_payments",
    )
    op.drop_index("ix_budget_invoice_payments_company_id", table_name="budget_invoice_payments")
    op.drop_index("ix_budget_invoice_payments_payment_date", table_name="budget_invoice_payments")
    op.drop_index("ix_budget_invoice_payments_company_budget", table_name="budget_invoice_payments")
    op.drop_index("ix_budget_invoice_payments_invoice_id", table_name="budget_invoice_payments")
    op.drop_table("budget_invoice_payments")
