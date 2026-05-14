"""LEAVE-1: leave policies, requests, balance adjustments

Revision ID: d8e9f0a1b2c3
Revises: c4d5e6f7a8b0
Create Date: 2026-05-15

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d8e9f0a1b2c3"
down_revision: Union[str, Sequence[str], None] = "c4d5e6f7a8b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "leave_policies",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("annual_leave_year_start_month", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("annual_leave_year_start_day", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("default_annual_allowance_days", sa.Numeric(8, 2), nullable=True),
        sa.Column("allow_half_days", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("paid_annual_leave", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("paid_sick_leave", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("sick_leave_requires_note", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", name="uq_leave_policies_company_id"),
    )
    op.create_index(op.f("ix_leave_policies_company_id"), "leave_policies", ["company_id"], unique=True)

    op.create_table(
        "leave_requests",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("leave_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("date_from", sa.Date(), nullable=False),
        sa.Column("date_to", sa.Date(), nullable=False),
        sa.Column("start_half_day", sa.String(length=16), nullable=True),
        sa.Column("end_half_day", sa.String(length=16), nullable=True),
        sa.Column("total_days", sa.Numeric(10, 2), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("employee_note", sa.Text(), nullable=True),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column("approved_by_user_id", sa.UUID(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_by_user_id", sa.UUID(), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["rejected_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_leave_requests_company_id"), "leave_requests", ["company_id"], unique=False)
    op.create_index(op.f("ix_leave_requests_user_id"), "leave_requests", ["user_id"], unique=False)
    op.create_index(op.f("ix_leave_requests_leave_type"), "leave_requests", ["leave_type"], unique=False)
    op.create_index(op.f("ix_leave_requests_status"), "leave_requests", ["status"], unique=False)
    op.create_index(op.f("ix_leave_requests_date_from"), "leave_requests", ["date_from"], unique=False)
    op.create_index(op.f("ix_leave_requests_date_to"), "leave_requests", ["date_to"], unique=False)

    op.create_table(
        "leave_balance_adjustments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("leave_year", sa.String(length=16), nullable=False),
        sa.Column("adjustment_days", sa.Numeric(10, 2), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_leave_balance_adjustments_company_id"),
        "leave_balance_adjustments",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_leave_balance_adjustments_user_id"),
        "leave_balance_adjustments",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_leave_balance_adjustments_leave_year"),
        "leave_balance_adjustments",
        ["leave_year"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_leave_balance_adjustments_leave_year"), table_name="leave_balance_adjustments")
    op.drop_index(op.f("ix_leave_balance_adjustments_user_id"), table_name="leave_balance_adjustments")
    op.drop_index(op.f("ix_leave_balance_adjustments_company_id"), table_name="leave_balance_adjustments")
    op.drop_table("leave_balance_adjustments")

    op.drop_index(op.f("ix_leave_requests_date_to"), table_name="leave_requests")
    op.drop_index(op.f("ix_leave_requests_date_from"), table_name="leave_requests")
    op.drop_index(op.f("ix_leave_requests_status"), table_name="leave_requests")
    op.drop_index(op.f("ix_leave_requests_leave_type"), table_name="leave_requests")
    op.drop_index(op.f("ix_leave_requests_user_id"), table_name="leave_requests")
    op.drop_index(op.f("ix_leave_requests_company_id"), table_name="leave_requests")
    op.drop_table("leave_requests")

    op.drop_index(op.f("ix_leave_policies_company_id"), table_name="leave_policies")
    op.drop_table("leave_policies")
