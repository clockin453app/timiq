"""RAMS acknowledgement signature methods.

Revision ID: i2j3k4l5m6n7
Revises: h1i2j3k4l5m6
Create Date: 2026-05-16 10:02:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "i2j3k4l5m6n7"
down_revision: Union[str, Sequence[str], None] = "h1i2j3k4l5m6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "rams_acknowledgements",
        sa.Column("signature_method", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "rams_acknowledgements",
        sa.Column("manual_signature_note", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rams_acknowledgements", "manual_signature_note")
    op.drop_column("rams_acknowledgements", "signature_method")
