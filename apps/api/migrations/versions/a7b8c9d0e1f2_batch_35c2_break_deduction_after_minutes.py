"""batch 35c2 company time policy break deduction after threshold

Revision ID: a7b8c9d0e1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-05-12 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, Sequence[str], None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "company_time_policies",
        sa.Column("break_deduction_after_minutes", sa.Integer(), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE company_time_policies SET break_deduction_after_minutes = 360 "
            "WHERE break_deduction_after_minutes IS NULL",
        ),
    )


def downgrade() -> None:
    op.drop_column("company_time_policies", "break_deduction_after_minutes")
