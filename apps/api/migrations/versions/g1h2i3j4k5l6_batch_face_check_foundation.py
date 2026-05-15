"""Face check foundation: employee reference selfie + shift review status fields.

Revision ID: g1h2i3j4k5l6
Revises: f3a4b5c6d7e8
Create Date: 2026-05-15 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "g1h2i3j4k5l6"
down_revision: Union[str, Sequence[str], None] = "f3a4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "employee_profiles",
        sa.Column("face_check_consent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "employee_profiles",
        sa.Column("face_reference_storage_path", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "employee_profiles",
        sa.Column("face_reference_enrolled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "employee_profiles",
        sa.Column("face_reference_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "time_shifts",
        sa.Column("face_check_status", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "time_shifts",
        sa.Column("face_match_confidence", sa.Float(), nullable=True),
    )
    op.add_column(
        "time_shifts",
        sa.Column("face_check_reason", sa.String(length=120), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("time_shifts", "face_check_reason")
    op.drop_column("time_shifts", "face_match_confidence")
    op.drop_column("time_shifts", "face_check_status")
    op.drop_column("employee_profiles", "face_reference_updated_at")
    op.drop_column("employee_profiles", "face_reference_enrolled_at")
    op.drop_column("employee_profiles", "face_reference_storage_path")
    op.drop_column("employee_profiles", "face_check_consent_at")
