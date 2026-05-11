"""batch 33 onboarding profile photo metadata

Revision ID: d1e2f3a4b5c6
Revises: c4d5e6f7a8b9
Create Date: 2026-05-11 18:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, Sequence[str], None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "onboarding_submissions",
        sa.Column("profile_photo_storage_path", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "onboarding_submissions",
        sa.Column("profile_photo_content_type", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "onboarding_submissions",
        sa.Column("profile_photo_file_size_bytes", sa.Integer(), nullable=True),
    )
    op.add_column(
        "onboarding_submissions",
        sa.Column("profile_photo_updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("onboarding_submissions", "profile_photo_updated_at")
    op.drop_column("onboarding_submissions", "profile_photo_file_size_bytes")
    op.drop_column("onboarding_submissions", "profile_photo_content_type")
    op.drop_column("onboarding_submissions", "profile_photo_storage_path")
