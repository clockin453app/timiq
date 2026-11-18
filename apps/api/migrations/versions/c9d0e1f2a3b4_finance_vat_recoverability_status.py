"""Add nullable VAT recoverability status to cost register.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3

Additive only:
- nullable vat_recoverability_status on finance_cost_documents and finance_cost_lines
- nullable vat_classification_basis on both tables
- check constraints that allow NULL (unknown) without inventing recoverable/non-recoverable
- posting guard so unclassified VAT cannot be posted

Does NOT:
- backfill confirmed_* from amounts
- rewrite net/tax/recoverable/eligible/gross values
- DROP/TRUNCATE/DELETE rows
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, Sequence[str], None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STATUS_SQL = (
    "'not_determined', "
    "'confirmed_non_recoverable', "
    "'confirmed_recoverable', "
    "'accountant_review', "
    "'historical_unreviewed'"
)


def upgrade() -> None:
    op.add_column(
        "finance_cost_documents",
        sa.Column("vat_recoverability_status", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "finance_cost_documents",
        sa.Column("vat_classification_basis", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "finance_cost_lines",
        sa.Column("vat_recoverability_status", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "finance_cost_lines",
        sa.Column("vat_classification_basis", sa.String(length=64), nullable=True),
    )

    op.create_check_constraint(
        "ck_finance_cost_documents_vat_status",
        "finance_cost_documents",
        f"vat_recoverability_status IS NULL OR vat_recoverability_status IN ({_STATUS_SQL})",
    )
    op.create_check_constraint(
        "ck_finance_cost_lines_vat_status",
        "finance_cost_lines",
        f"vat_recoverability_status IS NULL OR vat_recoverability_status IN ({_STATUS_SQL})",
    )
    # Amount identity stays on existing non_recoverable = tax - recoverable checks.
    # not_determined / accountant_review are labels only; posting guard blocks them.

    op.execute(
        """
        CREATE OR REPLACE FUNCTION finance_cost_document_vat_status_guard()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF NEW.status = 'posted' AND (
                NEW.vat_recoverability_status IS NULL
                OR NEW.vat_recoverability_status NOT IN (
                    'confirmed_non_recoverable', 'confirmed_recoverable'
                )
                OR EXISTS (
                    SELECT 1 FROM finance_cost_lines
                    WHERE document_id = NEW.id
                      AND (
                        vat_recoverability_status IS NULL
                        OR vat_recoverability_status NOT IN (
                            'confirmed_non_recoverable', 'confirmed_recoverable'
                        )
                      )
                )
            ) THEN
                RAISE EXCEPTION 'unclassified VAT cannot be posted';
            END IF;
            RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_finance_cost_documents_vat_status ON finance_cost_documents;
        CREATE TRIGGER trg_finance_cost_documents_vat_status
            BEFORE UPDATE OF status ON finance_cost_documents
            FOR EACH ROW EXECUTE FUNCTION finance_cost_document_vat_status_guard();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_finance_cost_documents_vat_status ON finance_cost_documents;")
    op.execute("DROP FUNCTION IF EXISTS finance_cost_document_vat_status_guard();")
    op.drop_constraint("ck_finance_cost_lines_vat_status", "finance_cost_lines", type_="check")
    op.drop_constraint("ck_finance_cost_documents_vat_status", "finance_cost_documents", type_="check")
    op.drop_column("finance_cost_lines", "vat_classification_basis")
    op.drop_column("finance_cost_lines", "vat_recoverability_status")
    op.drop_column("finance_cost_documents", "vat_classification_basis")
    op.drop_column("finance_cost_documents", "vat_recoverability_status")
