"""Add Monthly PAYE pay components Phase 4A.

Revision ID: u4v5w6x7y8z9
Revises: t3u4v5w6x7y8
Create Date: 2026-05-18 22:05:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "u4v5w6x7y8z9"
down_revision: Union[str, Sequence[str], None] = "t3u4v5w6x7y8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("monthly_paye_items", sa.Column("bonus_pay", sa.Numeric(14, 4), nullable=False, server_default="0"))
    op.add_column("monthly_paye_items", sa.Column("commission_pay", sa.Numeric(14, 4), nullable=False, server_default="0"))
    op.add_column("monthly_paye_items", sa.Column("component_pay", sa.Numeric(14, 4), nullable=False, server_default="0"))
    op.add_column(
        "monthly_paye_items",
        sa.Column("component_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )

    op.create_table(
        "monthly_paye_pay_components",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tax_year", sa.String(length=9), nullable=False),
        sa.Column("tax_month", sa.Integer(), nullable=False),
        sa.Column("period_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("component_type", sa.String(length=32), nullable=False),
        sa.Column("description", sa.String(length=240), nullable=True),
        sa.Column("amount", sa.Numeric(14, 4), nullable=False),
        sa.Column("taxable", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("niable", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("pensionable", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("component_type IN ('bonus', 'commission')", name="ck_monthly_paye_pay_components_type"),
        sa.CheckConstraint("amount >= 0", name="ck_monthly_paye_pay_components_amount_nonnegative"),
        sa.CheckConstraint("tax_month >= 1 AND tax_month <= 12", name="ck_monthly_paye_pay_components_tax_month"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["item_id"], ["monthly_paye_items.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["period_id"], ["monthly_paye_periods.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_monthly_paye_pay_components_company_id", "monthly_paye_pay_components", ["company_id"])
    op.create_index("ix_monthly_paye_pay_components_item_id", "monthly_paye_pay_components", ["item_id"])
    op.create_index("ix_monthly_paye_pay_components_period_id", "monthly_paye_pay_components", ["period_id"])
    op.create_index("ix_monthly_paye_pay_components_tax_month", "monthly_paye_pay_components", ["tax_month"])
    op.create_index("ix_monthly_paye_pay_components_tax_year", "monthly_paye_pay_components", ["tax_year"])
    op.create_index("ix_monthly_paye_pay_components_user_id", "monthly_paye_pay_components", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_monthly_paye_pay_components_user_id", table_name="monthly_paye_pay_components")
    op.drop_index("ix_monthly_paye_pay_components_tax_year", table_name="monthly_paye_pay_components")
    op.drop_index("ix_monthly_paye_pay_components_tax_month", table_name="monthly_paye_pay_components")
    op.drop_index("ix_monthly_paye_pay_components_period_id", table_name="monthly_paye_pay_components")
    op.drop_index("ix_monthly_paye_pay_components_item_id", table_name="monthly_paye_pay_components")
    op.drop_index("ix_monthly_paye_pay_components_company_id", table_name="monthly_paye_pay_components")
    op.drop_table("monthly_paye_pay_components")
    op.drop_column("monthly_paye_items", "component_snapshot")
    op.drop_column("monthly_paye_items", "component_pay")
    op.drop_column("monthly_paye_items", "commission_pay")
    op.drop_column("monthly_paye_items", "bonus_pay")
