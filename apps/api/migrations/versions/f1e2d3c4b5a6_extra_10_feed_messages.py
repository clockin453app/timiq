"""EXTRA-10 company newsfeed and in-app messages

Revision ID: f1e2d3c4b5a6
Revises: e4f5a6b7c8d9
Create Date: 2026-05-12

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f1e2d3c4b5a6"
down_revision: Union[str, Sequence[str], None] = "e4f5a6b7c8d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "company_newsfeed_posts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_company_newsfeed_posts_company_id"),
        "company_newsfeed_posts",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_company_newsfeed_posts_created_by_user_id"),
        "company_newsfeed_posts",
        ["created_by_user_id"],
        unique=False,
    )

    op.create_table(
        "in_app_messages",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("sender_user_id", sa.UUID(), nullable=False),
        sa.Column("recipient_user_id", sa.UUID(), nullable=False),
        sa.Column("body", sa.String(length=4000), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recipient_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_in_app_messages_company_id"), "in_app_messages", ["company_id"], unique=False)
    op.create_index(op.f("ix_in_app_messages_sender_user_id"), "in_app_messages", ["sender_user_id"], unique=False)
    op.create_index(
        op.f("ix_in_app_messages_recipient_user_id"),
        "in_app_messages",
        ["recipient_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_in_app_messages_recipient_user_id"), table_name="in_app_messages")
    op.drop_index(op.f("ix_in_app_messages_sender_user_id"), table_name="in_app_messages")
    op.drop_index(op.f("ix_in_app_messages_company_id"), table_name="in_app_messages")
    op.drop_table("in_app_messages")
    op.drop_index(op.f("ix_company_newsfeed_posts_created_by_user_id"), table_name="company_newsfeed_posts")
    op.drop_index(op.f("ix_company_newsfeed_posts_company_id"), table_name="company_newsfeed_posts")
    op.drop_table("company_newsfeed_posts")
