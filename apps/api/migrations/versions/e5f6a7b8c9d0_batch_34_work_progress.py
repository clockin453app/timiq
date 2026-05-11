"""batch 34 work progress entries and attachments

Revision ID: e5f6a7b8c9d0
Revises: d1e2f3a4b5c6
Create Date: 2026-05-10 14:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "work_progress_entries",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("workplace_id", sa.UUID(), nullable=True),
        sa.Column("location_id", sa.UUID(), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("progress_status", sa.String(length=32), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("percent_complete", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="submitted"),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by_user_id", sa.UUID(), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workplace_id"], ["workplaces.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_work_progress_entries_company_id",
        "work_progress_entries",
        ["company_id"],
    )
    op.create_index(
        "ix_work_progress_entries_user_id",
        "work_progress_entries",
        ["user_id"],
    )
    op.create_index(
        "ix_work_progress_entries_work_date",
        "work_progress_entries",
        ["work_date"],
    )
    op.create_index(
        "ix_work_progress_entries_status",
        "work_progress_entries",
        ["status"],
    )
    op.create_index(
        "ix_work_progress_entries_progress_status",
        "work_progress_entries",
        ["progress_status"],
    )
    op.create_index(
        "ix_work_progress_entries_location_id",
        "work_progress_entries",
        ["location_id"],
    )
    op.create_index(
        "ix_work_progress_entries_workplace_id",
        "work_progress_entries",
        ["workplace_id"],
    )

    op.create_table(
        "work_progress_attachments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("entry_id", sa.UUID(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["entry_id"], ["work_progress_entries.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_work_progress_attachments_entry_id",
        "work_progress_attachments",
        ["entry_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_work_progress_attachments_entry_id", table_name="work_progress_attachments")
    op.drop_table("work_progress_attachments")
    op.drop_index("ix_work_progress_entries_workplace_id", table_name="work_progress_entries")
    op.drop_index("ix_work_progress_entries_location_id", table_name="work_progress_entries")
    op.drop_index("ix_work_progress_entries_progress_status", table_name="work_progress_entries")
    op.drop_index("ix_work_progress_entries_status", table_name="work_progress_entries")
    op.drop_index("ix_work_progress_entries_work_date", table_name="work_progress_entries")
    op.drop_index("ix_work_progress_entries_user_id", table_name="work_progress_entries")
    op.drop_index("ix_work_progress_entries_company_id", table_name="work_progress_entries")
    op.drop_table("work_progress_entries")
