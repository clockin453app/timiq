"""batch 30 time clock rebuild

Revision ID: e7c8a9b3f1d2
Revises: b29f0d7e4c1a
Create Date: 2026-05-10 17:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e7c8a9b3f1d2"
down_revision: Union[str, Sequence[str], None] = "b29f0d7e4c1a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "time_shifts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=True),
        sa.Column("location_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("clock_in_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("clock_in_latitude", sa.Float(), nullable=False),
        sa.Column("clock_in_longitude", sa.Float(), nullable=False),
        sa.Column("clock_in_accuracy_meters", sa.Float(), nullable=False),
        sa.Column("clock_in_distance_to_site_meters", sa.Float(), nullable=False),
        sa.Column("clock_out_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("clock_out_latitude", sa.Float(), nullable=True),
        sa.Column("clock_out_longitude", sa.Float(), nullable=True),
        sa.Column("clock_out_accuracy_meters", sa.Float(), nullable=True),
        sa.Column("clock_out_distance_to_site_meters", sa.Float(), nullable=True),
        sa.Column("worked_seconds", sa.Integer(), nullable=True),
        sa.Column("break_seconds", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_time_shifts_company_id"), "time_shifts", ["company_id"], unique=False)
    op.create_index(op.f("ix_time_shifts_location_id"), "time_shifts", ["location_id"], unique=False)
    op.create_index(op.f("ix_time_shifts_user_id"), "time_shifts", ["user_id"], unique=False)
    op.execute(
        "CREATE UNIQUE INDEX uq_time_shifts_user_open ON time_shifts (user_id) WHERE status = 'open'"
    )

    op.create_table(
        "time_shift_breaks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("time_shift_id", sa.UUID(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["time_shift_id"], ["time_shifts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_time_shift_breaks_time_shift_id"),
        "time_shift_breaks",
        ["time_shift_id"],
        unique=False,
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_time_shift_breaks_shift_open ON time_shift_breaks (time_shift_id) WHERE ended_at IS NULL"
    )

    op.create_table(
        "clock_selfies",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("time_shift_id", sa.UUID(), nullable=False),
        sa.Column("phase", sa.String(length=20), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["time_shift_id"], ["time_shifts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_clock_selfies_time_shift_id"), "clock_selfies", ["time_shift_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_clock_selfies_time_shift_id"), table_name="clock_selfies")
    op.drop_table("clock_selfies")

    op.execute("DROP INDEX IF EXISTS uq_time_shift_breaks_shift_open")
    op.drop_index(op.f("ix_time_shift_breaks_time_shift_id"), table_name="time_shift_breaks")
    op.drop_table("time_shift_breaks")

    op.execute("DROP INDEX IF EXISTS uq_time_shifts_user_open")
    op.drop_index(op.f("ix_time_shifts_user_id"), table_name="time_shifts")
    op.drop_index(op.f("ix_time_shifts_location_id"), table_name="time_shifts")
    op.drop_index(op.f("ix_time_shifts_company_id"), table_name="time_shifts")
    op.drop_table("time_shifts")
