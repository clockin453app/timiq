"""Add site progress classification columns (nullable for historical rows).

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
Create Date: 2026-08-09 11:20:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f8a9b0c1d2e3"
down_revision: Union[str, Sequence[str], None] = "e7f8a9b0c1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "work_progress_entries",
        sa.Column("work_category", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "work_progress_entries",
        sa.Column("elevation", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "work_progress_entries",
        sa.Column("elevation_custom", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "work_progress_entries",
        sa.Column("level", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("work_progress_entries", "level")
    op.drop_column("work_progress_entries", "elevation_custom")
    op.drop_column("work_progress_entries", "elevation")
    op.drop_column("work_progress_entries", "work_category")
