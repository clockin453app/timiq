"""notification_seen for dismissible informational bell items."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f3a4b5c6d7e8"
down_revision = "d8e9f0a1b2c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification_seen",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("target_key", sa.String(length=512), nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "kind", "target_key", name="uq_notification_seen_user_kind_target"),
    )
    op.create_index(op.f("ix_notification_seen_user_id"), "notification_seen", ["user_id"], unique=False)
    op.create_index(op.f("ix_notification_seen_kind"), "notification_seen", ["kind"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_notification_seen_kind"), table_name="notification_seen")
    op.drop_index(op.f("ix_notification_seen_user_id"), table_name="notification_seen")
    op.drop_table("notification_seen")
