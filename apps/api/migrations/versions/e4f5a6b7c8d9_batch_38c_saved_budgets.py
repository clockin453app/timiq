"""saved project budgets and expenses

Revision ID: e4f5a6b7c8d9
Revises: d2e3f4a5b6c7
Create Date: 2026-05-11

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "e4f5a6b7c8d9"
down_revision: Union[str, Sequence[str], None] = "d2e3f4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "budget_projects",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("workplace_id", sa.UUID(), nullable=True),
        sa.Column("location_id", sa.UUID(), nullable=True),
        sa.Column("client_name", sa.String(length=200), nullable=True),
        sa.Column("reference_code", sa.String(length=120), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("planned_budget_amount", sa.Numeric(precision=14, scale=4), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workplace_id"], ["workplaces.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_budget_projects_company_id"), "budget_projects", ["company_id"], unique=False)
    op.create_index(op.f("ix_budget_projects_status"), "budget_projects", ["status"], unique=False)
    op.create_index(op.f("ix_budget_projects_workplace_id"), "budget_projects", ["workplace_id"], unique=False)
    op.create_index(op.f("ix_budget_projects_location_id"), "budget_projects", ["location_id"], unique=False)
    op.create_index(op.f("ix_budget_projects_created_by_user_id"), "budget_projects", ["created_by_user_id"], unique=False)

    op.create_table(
        "budget_expenses",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("budget_id", sa.UUID(), nullable=False),
        sa.Column("company_id", sa.UUID(), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("supplier", sa.String(length=200), nullable=True),
        sa.Column("purchase_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=4), nullable=False),
        sa.Column("vat_amount", sa.Numeric(precision=14, scale=4), nullable=True),
        sa.Column("invoice_ref", sa.String(length=120), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["budget_id"], ["budget_projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_budget_expenses_budget_id"), "budget_expenses", ["budget_id"], unique=False)
    op.create_index(op.f("ix_budget_expenses_company_id"), "budget_expenses", ["company_id"], unique=False)
    op.create_index(op.f("ix_budget_expenses_category"), "budget_expenses", ["category"], unique=False)
    op.create_index(op.f("ix_budget_expenses_purchase_date"), "budget_expenses", ["purchase_date"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_budget_expenses_purchase_date"), table_name="budget_expenses")
    op.drop_index(op.f("ix_budget_expenses_category"), table_name="budget_expenses")
    op.drop_index(op.f("ix_budget_expenses_company_id"), table_name="budget_expenses")
    op.drop_index(op.f("ix_budget_expenses_budget_id"), table_name="budget_expenses")
    op.drop_table("budget_expenses")

    op.drop_index(op.f("ix_budget_projects_created_by_user_id"), table_name="budget_projects")
    op.drop_index(op.f("ix_budget_projects_location_id"), table_name="budget_projects")
    op.drop_index(op.f("ix_budget_projects_workplace_id"), table_name="budget_projects")
    op.drop_index(op.f("ix_budget_projects_status"), table_name="budget_projects")
    op.drop_index(op.f("ix_budget_projects_company_id"), table_name="budget_projects")
    op.drop_table("budget_projects")
