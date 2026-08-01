"""Add RAMS reading progress for uploaded PDF acknowledgement gating.

Revision ID: a0b1c2d3e4f5
Revises: z9a0b1c2d3e4
Create Date: 2026-08-01 21:20:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a0b1c2d3e4f5"
down_revision: Union[str, Sequence[str], None] = "z9a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rams_reading_progress",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assessment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("rams_assessments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("document_source_type", sa.String(length=32), nullable=False, server_default="uploaded_pdf"),
        sa.Column("document_version", sa.Integer(), nullable=False),
        sa.Column("document_sha256", sa.String(length=64), nullable=False),
        sa.Column("total_pages", sa.Integer(), nullable=True),
        sa.Column("viewed_pages", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("highest_page_reached", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint(
            "assessment_id",
            "user_id",
            "document_version",
            "document_sha256",
            name="uq_rams_reading_progress_doc",
        ),
    )
    op.create_index("ix_rams_reading_progress_company_id", "rams_reading_progress", ["company_id"])
    op.create_index("ix_rams_reading_progress_assessment_id", "rams_reading_progress", ["assessment_id"])
    op.create_index("ix_rams_reading_progress_user_id", "rams_reading_progress", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_rams_reading_progress_user_id", table_name="rams_reading_progress")
    op.drop_index("ix_rams_reading_progress_assessment_id", table_name="rams_reading_progress")
    op.drop_index("ix_rams_reading_progress_company_id", table_name="rams_reading_progress")
    op.drop_table("rams_reading_progress")
