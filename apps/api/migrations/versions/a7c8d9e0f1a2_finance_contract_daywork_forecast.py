"""Structured dayworks, contract values, opening settlements, and cost to complete.

Revision ID: a7c8d9e0f1a2
Revises: f5c6d7e8f9a0

Additive only. Does not change installed Finance tables except new nullable-default
columns on finance_dayworks. Does not change payroll or attendance.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a7c8d9e0f1a2"
down_revision: Union[str, Sequence[str], None] = "f5c6d7e8f9a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = sa.Numeric(18, 4)


def upgrade() -> None:
    op.add_column("finance_dayworks", sa.Column("labour_amount", MONEY, nullable=False, server_default="0"))
    op.add_column("finance_dayworks", sa.Column("material_amount", MONEY, nullable=False, server_default="0"))
    op.add_column("finance_dayworks", sa.Column("plant_amount", MONEY, nullable=False, server_default="0"))
    op.create_check_constraint("ck_fin_daywork_parts_nonneg", "finance_dayworks", "labour_amount >= 0 AND material_amount >= 0 AND plant_amount >= 0")
    op.create_check_constraint(
        "ck_fin_daywork_parts_sum",
        "finance_dayworks",
        "(labour_amount = 0 AND material_amount = 0 AND plant_amount = 0) OR (labour_amount + material_amount + plant_amount = submitted_value)",
    )
    op.create_table(
        "finance_contract_values",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["company_id", "project_id"],
            ["finance_projects.company_id", "finance_projects.id"],
            name="fk_fin_contract_project",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("project_id", "revision_number", name="uq_fin_contract_revision"),
        sa.CheckConstraint("revision_number >= 1", name="ck_fin_contract_revision"),
        sa.CheckConstraint("amount >= 0", name="ck_fin_contract_amount"),
    )
    op.create_table(
        "finance_cost_to_complete",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["company_id", "project_id"],
            ["finance_projects.company_id", "finance_projects.id"],
            name="fk_fin_ctc_project",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("project_id", "revision_number", name="uq_fin_ctc_revision"),
        sa.CheckConstraint("revision_number >= 1", name="ck_fin_ctc_revision"),
        sa.CheckConstraint("amount >= 0", name="ck_fin_ctc_amount"),
    )
    op.create_table(
        "finance_opening_settlements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("opening_balance_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("settlement_date", sa.Date(), nullable=False),
        sa.Column("external_reference", sa.String(120), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("posted_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["opening_balance_id"],
            ["finance_opening_balances.id"],
            name="fk_fin_opening_settle_balance",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("amount > 0", name="ck_fin_opening_settle_positive"),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_fin_opening_settle_status"),
        sa.CheckConstraint("status <> 'posted' OR posted_at IS NOT NULL", name="ck_fin_opening_settle_posted"),
    )
    op.execute(
        """
        CREATE TRIGGER trg_fin_contract_append
        BEFORE UPDATE OR DELETE ON finance_contract_values
        FOR EACH ROW EXECUTE FUNCTION finance_append_only_guard();

        CREATE TRIGGER trg_fin_ctc_append
        BEFORE UPDATE OR DELETE ON finance_cost_to_complete
        FOR EACH ROW EXECUTE FUNCTION finance_append_only_guard();

        CREATE FUNCTION finance_opening_settlement_guard()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            opening finance_opening_balances%ROWTYPE;
            settled numeric(18, 4);
        BEGIN
            IF TG_OP = 'DELETE' AND OLD.status = 'posted' THEN
                RAISE EXCEPTION 'posted finance record cannot be deleted';
            END IF;
            IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
                RAISE EXCEPTION 'finance records must be inserted as drafts';
            END IF;
            IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
                RAISE EXCEPTION 'posted finance record is immutable';
            END IF;
            IF TG_OP = 'UPDATE' AND NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
                SELECT * INTO opening FROM finance_opening_balances WHERE id = NEW.opening_balance_id FOR UPDATE;
                IF NOT FOUND OR opening.company_id IS DISTINCT FROM NEW.company_id THEN
                    RAISE EXCEPTION 'opening settlement must stay in its company';
                END IF;
                IF opening.review_status IS DISTINCT FROM 'reviewed' THEN
                    RAISE EXCEPTION 'only a reviewed opening balance can be settled';
                END IF;
                IF opening.balance_kind NOT IN ('supplier_payable', 'customer_receivable', 'retention', 'payroll_liability', 'loan') THEN
                    RAISE EXCEPTION 'this opening balance kind is not settled by cash';
                END IF;
                SELECT COALESCE(SUM(settlement.amount), 0) INTO settled
                FROM finance_opening_settlements settlement
                WHERE settlement.opening_balance_id = opening.id
                  AND settlement.status = 'posted'
                  AND settlement.id <> NEW.id;
                IF settled + NEW.amount > opening.amount THEN
                    RAISE EXCEPTION 'opening settlement exceeds the opening balance';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$;

        CREATE TRIGGER trg_fin_opening_settlement
        BEFORE INSERT OR UPDATE OR DELETE ON finance_opening_settlements
        FOR EACH ROW EXECUTE FUNCTION finance_opening_settlement_guard();
        """
    )


def downgrade() -> None:
    raise RuntimeError("Finance history is not downgraded automatically.")
