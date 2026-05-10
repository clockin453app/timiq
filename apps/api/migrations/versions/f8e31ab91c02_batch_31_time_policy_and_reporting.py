"""batch 31 company time policy early access reporting foundation

Revision ID: f8e31ab91c02
Revises: e7c8a9b3f1d2
Create Date: 2026-05-10 20:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f8e31ab91c02"
down_revision: Union[str, Sequence[str], None] = "e7c8a9b3f1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "company_time_policies",
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("standard_start_time", sa.String(length=5), nullable=False, server_default="08:00"),
        sa.Column("overtime_after_hours", sa.Float(), nullable=False, server_default="8.5"),
        sa.Column("overtime_multiplier", sa.Float(), nullable=False, server_default="1.5"),
        sa.Column("rounding_increment_minutes", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("rounding_mode", sa.String(length=16), nullable=False, server_default="nearest"),
        sa.Column("break_deduction_minutes", sa.Integer(), nullable=False, server_default="30"),
        sa.Column(
            "rule_effective_from",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("rule_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("timezone_name", sa.String(length=64), nullable=False, server_default="Europe/London"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("company_id"),
    )

    op.add_column(
        "employee_profiles",
        sa.Column(
            "early_access_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("employee_profiles", "early_access_enabled")
    op.drop_table("company_time_policies")
