"""Track payroll payment mode source.

Revision ID: q0r1s2t3u4v5
Revises: p9q0r1s2t3u4
Create Date: 2026-05-18 18:05:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "q0r1s2t3u4v5"
down_revision: Union[str, Sequence[str], None] = "p9q0r1s2t3u4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("payroll_items", sa.Column("payment_mode_source", sa.String(length=32), nullable=True))
    op.execute(
        """
        UPDATE payroll_items
        SET payment_mode_source = CASE
            WHEN status IN ('approved', 'paid') THEN 'manual'
            WHEN status = 'pending' THEN 'profile'
            ELSE payment_mode_source
        END
        WHERE payment_mode_source IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("payroll_items", "payment_mode_source")
