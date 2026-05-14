"""EXTRA-18 company accounting / ERP link foundation

Revision ID: b4c5d6e7f8a0
Revises: a2b3c4d5e6f7
Create Date: 2026-05-12

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b4c5d6e7f8a0"
down_revision: Union[str, Sequence[str], None] = "a2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "company_accounting_settings",
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("provider_key", sa.String(length=64), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("updated_by_user_id", sa.UUID(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("company_id"),
    )


def downgrade() -> None:
    op.drop_table("company_accounting_settings")
