"""Link finance_projects to operational workplaces by stable ID.

Revision ID: b8c9d0e1f2a3
Revises: a7c8d9e0f1a2

Additive only: nullable workplace_id on finance_projects, FK to workplaces,
partial unique (company_id, workplace_id), and a composite FK that enforces
workplace.company_id == finance_projects.company_id at the database level.
Does not modify workplaces rows, payroll, or existing Finance financial values.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, Sequence[str], None] = "a7c8d9e0f1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "finance_projects",
        sa.Column("workplace_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    # Support composite FK (workplace_id, company_id) -> workplaces(id, company_id).
    op.create_index(
        "uq_workplaces_id_company",
        "workplaces",
        ["id", "company_id"],
        unique=True,
    )
    op.create_foreign_key(
        "fk_finance_projects_workplace_id",
        "finance_projects",
        "workplaces",
        ["workplace_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_finance_projects_workplace_company",
        "finance_projects",
        "workplaces",
        ["workplace_id", "company_id"],
        ["id", "company_id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_finance_projects_workplace_id",
        "finance_projects",
        ["workplace_id"],
        unique=False,
    )
    op.create_index(
        "uq_finance_projects_company_workplace",
        "finance_projects",
        ["company_id", "workplace_id"],
        unique=True,
        postgresql_where=sa.text("workplace_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_finance_projects_company_workplace", table_name="finance_projects")
    op.drop_index("ix_finance_projects_workplace_id", table_name="finance_projects")
    op.drop_constraint("fk_finance_projects_workplace_company", "finance_projects", type_="foreignkey")
    op.drop_constraint("fk_finance_projects_workplace_id", "finance_projects", type_="foreignkey")
    op.drop_index("uq_workplaces_id_company", table_name="workplaces")
    op.drop_column("finance_projects", "workplace_id")
