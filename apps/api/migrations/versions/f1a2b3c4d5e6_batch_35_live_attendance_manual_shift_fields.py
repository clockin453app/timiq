"""batch 35 live attendance manual shift lineage

Revision ID: f1a2b3c4d5e6
Revises: e5f6a7b8c9d0
Create Date: 2026-05-10 20:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "time_shifts",
        sa.Column("clock_source", sa.String(length=32), nullable=False, server_default="employee"),
    )
    op.add_column(
        "time_shifts",
        sa.Column("manual_reason", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "time_shifts",
        sa.Column("admin_actor_user_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_time_shifts_admin_actor_user_id",
        "time_shifts",
        "users",
        ["admin_actor_user_id"],
        ["id"],
    )
    op.create_index(
        op.f("ix_time_shifts_clock_source"),
        "time_shifts",
        ["clock_source"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_time_shifts_clock_source"), table_name="time_shifts")
    op.drop_constraint("fk_time_shifts_admin_actor_user_id", "time_shifts", type_="foreignkey")
    op.drop_column("time_shifts", "admin_actor_user_id")
    op.drop_column("time_shifts", "manual_reason")
    op.drop_column("time_shifts", "clock_source")
