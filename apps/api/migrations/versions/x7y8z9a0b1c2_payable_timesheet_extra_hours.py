"""Allow payable timesheet extra hours (drop non-payroll-only check).

Revision ID: x7y8z9a0b1c2
Revises: w6x7y8z9a0b1
Create Date: 2026-08-01 17:00:00.000000

Existing rows keep affects_payroll=false.
New rows default to affects_payroll=true (payable adjustments).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "x7y8z9a0b1c2"
down_revision: Union[str, Sequence[str], None] = "w6x7y8z9a0b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_timesheet_extra_hours_non_payroll",
        "timesheet_extra_hours",
        type_="check",
    )
    op.alter_column(
        "timesheet_extra_hours",
        "affects_payroll",
        existing_type=sa.Boolean(),
        server_default=sa.true(),
        existing_nullable=False,
    )
    op.create_index(
        "ix_timesheet_extra_hours_affects_payroll",
        "timesheet_extra_hours",
        ["affects_payroll"],
    )


def downgrade() -> None:
    op.drop_index("ix_timesheet_extra_hours_affects_payroll", table_name="timesheet_extra_hours")
    # Existing payable rows must be cleared before restoring the false-only check.
    op.execute(
        sa.text(
            "UPDATE timesheet_extra_hours SET affects_payroll = false "
            "WHERE affects_payroll IS DISTINCT FROM false"
        )
    )
    op.alter_column(
        "timesheet_extra_hours",
        "affects_payroll",
        existing_type=sa.Boolean(),
        server_default=sa.false(),
        existing_nullable=False,
    )
    op.create_check_constraint(
        "ck_timesheet_extra_hours_non_payroll",
        "timesheet_extra_hours",
        "affects_payroll = false",
    )
