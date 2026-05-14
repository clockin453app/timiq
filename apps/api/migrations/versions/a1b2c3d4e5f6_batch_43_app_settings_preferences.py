"""Batch 43: company app settings and user preferences

Revision ID: a1b2c3d4e5f6
Revises: f0a1b2c3d4e5
Create Date: 2026-05-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "f0a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "company_app_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("timezone_name", sa.String(length=64), nullable=True),
        sa.Column("date_format", sa.String(length=32), nullable=True),
        sa.Column("time_format", sa.String(length=8), nullable=True),
        sa.Column("currency_code", sa.String(length=8), nullable=True),
        sa.Column("week_start_day", sa.String(length=16), nullable=True),
        sa.Column("company_display_name", sa.String(length=200), nullable=True),
        sa.Column("brand_primary_color", sa.String(length=9), nullable=True),
        sa.Column("brand_logo_storage_path", sa.String(length=512), nullable=True),
        sa.Column("notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("email_notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("push_notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", name="uq_company_app_settings_company_id"),
    )
    op.create_index(
        op.f("ix_company_app_settings_company_id"),
        "company_app_settings",
        ["company_id"],
        unique=False,
    )

    op.create_table(
        "user_preferences",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("locale", sa.String(length=16), nullable=True),
        sa.Column("timezone_name", sa.String(length=64), nullable=True),
        sa.Column("date_format", sa.String(length=32), nullable=True),
        sa.Column("time_format", sa.String(length=8), nullable=True),
        sa.Column("compact_mode", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("notification_email_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notification_in_app_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("push_notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_user_preferences_user_id"),
    )
    op.create_index(op.f("ix_user_preferences_user_id"), "user_preferences", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_user_preferences_user_id"), table_name="user_preferences")
    op.drop_table("user_preferences")
    op.drop_index(op.f("ix_company_app_settings_company_id"), table_name="company_app_settings")
    op.drop_table("company_app_settings")
