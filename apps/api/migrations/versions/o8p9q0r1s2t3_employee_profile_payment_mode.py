"""Employee profile payroll payment mode.

Revision ID: o8p9q0r1s2t3
Revises: n7o8p9q0r1s2
Create Date: 2026-05-18 13:55:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "o8p9q0r1s2t3"
down_revision: Union[str, Sequence[str], None] = "n7o8p9q0r1s2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("employee_profiles", sa.Column("payment_mode", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("employee_profiles", "payment_mode")
