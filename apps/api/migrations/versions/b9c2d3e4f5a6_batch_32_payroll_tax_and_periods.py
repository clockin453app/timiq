"""batch 32 payroll periods items company tax workplace tax employee rates

Revision ID: b9c2d3e4f5a6
Revises: f8e31ab91c02
Create Date: 2026-05-10 22:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "b9c2d3e4f5a6"
down_revision: Union[str, Sequence[str], None] = "f8e31ab91c02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("default_tax_rate", sa.Numeric(precision=10, scale=4), nullable=True),
    )
    op.add_column(
        "workplaces",
        sa.Column("tax_rate", sa.Numeric(precision=10, scale=4), nullable=True),
    )
    op.add_column(
        "employee_profiles",
        sa.Column("hourly_rate", sa.Numeric(precision=12, scale=4), nullable=True),
    )
    op.add_column(
        "employee_profiles",
        sa.Column("tax_rate", sa.Numeric(precision=10, scale=4), nullable=True),
    )

    op.create_table(
        "payroll_periods",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("timezone_name", sa.String(length=64), nullable=False),
        sa.Column("calculated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("calculated_by_user_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["calculated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "week_start", name="uq_payroll_periods_company_week"),
    )
    op.create_index(op.f("ix_payroll_periods_company_id"), "payroll_periods", ["company_id"], unique=False)

    op.create_table(
        "payroll_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("period_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("regular_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("overtime_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rounded_total_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hourly_rate_snapshot", sa.Numeric(precision=12, scale=4), nullable=True),
        sa.Column("tax_rate_snapshot", sa.Numeric(precision=10, scale=4), nullable=True),
        sa.Column("overtime_multiplier_snapshot", sa.Numeric(precision=10, scale=4), nullable=True),
        sa.Column("gross_amount", sa.Numeric(precision=14, scale=4), nullable=True),
        sa.Column("tax_amount", sa.Numeric(precision=14, scale=4), nullable=True),
        sa.Column("net_amount", sa.Numeric(precision=14, scale=4), nullable=True),
        sa.Column("other_deductions_amount", sa.Numeric(precision=14, scale=4), nullable=False, server_default="0"),
        sa.Column("display_tax_amount", sa.Numeric(precision=14, scale=4), nullable=True),
        sa.Column("display_net_amount", sa.Numeric(precision=14, scale=4), nullable=True),
        sa.Column("payment_mode", sa.String(length=64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "policy_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by_user_id", sa.UUID(), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_by_user_id", sa.UUID(), nullable=True),
        sa.Column("rate_missing", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["paid_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["period_id"], ["payroll_periods.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("period_id", "user_id", name="uq_payroll_items_period_user"),
    )
    op.create_index(op.f("ix_payroll_items_company_id"), "payroll_items", ["company_id"], unique=False)
    op.create_index(op.f("ix_payroll_items_period_id"), "payroll_items", ["period_id"], unique=False)
    op.create_index(op.f("ix_payroll_items_user_id"), "payroll_items", ["user_id"], unique=False)
    op.create_index(op.f("ix_payroll_items_status"), "payroll_items", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_payroll_items_status"), table_name="payroll_items")
    op.drop_index(op.f("ix_payroll_items_user_id"), table_name="payroll_items")
    op.drop_index(op.f("ix_payroll_items_period_id"), table_name="payroll_items")
    op.drop_index(op.f("ix_payroll_items_company_id"), table_name="payroll_items")
    op.drop_table("payroll_items")

    op.drop_index(op.f("ix_payroll_periods_company_id"), table_name="payroll_periods")
    op.drop_table("payroll_periods")

    op.drop_column("employee_profiles", "tax_rate")
    op.drop_column("employee_profiles", "hourly_rate")
    op.drop_column("workplaces", "tax_rate")
    op.drop_column("companies", "default_tax_rate")
