"""Budget tasks and project notes phase 4.

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-08-05

Creates budget_tasks and budget_project_notes for admin job follow-up.
Does not alter billing, invoice, payment, cost, or labour tables.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "e7f8a9b0c1d2"
down_revision: Union[str, Sequence[str], None] = "d6e7f8a9b0c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "budget_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("budget_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_action_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="to_do"),
        sa.Column("priority", sa.String(length=20), nullable=False, server_default="normal"),
        sa.Column("category", sa.String(length=32), nullable=False, server_default="general"),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("assignee_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("completed_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('to_do', 'in_progress', 'blocked', 'completed', 'cancelled')",
            name="ck_budget_tasks_status",
        ),
        sa.CheckConstraint(
            "priority IN ('low', 'normal', 'high', 'urgent')",
            name="ck_budget_tasks_priority",
        ),
        sa.CheckConstraint(
            "category IN ('general', 'client', 'site', 'purchase', 'labour', 'billing', 'compliance')",
            name="ck_budget_tasks_category",
        ),
        sa.ForeignKeyConstraint(["assignee_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["budget_id"], ["budget_projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cancelled_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["completed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_budget_tasks_company_id", "budget_tasks", ["company_id"], unique=False)
    op.create_index("ix_budget_tasks_budget_id", "budget_tasks", ["budget_id"], unique=False)
    op.create_index(
        "ix_budget_tasks_company_budget_status",
        "budget_tasks",
        ["company_id", "budget_id", "status"],
        unique=False,
    )
    op.create_index("ix_budget_tasks_due_date", "budget_tasks", ["due_date"], unique=False)
    op.create_index("ix_budget_tasks_assignee_user_id", "budget_tasks", ["assignee_user_id"], unique=False)
    op.create_index("ix_budget_tasks_priority", "budget_tasks", ["priority"], unique=False)
    op.create_index("ix_budget_tasks_status", "budget_tasks", ["status"], unique=False)
    op.create_index(
        "uq_budget_tasks_company_client_action",
        "budget_tasks",
        ["company_id", "client_action_id"],
        unique=True,
        postgresql_where=sa.text("client_action_id IS NOT NULL"),
    )

    op.create_table(
        "budget_project_notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("budget_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_action_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["budget_id"], ["budget_projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_budget_project_notes_company_id", "budget_project_notes", ["company_id"], unique=False)
    op.create_index("ix_budget_project_notes_budget_id", "budget_project_notes", ["budget_id"], unique=False)
    op.create_index(
        "ix_budget_project_notes_pinned_created",
        "budget_project_notes",
        ["budget_id", "is_pinned", "created_at"],
        unique=False,
    )
    op.create_index(
        "uq_budget_project_notes_company_client_action",
        "budget_project_notes",
        ["company_id", "client_action_id"],
        unique=True,
        postgresql_where=sa.text("client_action_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_budget_project_notes_company_client_action",
        table_name="budget_project_notes",
    )
    op.drop_index("ix_budget_project_notes_pinned_created", table_name="budget_project_notes")
    op.drop_index("ix_budget_project_notes_budget_id", table_name="budget_project_notes")
    op.drop_index("ix_budget_project_notes_company_id", table_name="budget_project_notes")
    op.drop_table("budget_project_notes")

    op.drop_index("uq_budget_tasks_company_client_action", table_name="budget_tasks")
    op.drop_index("ix_budget_tasks_status", table_name="budget_tasks")
    op.drop_index("ix_budget_tasks_priority", table_name="budget_tasks")
    op.drop_index("ix_budget_tasks_assignee_user_id", table_name="budget_tasks")
    op.drop_index("ix_budget_tasks_due_date", table_name="budget_tasks")
    op.drop_index("ix_budget_tasks_company_budget_status", table_name="budget_tasks")
    op.drop_index("ix_budget_tasks_budget_id", table_name="budget_tasks")
    op.drop_index("ix_budget_tasks_company_id", table_name="budget_tasks")
    op.drop_table("budget_tasks")
