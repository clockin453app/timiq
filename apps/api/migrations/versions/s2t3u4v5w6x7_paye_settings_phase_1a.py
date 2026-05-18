"""Add PAYE settings foundation.

Revision ID: s2t3u4v5w6x7
Revises: r1s2t3u4v5w6
Create Date: 2026-05-18 19:03:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "s2t3u4v5w6x7"
down_revision: Union[str, Sequence[str], None] = "r1s2t3u4v5w6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "employee_profiles",
        sa.Column(
            "payroll_type",
            sa.String(length=32),
            nullable=False,
            server_default="cis_subcontractor",
        ),
    )
    op.create_table(
        "employee_paye_settings",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("pay_frequency", sa.String(length=32), nullable=False, server_default="monthly"),
        sa.Column("salary_type", sa.String(length=32), nullable=False, server_default="hourly"),
        sa.Column("monthly_salary", sa.Numeric(14, 4), nullable=True),
        sa.Column("tax_code", sa.String(length=32), nullable=True),
        sa.Column("tax_basis", sa.String(length=32), nullable=False, server_default="cumulative"),
        sa.Column("ni_category", sa.String(length=8), nullable=True),
        sa.Column("student_loan_plan", sa.String(length=16), nullable=False, server_default="none"),
        sa.Column("postgraduate_loan", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("pension_enrolment_status", sa.String(length=32), nullable=False, server_default="not_eligible"),
        sa.Column("employee_pension_percent", sa.Numeric(7, 4), nullable=True),
        sa.Column("employer_pension_percent", sa.Numeric(7, 4), nullable=True),
        sa.Column("pension_scheme_basis", sa.String(length=32), nullable=False, server_default="qualifying_earnings"),
        sa.Column("pension_relief_method", sa.String(length=32), nullable=False, server_default="relief_at_source"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_index("ix_employee_paye_settings_company_id", "employee_paye_settings", ["company_id"])
    op.create_table(
        "company_paye_settings",
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("paye_reference", sa.String(length=64), nullable=True),
        sa.Column("accounts_office_reference", sa.String(length=64), nullable=True),
        sa.Column("pension_provider_name", sa.String(length=160), nullable=True),
        sa.Column("default_employee_pension_percent", sa.Numeric(7, 4), nullable=True),
        sa.Column("default_employer_pension_percent", sa.Numeric(7, 4), nullable=True),
        sa.Column("default_pension_basis", sa.String(length=32), nullable=False, server_default="qualifying_earnings"),
        sa.Column("monthly_payday_rule", sa.String(length=64), nullable=True),
        sa.Column("pay_period_closing_day", sa.Integer(), nullable=True),
        sa.Column("default_tax_year", sa.String(length=9), nullable=True),
        sa.Column("rti_status", sa.String(length=32), nullable=False, server_default="not_ready"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("company_id"),
    )
    op.create_table(
        "paye_tax_year_rules",
        sa.Column("tax_year", sa.String(length=9), nullable=False),
        sa.Column("rules_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("source_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("tax_year"),
    )


def downgrade() -> None:
    op.drop_table("paye_tax_year_rules")
    op.drop_table("company_paye_settings")
    op.drop_index("ix_employee_paye_settings_company_id", table_name="employee_paye_settings")
    op.drop_table("employee_paye_settings")
    op.drop_column("employee_profiles", "payroll_type")
