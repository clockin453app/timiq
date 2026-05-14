"""Toolbox talks and attendee sign-off

Revision ID: e9f0a1b2c3d4
Revises: c3d4e5f6a7b1
Create Date: 2026-05-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e9f0a1b2c3d4"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "toolbox_talks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("topic", sa.String(length=64), nullable=False),
        sa.Column("topic_category", sa.String(length=120), nullable=True),
        sa.Column("topic_custom", sa.String(length=200), nullable=True),
        sa.Column("talk_body", sa.Text(), nullable=False),
        sa.Column("presenter_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("scheduled_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["presenter_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_toolbox_talks_company_id", "toolbox_talks", ["company_id"])
    op.create_index("ix_toolbox_talks_location_id", "toolbox_talks", ["location_id"])
    op.create_index("ix_toolbox_talks_status", "toolbox_talks", ["status"])
    op.create_index("ix_toolbox_talks_topic", "toolbox_talks", ["topic"])

    op.create_table(
        "toolbox_talk_attendees",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("talk_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("signature_name", sa.String(length=200), nullable=True),
        sa.Column("signature_image_path", sa.String(length=512), nullable=True),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("declined_reason", sa.String(length=2000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["talk_id"], ["toolbox_talks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("talk_id", "user_id", name="uq_toolbox_talk_attendee_talk_user"),
    )
    op.create_index("ix_toolbox_talk_attendees_talk_id", "toolbox_talk_attendees", ["talk_id"])
    op.create_index("ix_toolbox_talk_attendees_user_id", "toolbox_talk_attendees", ["user_id"])
    op.create_index("ix_toolbox_talk_attendees_company_id", "toolbox_talk_attendees", ["company_id"])
    op.create_index("ix_toolbox_talk_attendees_status", "toolbox_talk_attendees", ["status"])


def downgrade() -> None:
    op.drop_index("ix_toolbox_talk_attendees_status", table_name="toolbox_talk_attendees")
    op.drop_index("ix_toolbox_talk_attendees_company_id", table_name="toolbox_talk_attendees")
    op.drop_index("ix_toolbox_talk_attendees_user_id", table_name="toolbox_talk_attendees")
    op.drop_index("ix_toolbox_talk_attendees_talk_id", table_name="toolbox_talk_attendees")
    op.drop_table("toolbox_talk_attendees")
    op.drop_index("ix_toolbox_talks_topic", table_name="toolbox_talks")
    op.drop_index("ix_toolbox_talks_status", table_name="toolbox_talks")
    op.drop_index("ix_toolbox_talks_location_id", table_name="toolbox_talks")
    op.drop_index("ix_toolbox_talks_company_id", table_name="toolbox_talks")
    op.drop_table("toolbox_talks")
