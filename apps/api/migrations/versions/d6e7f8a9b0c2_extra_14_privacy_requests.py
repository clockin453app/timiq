"""EXTRA-14 privacy data requests

Revision ID: d6e7f8a9b0c2
Revises: c5d6e7f8a9b1
Create Date: 2026-05-12

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d6e7f8a9b0c2"
down_revision: Union[str, Sequence[str], None] = "c5d6e7f8a9b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "privacy_requests",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=True),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("request_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("subject", sa.String(length=300), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("admin_response", sa.Text(), nullable=True),
        sa.Column("handled_by_user_id", sa.UUID(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["handled_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_privacy_requests_company_id"), "privacy_requests", ["company_id"], unique=False)
    op.create_index(op.f("ix_privacy_requests_user_id"), "privacy_requests", ["user_id"], unique=False)
    op.create_index(op.f("ix_privacy_requests_status"), "privacy_requests", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_privacy_requests_status"), table_name="privacy_requests")
    op.drop_index(op.f("ix_privacy_requests_user_id"), table_name="privacy_requests")
    op.drop_index(op.f("ix_privacy_requests_company_id"), table_name="privacy_requests")
    op.drop_table("privacy_requests")
