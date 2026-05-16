"""Toolbox talk attendee signature methods.

Revision ID: h1i2j3k4l5m6
Revises: g1h2i3j4k5l6
Create Date: 2026-05-16 09:21:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "h1i2j3k4l5m6"
down_revision: Union[str, Sequence[str], None] = "g1h2i3j4k5l6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "toolbox_talk_attendees",
        sa.Column("signature_method", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "toolbox_talk_attendees",
        sa.Column("manual_signature_note", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("toolbox_talk_attendees", "manual_signature_note")
    op.drop_column("toolbox_talk_attendees", "signature_method")
