"""Batch 40: location (site) payroll time policy overrides

Revision ID: f0a1b2c3d4e5
Revises: e7f8a9b0c1d3
Create Date: 2026-05-12

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f0a1b2c3d4e5"
down_revision: Union[str, Sequence[str], None] = "e7f8a9b0c1d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "location_payroll_policies",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("location_id", sa.UUID(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("standard_start_time", sa.String(length=5), nullable=True),
        sa.Column("allow_early_clock_in", sa.Boolean(), nullable=True),
        sa.Column("break_deduction_after_minutes", sa.Integer(), nullable=True),
        sa.Column("break_deduction_minutes", sa.Integer(), nullable=True),
        sa.Column("rounding_increment_minutes", sa.Integer(), nullable=True),
        sa.Column("rounding_mode", sa.String(length=16), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column("updated_by_user_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("location_id", name="uq_location_payroll_policies_location_id"),
    )
    op.create_index(
        op.f("ix_location_payroll_policies_company_id"),
        "location_payroll_policies",
        ["company_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_location_payroll_policies_company_id"), table_name="location_payroll_policies")
    op.drop_table("location_payroll_policies")
