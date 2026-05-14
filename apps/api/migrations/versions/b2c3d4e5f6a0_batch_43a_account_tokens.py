"""Batch 43A: account action tokens and user account timestamps

Revision ID: b2c3d4e5f6a0
Revises: a1b2c3d4e5f6
Create Date: 2026-05-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "b2c3d4e5f6a0"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("invited_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("invite_accepted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "account_action_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email_normalized", sa.String(length=320), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("request_ip_hash", sa.String(length=64), nullable=True),
        sa.Column("user_agent_hash", sa.String(length=64), nullable=True),
        sa.Column("invite_meta", postgresql.JSONB(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_account_action_tokens_token_hash"),
    )
    op.create_index(
        op.f("ix_account_action_tokens_user_id"),
        "account_action_tokens",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_account_action_tokens_purpose"),
        "account_action_tokens",
        ["purpose"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_account_action_tokens_purpose"), table_name="account_action_tokens")
    op.drop_index(op.f("ix_account_action_tokens_user_id"), table_name="account_action_tokens")
    op.drop_table("account_action_tokens")
    op.drop_column("users", "password_changed_at")
    op.drop_column("users", "invite_accepted_at")
    op.drop_column("users", "invited_at")
    op.drop_column("users", "email_verified_at")
