"""Default push notification preferences on for new rows.

Revision ID: p9q0r1s2t3u4
Revises: o8p9q0r1s2t3
Create Date: 2026-05-18 14:15:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "p9q0r1s2t3u4"
down_revision: Union[str, Sequence[str], None] = "o8p9q0r1s2t3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("user_preferences", "push_notifications_enabled", server_default=sa.true())
    op.alter_column("company_app_settings", "push_notifications_enabled", server_default=sa.true())


def downgrade() -> None:
    op.alter_column("company_app_settings", "push_notifications_enabled", server_default=None)
    op.alter_column("user_preferences", "push_notifications_enabled", server_default=None)
