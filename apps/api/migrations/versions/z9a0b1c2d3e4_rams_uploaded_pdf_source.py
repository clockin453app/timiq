"""Add uploaded RAMS PDF source fields.

Revision ID: z9a0b1c2d3e4
Revises: y8z9a0b1c2d3
Create Date: 2026-08-01 19:50:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "z9a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "y8z9a0b1c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "rams_assessments",
        sa.Column("source_type", sa.String(length=32), nullable=False, server_default="template"),
    )
    op.add_column(
        "rams_assessments",
        sa.Column("uploaded_pdf_original_filename", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "rams_assessments",
        sa.Column("uploaded_pdf_storage_path", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "rams_assessments",
        sa.Column("uploaded_pdf_content_type", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "rams_assessments",
        sa.Column("uploaded_pdf_file_size_bytes", sa.Integer(), nullable=True),
    )
    op.add_column(
        "rams_assessments",
        sa.Column("uploaded_pdf_checksum_sha256", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "rams_assessments",
        sa.Column("uploaded_pdf_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "rams_assessments",
        sa.Column(
            "uploaded_pdf_uploaded_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "rams_assessments",
        sa.Column("uploaded_pdf_uploaded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_rams_assessments_source_type", "rams_assessments", ["source_type"])


def downgrade() -> None:
    op.drop_index("ix_rams_assessments_source_type", table_name="rams_assessments")
    op.drop_column("rams_assessments", "uploaded_pdf_uploaded_at")
    op.drop_column("rams_assessments", "uploaded_pdf_uploaded_by_user_id")
    op.drop_column("rams_assessments", "uploaded_pdf_version")
    op.drop_column("rams_assessments", "uploaded_pdf_checksum_sha256")
    op.drop_column("rams_assessments", "uploaded_pdf_file_size_bytes")
    op.drop_column("rams_assessments", "uploaded_pdf_content_type")
    op.drop_column("rams_assessments", "uploaded_pdf_storage_path")
    op.drop_column("rams_assessments", "uploaded_pdf_original_filename")
    op.drop_column("rams_assessments", "source_type")
