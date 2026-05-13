"""employee profile NI and UTR columns

Revision ID: d2e3f4a5b6c7
Revises: c0d1e2f3a4b5
Create Date: 2026-05-11 14:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d2e3f4a5b6c7"
down_revision: Union[str, Sequence[str], None] = "c0d1e2f3a4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "employee_profiles",
        sa.Column("national_insurance_number", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "employee_profiles",
        sa.Column("utr_number", sa.String(length=32), nullable=True),
    )
    # Best-effort NI copy from approved onboarding (no raw JSON in API; DB-only backfill).
    op.execute(
        sa.text(
            """
            UPDATE employee_profiles ep
            SET national_insurance_number = TRIM(
                SUBSTRING(COALESCE(os.form_payload->>'national_insurance_number', '') FROM 1 FOR 32)
            )
            FROM onboarding_submissions os
            WHERE os.user_id = ep.user_id
              AND os.status = 'approved'
              AND (ep.national_insurance_number IS NULL OR ep.national_insurance_number = '')
              AND TRIM(COALESCE(os.form_payload->>'national_insurance_number', '')) <> ''
            """,
        ),
    )
    op.execute(
        sa.text(
            """
            UPDATE employee_profiles ep
            SET utr_number = TRIM(
                SUBSTRING(regexp_replace(COALESCE(os.form_payload->>'utr', ''), '[^0-9]', '', 'g') FROM 1 FOR 32)
            )
            FROM onboarding_submissions os
            WHERE os.user_id = ep.user_id
              AND os.status = 'approved'
              AND (ep.utr_number IS NULL OR ep.utr_number = '')
              AND length(regexp_replace(COALESCE(os.form_payload->>'utr', ''), '[^0-9]', '', 'g')) > 0
            """,
        ),
    )


def downgrade() -> None:
    op.drop_column("employee_profiles", "utr_number")
    op.drop_column("employee_profiles", "national_insurance_number")
