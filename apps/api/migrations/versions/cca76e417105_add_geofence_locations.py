"""add geofence locations

Revision ID: cca76e417105
Revises: d37aea919155
Create Date: 2026-05-07

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "cca76e417105"
down_revision: Union[str, Sequence[str], None] = "d37aea919155"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "locations",
        sa.Column("latitude", sa.Float(), nullable=True),
    )
    op.add_column(
        "locations",
        sa.Column("longitude", sa.Float(), nullable=True),
    )
    op.add_column(
        "locations",
        sa.Column("geofence_radius_meters", sa.Integer(), nullable=True),
    )

    op.execute("UPDATE locations SET latitude = 0 WHERE latitude IS NULL")
    op.execute("UPDATE locations SET longitude = 0 WHERE longitude IS NULL")
    op.execute(
        "UPDATE locations "
        "SET geofence_radius_meters = 100 "
        "WHERE geofence_radius_meters IS NULL"
    )

    op.alter_column(
        "locations",
        "latitude",
        existing_type=sa.Float(),
        nullable=False,
    )
    op.alter_column(
        "locations",
        "longitude",
        existing_type=sa.Float(),
        nullable=False,
    )
    op.alter_column(
        "locations",
        "geofence_radius_meters",
        existing_type=sa.Integer(),
        nullable=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("locations", "geofence_radius_meters")
    op.drop_column("locations", "longitude")
    op.drop_column("locations", "latitude")