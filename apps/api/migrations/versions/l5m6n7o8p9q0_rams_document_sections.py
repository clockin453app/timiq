"""Add RAMS document sections.

Revision ID: l5m6n7o8p9q0
Revises: k4l5m6n7o8p9
Create Date: 2026-05-16 15:04:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "l5m6n7o8p9q0"
down_revision: Union[str, Sequence[str], None] = "k4l5m6n7o8p9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rams_assessments", sa.Column("document_sections", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("rams_assessments", "document_sections")
