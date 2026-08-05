"""Add client_action_id for idempotent admin shift creates.

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f8
Create Date: 2026-08-05 19:45:00.000000

Preserves existing historical rows. Does not delete or merge duplicate shifts.
Day-level uniqueness for new writes is enforced in application code with
transaction advisory locks because existing production duplicates prevent a
strict unique day index without modifying historical rows.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "b3c4d5e6f7a8"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "time_shifts",
        sa.Column("client_action_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "uq_time_shifts_company_client_action",
        "time_shifts",
        ["company_id", "client_action_id"],
        unique=True,
        postgresql_where=sa.text("client_action_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_time_shifts_company_client_action",
        table_name="time_shifts",
    )
    op.drop_column("time_shifts", "client_action_id")
