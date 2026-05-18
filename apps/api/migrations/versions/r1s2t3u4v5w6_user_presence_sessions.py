"""Add user presence sessions.

Revision ID: r1s2t3u4v5w6
Revises: q0r1s2t3u4v5
Create Date: 2026-05-18 18:35:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "r1s2t3u4v5w6"
down_revision: Union[str, Sequence[str], None] = "q0r1s2t3u4v5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_presence_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("client_instance_id", sa.String(length=120), nullable=False),
        sa.Column("current_path", sa.String(length=300), nullable=True),
        sa.Column("user_agent_summary", sa.String(length=160), nullable=True),
        sa.Column("ip_address_masked", sa.String(length=64), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "client_instance_id", name="uq_user_presence_user_client"),
    )
    op.create_index("ix_user_presence_sessions_company_id", "user_presence_sessions", ["company_id"])
    op.create_index("ix_user_presence_sessions_last_heartbeat_at", "user_presence_sessions", ["last_heartbeat_at"])
    op.create_index("ix_user_presence_sessions_last_seen_at", "user_presence_sessions", ["last_seen_at"])
    op.create_index("ix_user_presence_sessions_user_id", "user_presence_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_presence_sessions_user_id", table_name="user_presence_sessions")
    op.drop_index("ix_user_presence_sessions_last_seen_at", table_name="user_presence_sessions")
    op.drop_index("ix_user_presence_sessions_last_heartbeat_at", table_name="user_presence_sessions")
    op.drop_index("ix_user_presence_sessions_company_id", table_name="user_presence_sessions")
    op.drop_table("user_presence_sessions")
