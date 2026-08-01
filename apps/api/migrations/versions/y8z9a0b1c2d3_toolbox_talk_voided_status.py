"""Add toolbox talk voided status fields.

Revision ID: y8z9a0b1c2d3
Revises: x7y8z9a0b1c2
Create Date: 2026-08-01 19:20:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "y8z9a0b1c2d3"
down_revision: Union[str, Sequence[str], None] = "x7y8z9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "toolbox_talks",
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "toolbox_talks",
        sa.Column(
            "voided_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "toolbox_talks",
        sa.Column("void_reason", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("toolbox_talks", "void_reason")
    op.drop_column("toolbox_talks", "voided_by_user_id")
    op.drop_column("toolbox_talks", "voided_at")
