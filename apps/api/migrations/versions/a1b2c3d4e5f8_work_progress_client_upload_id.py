"""work progress attachment client upload id for idempotent retries

Revision ID: a1b2c3d4e5f8
Revises: c2d3e4f5a6b7
Create Date: 2026-08-04 09:30:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "a1b2c3d4e5f8"
down_revision: Union[str, Sequence[str], None] = "c2d3e4f5a6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "work_progress_attachments",
        sa.Column("client_upload_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "uq_work_progress_attachments_entry_client_upload",
        "work_progress_attachments",
        ["entry_id", "client_upload_id"],
        unique=True,
        postgresql_where=sa.text("client_upload_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_work_progress_attachments_entry_client_upload",
        table_name="work_progress_attachments",
    )
    op.drop_column("work_progress_attachments", "client_upload_id")
