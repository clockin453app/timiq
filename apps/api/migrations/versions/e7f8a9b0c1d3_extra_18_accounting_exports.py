"""EXTRA-18 accounting export runs and mapping settings

Revision ID: e7f8a9b0c1d3
Revises: d6e7f8a9b0c2
Create Date: 2026-05-12

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "e7f8a9b0c1d3"
down_revision: Union[str, Sequence[str], None] = "d6e7f8a9b0c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "accounting_export_runs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("export_type", sa.String(length=32), nullable=False),
        sa.Column("date_from", sa.Date(), nullable=False),
        sa.Column("date_to", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("total_amount", sa.Numeric(precision=16, scale=4), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("filters_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_accounting_export_runs_company_id"),
        "accounting_export_runs",
        ["company_id"],
        unique=False,
    )

    op.create_table(
        "accounting_export_settings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("nominal_code_wages", sa.String(length=64), nullable=True),
        sa.Column("nominal_code_cis", sa.String(length=64), nullable=True),
        sa.Column("nominal_code_materials", sa.String(length=64), nullable=True),
        sa.Column("nominal_code_tools", sa.String(length=64), nullable=True),
        sa.Column("nominal_code_equipment", sa.String(length=64), nullable=True),
        sa.Column("nominal_code_subcontractor", sa.String(length=64), nullable=True),
        sa.Column("tax_code", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "provider", name="uq_accounting_export_settings_company_provider"),
    )
    op.create_index(
        op.f("ix_accounting_export_settings_company_id"),
        "accounting_export_settings",
        ["company_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_accounting_export_settings_company_id"), table_name="accounting_export_settings")
    op.drop_table("accounting_export_settings")
    op.drop_index(op.f("ix_accounting_export_runs_company_id"), table_name="accounting_export_runs")
    op.drop_table("accounting_export_runs")
