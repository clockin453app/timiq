"""batch 34c work progress attachment image metadata and optimisation fields

Revision ID: c0d1e2f3a4b5
Revises: a7b8c9d0e1f2
Create Date: 2026-05-11 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c0d1e2f3a4b5"
down_revision: Union[str, Sequence[str], None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "work_progress_attachments",
        sa.Column("original_size_bytes", sa.Integer(), nullable=True),
    )
    op.add_column(
        "work_progress_attachments",
        sa.Column("stored_size_bytes", sa.Integer(), nullable=True),
    )
    op.add_column(
        "work_progress_attachments",
        sa.Column("stored_content_type", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "work_progress_attachments",
        sa.Column("image_width", sa.Integer(), nullable=True),
    )
    op.add_column(
        "work_progress_attachments",
        sa.Column("image_height", sa.Integer(), nullable=True),
    )
    op.add_column(
        "work_progress_attachments",
        sa.Column("processing_version", sa.String(length=32), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE work_progress_attachments SET "
            "original_size_bytes = file_size_bytes, "
            "stored_size_bytes = file_size_bytes, "
            "stored_content_type = content_type "
            "WHERE original_size_bytes IS NULL",
        ),
    )


def downgrade() -> None:
    op.drop_column("work_progress_attachments", "processing_version")
    op.drop_column("work_progress_attachments", "image_height")
    op.drop_column("work_progress_attachments", "image_width")
    op.drop_column("work_progress_attachments", "stored_content_type")
    op.drop_column("work_progress_attachments", "stored_size_bytes")
    op.drop_column("work_progress_attachments", "original_size_bytes")
