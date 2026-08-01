"""Add non-payroll timesheet_extra_hours table.

Revision ID: w6x7y8z9a0b1
Revises: v5w6x7y8z9a0
Create Date: 2026-08-01 16:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "w6x7y8z9a0b1"
down_revision: Union[str, Sequence[str], None] = "v5w6x7y8z9a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "timesheet_extra_hours",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=64), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("affects_payroll", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("duration_minutes > 0", name="ck_timesheet_extra_hours_duration_positive"),
        sa.CheckConstraint("affects_payroll = false", name="ck_timesheet_extra_hours_non_payroll"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_timesheet_extra_hours_company_id", "timesheet_extra_hours", ["company_id"])
    op.create_index("ix_timesheet_extra_hours_user_id", "timesheet_extra_hours", ["user_id"])
    op.create_index("ix_timesheet_extra_hours_work_date", "timesheet_extra_hours", ["work_date"])
    op.create_index("ix_timesheet_extra_hours_reason", "timesheet_extra_hours", ["reason"])
    op.create_index("ix_timesheet_extra_hours_location_id", "timesheet_extra_hours", ["location_id"])
    op.create_index("ix_timesheet_extra_hours_deleted_at", "timesheet_extra_hours", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_timesheet_extra_hours_deleted_at", table_name="timesheet_extra_hours")
    op.drop_index("ix_timesheet_extra_hours_location_id", table_name="timesheet_extra_hours")
    op.drop_index("ix_timesheet_extra_hours_reason", table_name="timesheet_extra_hours")
    op.drop_index("ix_timesheet_extra_hours_work_date", table_name="timesheet_extra_hours")
    op.drop_index("ix_timesheet_extra_hours_user_id", table_name="timesheet_extra_hours")
    op.drop_index("ix_timesheet_extra_hours_company_id", table_name="timesheet_extra_hours")
    op.drop_table("timesheet_extra_hours")
