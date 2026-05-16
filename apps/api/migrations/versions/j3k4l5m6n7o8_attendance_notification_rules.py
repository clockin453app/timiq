"""Attendance notification settings and persistent notification records.

Revision ID: j3k4l5m6n7o8
Revises: i2j3k4l5m6n7
Create Date: 2026-05-16 13:07:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "j3k4l5m6n7o8"
down_revision: Union[str, Sequence[str], None] = "i2j3k4l5m6n7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "attendance_notification_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("late_arrival_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("late_arrival_grace_minutes", sa.Integer(), nullable=False, server_default=sa.text("15")),
        sa.Column("late_arrival_notify_employee", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("late_arrival_notify_admins", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("forgot_clock_in_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("forgot_clock_in_check_time", sa.String(length=5), nullable=False, server_default=sa.text("'09:30'")),
        sa.Column("forgot_clock_in_notify_employee", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("forgot_clock_in_notify_admins", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("forgot_clock_out_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("forgot_clock_out_threshold_hours", sa.Integer(), nullable=False, server_default=sa.text("12")),
        sa.Column("forgot_clock_out_repeat_hours", sa.Integer(), nullable=True),
        sa.Column("forgot_clock_out_notify_employee", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("forgot_clock_out_notify_admins", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("ignore_approved_leave", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("active_weekdays", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[0,1,2,3,4]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", name="uq_attendance_notification_settings_company_id"),
    )
    op.create_index(
        op.f("ix_attendance_notification_settings_company_id"),
        "attendance_notification_settings",
        ["company_id"],
        unique=False,
    )

    op.create_table(
        "notification_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("recipient_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("dedupe_key", sa.String(length=512), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("href", sa.String(length=300), nullable=False),
        sa.Column("priority", sa.String(length=16), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("source_rule_type", sa.String(length=64), nullable=True),
        sa.Column("subject_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("shift_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("work_date", sa.Date(), nullable=True),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recipient_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shift_id"], ["time_shifts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["subject_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("recipient_user_id", "kind", "dedupe_key", name="uq_notification_records_recipient_kind_dedupe"),
    )
    op.create_index(op.f("ix_notification_records_company_id"), "notification_records", ["company_id"], unique=False)
    op.create_index(op.f("ix_notification_records_kind"), "notification_records", ["kind"], unique=False)
    op.create_index(op.f("ix_notification_records_recipient_user_id"), "notification_records", ["recipient_user_id"], unique=False)
    op.create_index(op.f("ix_notification_records_shift_id"), "notification_records", ["shift_id"], unique=False)
    op.create_index(op.f("ix_notification_records_source_rule_type"), "notification_records", ["source_rule_type"], unique=False)
    op.create_index(op.f("ix_notification_records_subject_user_id"), "notification_records", ["subject_user_id"], unique=False)
    op.create_index(op.f("ix_notification_records_work_date"), "notification_records", ["work_date"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_notification_records_work_date"), table_name="notification_records")
    op.drop_index(op.f("ix_notification_records_subject_user_id"), table_name="notification_records")
    op.drop_index(op.f("ix_notification_records_source_rule_type"), table_name="notification_records")
    op.drop_index(op.f("ix_notification_records_shift_id"), table_name="notification_records")
    op.drop_index(op.f("ix_notification_records_recipient_user_id"), table_name="notification_records")
    op.drop_index(op.f("ix_notification_records_kind"), table_name="notification_records")
    op.drop_index(op.f("ix_notification_records_company_id"), table_name="notification_records")
    op.drop_table("notification_records")
    op.drop_index(op.f("ix_attendance_notification_settings_company_id"), table_name="attendance_notification_settings")
    op.drop_table("attendance_notification_settings")
