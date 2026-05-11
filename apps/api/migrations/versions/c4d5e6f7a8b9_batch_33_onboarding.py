"""batch 33 onboarding submissions documents

Revision ID: c4d5e6f7a8b9
Revises: b9c2d3e4f5a6
Create Date: 2026-05-10 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "c4d5e6f7a8b9"
down_revision: Union[str, Sequence[str], None] = "b9c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "onboarding_submissions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column(
            "form_payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("signature_mode", sa.String(length=16), nullable=True),
        sa.Column("signature_typed_text", sa.Text(), nullable=True),
        sa.Column("signature_image_path", sa.String(length=500), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by_user_id", sa.UUID(), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_onboarding_submissions_user_id"),
    )
    op.create_index(
        op.f("ix_onboarding_submissions_company_id"),
        "onboarding_submissions",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_onboarding_submissions_status"),
        "onboarding_submissions",
        ["status"],
        unique=False,
    )

    op.create_table(
        "onboarding_documents",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("submission_id", sa.UUID(), nullable=False),
        sa.Column("doc_type", sa.String(length=64), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["submission_id"],
            ["onboarding_submissions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "submission_id",
            "doc_type",
            name="uq_onboarding_documents_submission_doc_type",
        ),
    )
    op.create_index(
        op.f("ix_onboarding_documents_submission_id"),
        "onboarding_documents",
        ["submission_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_onboarding_documents_submission_id"), table_name="onboarding_documents")
    op.drop_table("onboarding_documents")
    op.drop_index(op.f("ix_onboarding_submissions_status"), table_name="onboarding_submissions")
    op.drop_index(op.f("ix_onboarding_submissions_company_id"), table_name="onboarding_submissions")
    op.drop_table("onboarding_submissions")
