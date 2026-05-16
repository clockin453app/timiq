"""Push subscriptions for Web Push.

Revision ID: k4l5m6n7o8p9
Revises: j3k4l5m6n7o8
Create Date: 2026-05-16 13:59:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "k4l5m6n7o8p9"
down_revision: Union[str, Sequence[str], None] = "j3k4l5m6n7o8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.String(length=255), nullable=False),
        sa.Column("auth", sa.String(length=255), nullable=False),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column("device_label", sa.String(length=120), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "endpoint", name="uq_push_subscriptions_user_endpoint"),
    )
    op.create_index(op.f("ix_push_subscriptions_user_id"), "push_subscriptions", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_push_subscriptions_user_id"), table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
