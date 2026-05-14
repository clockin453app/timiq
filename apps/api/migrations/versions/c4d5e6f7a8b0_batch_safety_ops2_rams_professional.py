"""SAFETY-OPS-2: RAMS professional document fields + attachments

Revision ID: c4d5e6f7a8b0
Revises: a1b2c3d4e5f7
Create Date: 2026-05-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4d5e6f7a8b0"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rams_assessments", sa.Column("project_name", sa.String(length=300), nullable=True))
    op.add_column("rams_assessments", sa.Column("client_name", sa.String(length=300), nullable=True))
    op.add_column(
        "rams_assessments", sa.Column("principal_contractor", sa.String(length=300), nullable=True)
    )
    op.add_column(
        "rams_assessments", sa.Column("subcontractor_name", sa.String(length=300), nullable=True)
    )
    op.add_column("rams_assessments", sa.Column("site_address", sa.Text(), nullable=True))
    op.add_column(
        "rams_assessments",
        sa.Column("revision", sa.String(length=32), nullable=False, server_default="01"),
    )
    op.add_column("rams_assessments", sa.Column("reason_for_issue", sa.Text(), nullable=True))
    op.add_column("rams_assessments", sa.Column("produced_by_name", sa.String(length=200), nullable=True))
    op.add_column("rams_assessments", sa.Column("checked_by_name", sa.String(length=200), nullable=True))
    op.add_column("rams_assessments", sa.Column("approved_by_name", sa.String(length=200), nullable=True))
    op.add_column("rams_assessments", sa.Column("emergency_contact", sa.String(length=500), nullable=True))
    op.add_column("rams_assessments", sa.Column("site_manager", sa.String(length=200), nullable=True))
    op.add_column("rams_assessments", sa.Column("first_aider", sa.String(length=200), nullable=True))
    op.add_column("rams_assessments", sa.Column("fire_marshal", sa.String(length=200), nullable=True))
    op.add_column("rams_assessments", sa.Column("muster_point", sa.String(length=500), nullable=True))
    op.add_column("rams_assessments", sa.Column("nearest_hospital", sa.String(length=500), nullable=True))
    op.add_column("rams_assessments", sa.Column("emergency_arrangements", sa.Text(), nullable=True))
    op.add_column("rams_assessments", sa.Column("site_security", sa.Text(), nullable=True))
    op.add_column("rams_assessments", sa.Column("welfare_arrangements", sa.Text(), nullable=True))
    op.add_column("rams_assessments", sa.Column("public_protection", sa.Text(), nullable=True))
    op.add_column("rams_assessments", sa.Column("deliveries_storage", sa.Text(), nullable=True))
    op.add_column("rams_assessments", sa.Column("scope_of_works", sa.Text(), nullable=True))
    op.add_column(
        "rams_assessments",
        sa.Column("sequence_of_works", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "rams_assessments",
        sa.Column("pre_start_checklist", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "rams_assessments",
        sa.Column("plant_tools", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "rams_assessments",
        sa.Column("training_requirements", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "rams_assessments",
        sa.Column("coshh_items", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "rams_assessments",
        sa.Column("glove_requirements", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "rams_assessments",
        sa.Column("method_statement_sections", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    op.create_table(
        "rams_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("assessment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("section_key", sa.String(length=64), nullable=False),
        sa.Column("hazard_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("method_step_key", sa.String(length=120), nullable=True),
        sa.Column("original_filename", sa.String(length=500), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("caption", sa.String(length=500), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assessment_id"], ["rams_assessments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["hazard_id"], ["rams_hazards.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_rams_attachments_assessment_id", "rams_attachments", ["assessment_id"])
    op.create_index("ix_rams_attachments_company_id", "rams_attachments", ["company_id"])


def downgrade() -> None:
    op.drop_index("ix_rams_attachments_company_id", table_name="rams_attachments")
    op.drop_index("ix_rams_attachments_assessment_id", table_name="rams_attachments")
    op.drop_table("rams_attachments")

    op.drop_column("rams_assessments", "method_statement_sections")
    op.drop_column("rams_assessments", "glove_requirements")
    op.drop_column("rams_assessments", "coshh_items")
    op.drop_column("rams_assessments", "training_requirements")
    op.drop_column("rams_assessments", "plant_tools")
    op.drop_column("rams_assessments", "pre_start_checklist")
    op.drop_column("rams_assessments", "sequence_of_works")
    op.drop_column("rams_assessments", "scope_of_works")
    op.drop_column("rams_assessments", "deliveries_storage")
    op.drop_column("rams_assessments", "public_protection")
    op.drop_column("rams_assessments", "welfare_arrangements")
    op.drop_column("rams_assessments", "site_security")
    op.drop_column("rams_assessments", "emergency_arrangements")
    op.drop_column("rams_assessments", "nearest_hospital")
    op.drop_column("rams_assessments", "muster_point")
    op.drop_column("rams_assessments", "fire_marshal")
    op.drop_column("rams_assessments", "first_aider")
    op.drop_column("rams_assessments", "site_manager")
    op.drop_column("rams_assessments", "emergency_contact")
    op.drop_column("rams_assessments", "approved_by_name")
    op.drop_column("rams_assessments", "checked_by_name")
    op.drop_column("rams_assessments", "produced_by_name")
    op.drop_column("rams_assessments", "reason_for_issue")
    op.drop_column("rams_assessments", "revision")
    op.drop_column("rams_assessments", "site_address")
    op.drop_column("rams_assessments", "subcontractor_name")
    op.drop_column("rams_assessments", "principal_contractor")
    op.drop_column("rams_assessments", "client_name")
    op.drop_column("rams_assessments", "project_name")
