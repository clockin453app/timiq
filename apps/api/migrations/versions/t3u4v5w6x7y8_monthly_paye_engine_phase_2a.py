"""Add monthly PAYE engine Phase 2A tables.

Revision ID: t3u4v5w6x7y8
Revises: s2t3u4v5w6x7
Create Date: 2026-05-18 20:10:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.modules.paye_payroll.rules import SOURCE_NOTE, SUPPORTED_TAX_YEAR, paye_rules_2026_2027

revision: str = "t3u4v5w6x7y8"
down_revision: Union[str, Sequence[str], None] = "s2t3u4v5w6x7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "monthly_paye_periods",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tax_year", sa.String(length=9), nullable=False),
        sa.Column("tax_month", sa.Integer(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("pay_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("calculated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("calculated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["calculated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["paid_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "tax_year", "tax_month", name="uq_monthly_paye_period_company_tax_month"),
    )
    op.create_index("ix_monthly_paye_periods_company_id", "monthly_paye_periods", ["company_id"])
    op.create_index("ix_monthly_paye_periods_status", "monthly_paye_periods", ["status"])
    op.create_index("ix_monthly_paye_periods_tax_year", "monthly_paye_periods", ["tax_year"])

    op.create_table(
        "monthly_paye_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("period_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payroll_type", sa.String(length=32), nullable=False),
        sa.Column("pay_frequency", sa.String(length=32), nullable=False),
        sa.Column("salary_type", sa.String(length=32), nullable=False),
        sa.Column("monthly_salary", sa.Numeric(14, 4), nullable=True),
        sa.Column("tax_code", sa.String(length=32), nullable=True),
        sa.Column("tax_basis", sa.String(length=32), nullable=False),
        sa.Column("ni_category", sa.String(length=8), nullable=True),
        sa.Column("student_loan_plan", sa.String(length=16), nullable=False),
        sa.Column("postgraduate_loan", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("pension_enrolment_status", sa.String(length=32), nullable=False),
        sa.Column("employee_pension_percent", sa.Numeric(7, 4), nullable=True),
        sa.Column("employer_pension_percent", sa.Numeric(7, 4), nullable=True),
        sa.Column("pension_scheme_basis", sa.String(length=32), nullable=False),
        sa.Column("pension_relief_method", sa.String(length=32), nullable=False),
        sa.Column("gross_pay", sa.Numeric(14, 4), nullable=True),
        sa.Column("taxable_pay", sa.Numeric(14, 4), nullable=True),
        sa.Column("niable_pay", sa.Numeric(14, 4), nullable=True),
        sa.Column("pensionable_pay", sa.Numeric(14, 4), nullable=True),
        sa.Column("paye_tax", sa.Numeric(14, 4), nullable=True),
        sa.Column("employee_ni", sa.Numeric(14, 4), nullable=True),
        sa.Column("employer_ni", sa.Numeric(14, 4), nullable=True),
        sa.Column("employee_pension", sa.Numeric(14, 4), nullable=True),
        sa.Column("employer_pension", sa.Numeric(14, 4), nullable=True),
        sa.Column("student_loan", sa.Numeric(14, 4), nullable=True),
        sa.Column("postgraduate_loan_deduction", sa.Numeric(14, 4), nullable=True),
        sa.Column("other_deductions", sa.Numeric(14, 4), nullable=False, server_default="0"),
        sa.Column("additions", sa.Numeric(14, 4), nullable=False, server_default="0"),
        sa.Column("total_deductions", sa.Numeric(14, 4), nullable=True),
        sa.Column("net_pay", sa.Numeric(14, 4), nullable=True),
        sa.Column("ytd_gross_pay", sa.Numeric(14, 4), nullable=True),
        sa.Column("ytd_taxable_pay", sa.Numeric(14, 4), nullable=True),
        sa.Column("ytd_paye_tax", sa.Numeric(14, 4), nullable=True),
        sa.Column("ytd_employee_ni", sa.Numeric(14, 4), nullable=True),
        sa.Column("ytd_employer_ni", sa.Numeric(14, 4), nullable=True),
        sa.Column("ytd_employee_pension", sa.Numeric(14, 4), nullable=True),
        sa.Column("ytd_employer_pension", sa.Numeric(14, 4), nullable=True),
        sa.Column("ytd_student_loan", sa.Numeric(14, 4), nullable=True),
        sa.Column("ytd_postgraduate_loan", sa.Numeric(14, 4), nullable=True),
        sa.Column("ytd_net_pay", sa.Numeric(14, 4), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("calculation_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("unsupported_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["paid_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["period_id"], ["monthly_paye_periods.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("period_id", "user_id", name="uq_monthly_paye_item_period_user"),
    )
    op.create_index("ix_monthly_paye_items_company_id", "monthly_paye_items", ["company_id"])
    op.create_index("ix_monthly_paye_items_period_id", "monthly_paye_items", ["period_id"])
    op.create_index("ix_monthly_paye_items_status", "monthly_paye_items", ["status"])
    op.create_index("ix_monthly_paye_items_user_id", "monthly_paye_items", ["user_id"])

    op.execute(
        sa.text(
            """
            INSERT INTO paye_tax_year_rules (tax_year, rules_json, source_note, created_at, updated_at)
            VALUES (:tax_year, CAST(:rules_json AS jsonb), :source_note, NOW(), NOW())
            ON CONFLICT (tax_year) DO UPDATE
            SET rules_json = EXCLUDED.rules_json,
                source_note = EXCLUDED.source_note,
                updated_at = NOW()
            """,
        ).bindparams(
            tax_year=SUPPORTED_TAX_YEAR,
            rules_json=__import__("json").dumps(paye_rules_2026_2027()),
            source_note=SOURCE_NOTE,
        ),
    )


def downgrade() -> None:
    op.drop_index("ix_monthly_paye_items_user_id", table_name="monthly_paye_items")
    op.drop_index("ix_monthly_paye_items_status", table_name="monthly_paye_items")
    op.drop_index("ix_monthly_paye_items_period_id", table_name="monthly_paye_items")
    op.drop_index("ix_monthly_paye_items_company_id", table_name="monthly_paye_items")
    op.drop_table("monthly_paye_items")
    op.drop_index("ix_monthly_paye_periods_tax_year", table_name="monthly_paye_periods")
    op.drop_index("ix_monthly_paye_periods_status", table_name="monthly_paye_periods")
    op.drop_index("ix_monthly_paye_periods_company_id", table_name="monthly_paye_periods")
    op.drop_table("monthly_paye_periods")
