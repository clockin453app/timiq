"""Smart forms and checklists foundation

Revision ID: c3d4e5f6a7b1
Revises: b2c3d4e5f6a0
Create Date: 2026-05-11

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c3d4e5f6a7b1"
down_revision: Union[str, Sequence[str], None] = "b2c3d4e5f6a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "smart_form_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.String(length=2000), nullable=True),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("schema_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("requires_location", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("requires_signature", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("allow_photos", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_smart_form_templates_company_id", "smart_form_templates", ["company_id"])
    op.create_index("ix_smart_form_templates_status", "smart_form_templates", ["status"])
    op.create_index("ix_smart_form_templates_category", "smart_form_templates", ["category"])

    op.create_table(
        "smart_form_submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("template_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("submitted_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("answers_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_notes", sa.String(length=2000), nullable=True),
        sa.Column("signature_name", sa.String(length=200), nullable=True),
        sa.Column("signature_image_path", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["submitted_by_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["template_id"], ["smart_form_templates.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_smart_form_submissions_company_id", "smart_form_submissions", ["company_id"])
    op.create_index("ix_smart_form_submissions_template_id", "smart_form_submissions", ["template_id"])
    op.create_index("ix_smart_form_submissions_user_id", "smart_form_submissions", ["submitted_by_user_id"])
    op.create_index("ix_smart_form_submissions_status", "smart_form_submissions", ["status"])


def downgrade() -> None:
    op.drop_index("ix_smart_form_submissions_status", table_name="smart_form_submissions")
    op.drop_index("ix_smart_form_submissions_user_id", table_name="smart_form_submissions")
    op.drop_index("ix_smart_form_submissions_template_id", table_name="smart_form_submissions")
    op.drop_index("ix_smart_form_submissions_company_id", table_name="smart_form_submissions")
    op.drop_table("smart_form_submissions")
    op.drop_index("ix_smart_form_templates_category", table_name="smart_form_templates")
    op.drop_index("ix_smart_form_templates_status", table_name="smart_form_templates")
    op.drop_index("ix_smart_form_templates_company_id", table_name="smart_form_templates")
    op.drop_table("smart_form_templates")
