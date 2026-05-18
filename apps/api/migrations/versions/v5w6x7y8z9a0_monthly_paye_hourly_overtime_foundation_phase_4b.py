"""Add Monthly PAYE hourly and overtime foundation fields.

Revision ID: v5w6x7y8z9a0
Revises: u4v5w6x7y8z9
Create Date: 2026-05-18 22:57:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "v5w6x7y8z9a0"
down_revision: Union[str, Sequence[str], None] = "u4v5w6x7y8z9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("employee_paye_settings", sa.Column("paye_hourly_rate", sa.Numeric(14, 4), nullable=True))
    op.add_column(
        "employee_paye_settings",
        sa.Column("paye_uses_time_records", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "employee_paye_settings",
        sa.Column("paye_hour_source", sa.String(length=32), nullable=False, server_default="completed_time_shifts"),
    )
    op.create_check_constraint(
        "ck_employee_paye_settings_hour_source",
        "employee_paye_settings",
        "paye_hour_source IN ('completed_time_shifts', 'manual_hours_future')",
    )

    op.add_column(
        "company_paye_settings",
        sa.Column("paye_overtime_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("company_paye_settings", sa.Column("paye_overtime_threshold_hours", sa.Numeric(10, 4), nullable=True))
    op.add_column("company_paye_settings", sa.Column("paye_overtime_multiplier", sa.Numeric(10, 4), nullable=True))
    op.create_check_constraint(
        "ck_company_paye_settings_overtime_threshold_nonnegative",
        "company_paye_settings",
        "paye_overtime_threshold_hours IS NULL OR paye_overtime_threshold_hours >= 0",
    )
    op.create_check_constraint(
        "ck_company_paye_settings_overtime_multiplier_nonnegative",
        "company_paye_settings",
        "paye_overtime_multiplier IS NULL OR paye_overtime_multiplier >= 0",
    )

    op.add_column("monthly_paye_items", sa.Column("regular_hours", sa.Numeric(12, 4), nullable=True))
    op.add_column("monthly_paye_items", sa.Column("overtime_hours", sa.Numeric(12, 4), nullable=True))
    op.add_column("monthly_paye_items", sa.Column("hourly_rate", sa.Numeric(14, 4), nullable=True))
    op.add_column("monthly_paye_items", sa.Column("gross_hourly_pay", sa.Numeric(14, 4), nullable=True))
    op.add_column("monthly_paye_items", sa.Column("regular_pay", sa.Numeric(14, 4), nullable=True))
    op.add_column("monthly_paye_items", sa.Column("overtime_pay", sa.Numeric(14, 4), nullable=True))
    op.add_column("monthly_paye_items", sa.Column("overtime_policy_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("monthly_paye_items", sa.Column("time_record_source_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("monthly_paye_items", "time_record_source_snapshot")
    op.drop_column("monthly_paye_items", "overtime_policy_snapshot")
    op.drop_column("monthly_paye_items", "overtime_pay")
    op.drop_column("monthly_paye_items", "regular_pay")
    op.drop_column("monthly_paye_items", "gross_hourly_pay")
    op.drop_column("monthly_paye_items", "hourly_rate")
    op.drop_column("monthly_paye_items", "overtime_hours")
    op.drop_column("monthly_paye_items", "regular_hours")
    op.drop_constraint("ck_company_paye_settings_overtime_multiplier_nonnegative", "company_paye_settings", type_="check")
    op.drop_constraint("ck_company_paye_settings_overtime_threshold_nonnegative", "company_paye_settings", type_="check")
    op.drop_column("company_paye_settings", "paye_overtime_multiplier")
    op.drop_column("company_paye_settings", "paye_overtime_threshold_hours")
    op.drop_column("company_paye_settings", "paye_overtime_enabled")
    op.drop_constraint("ck_employee_paye_settings_hour_source", "employee_paye_settings", type_="check")
    op.drop_column("employee_paye_settings", "paye_hour_source")
    op.drop_column("employee_paye_settings", "paye_uses_time_records")
    op.drop_column("employee_paye_settings", "paye_hourly_rate")
