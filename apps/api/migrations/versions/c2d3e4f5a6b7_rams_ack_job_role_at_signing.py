"""Add immutable job_role_at_signing on RAMS acknowledgements.

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-08-02 07:50:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, Sequence[str], None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "rams_acknowledgements",
        sa.Column("job_role_at_signing", sa.String(length=120), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rams_acknowledgements", "job_role_at_signing")
