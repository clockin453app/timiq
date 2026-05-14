"""Safety ops: messaging group conversation fields

Revision ID: a1b2c3d4e5f7
Revises: f0e1d2c3b4a5
Create Date: 2026-05-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f7"
down_revision: Union[str, Sequence[str], None] = "f0e1d2c3b4a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("conversation_type", sa.String(length=16), nullable=False, server_default="direct"),
    )
    op.add_column(
        "conversations",
        sa.Column("title", sa.String(length=200), nullable=True),
    )
    op.create_index("ix_conversations_company_type", "conversations", ["company_id", "conversation_type"])


def downgrade() -> None:
    op.drop_index("ix_conversations_company_type", table_name="conversations")
    op.drop_column("conversations", "title")
    op.drop_column("conversations", "conversation_type")
