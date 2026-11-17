"""Finance D2 cost register tables.

Revision ID: f2a3b4c5d6e7
Revises: f8a9b0c1d2e3
Create Date: 2026-10-08 20:45:00.000000

Creates finance_* tables only. Does not alter existing TimIQ tables.
Cross-row totals are deferred triggers, not CHECK constraints.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, Sequence[str], None] = "f8a9b0c1d2e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = sa.Numeric(18, 4)

FINANCE_D2_FUNCTION_SQL = """
CREATE FUNCTION finance_cost_document_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
        RAISE EXCEPTION 'finance documents must be inserted as drafts';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted finance document is immutable';
    END IF;
    IF TG_OP = 'DELETE' AND OLD.status = 'posted' THEN
        RAISE EXCEPTION 'posted finance document cannot be deleted';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION finance_cost_document_posted_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    src finance_cost_documents%ROWTYPE;
    prior_net numeric(18, 4);
    prior_tax numeric(18, 4);
    prior_recoverable numeric(18, 4);
    prior_non_recoverable numeric(18, 4);
    prior_eligible numeric(18, 4);
    prior_gross numeric(18, 4);
    credit_is_historical boolean;
BEGIN
    IF NEW.status IS DISTINCT FROM 'posted' THEN
        RETURN NEW;
    END IF;
    IF NEW.counterparty_id IS NULL
        OR NEW.service_date IS NULL
        OR NEW.document_date IS NULL
        OR NEW.tax_point_date IS NULL
    THEN
        RAISE EXCEPTION 'posted finance document is incomplete';
    END IF;
    IF NEW.currency_code <> 'GBP' OR NEW.tax_notional_amount <> 0 THEN
        RAISE EXCEPTION 'posted finance document must be GBP with no notional tax';
    END IF;
    IF (SELECT COUNT(*) FROM finance_cost_lines WHERE document_id = NEW.id) < 1 THEN
        RAISE EXCEPTION 'posted finance document requires a line';
    END IF;
    IF EXISTS (
        SELECT 1 FROM finance_cost_lines
        WHERE document_id = NEW.id
          AND (
            tax_treatment IS NULL
            OR tax_treatment NOT IN ('standard', 'reduced', 'zero', 'exempt', 'outside_scope')
          )
    ) THEN
        RAISE EXCEPTION 'posted finance line requires an allowed tax treatment';
    END IF;
    IF EXISTS (
        SELECT 1 FROM finance_cost_lines line
        WHERE line.document_id = NEW.id
          AND NOT EXISTS (
            SELECT 1 FROM finance_cost_allocations allocation
            WHERE allocation.line_id = line.id
          )
    ) THEN
        RAISE EXCEPTION 'posted finance line requires an allocation';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM finance_cost_allocations allocation
        JOIN finance_cost_lines line ON line.id = allocation.line_id
        WHERE line.document_id = NEW.id
          AND (
            allocation.cost_code_id IS NULL
            OR (allocation.is_overhead AND allocation.project_id IS NOT NULL)
            OR (NOT allocation.is_overhead AND allocation.project_id IS NULL)
          )
    ) THEN
        RAISE EXCEPTION 'posted allocation must name a cost code and either a project or overhead';
    END IF;
    IF EXISTS (
        SELECT 1 FROM finance_cost_lines line
        WHERE line.document_id = NEW.id
          AND (
            line.net_amount IS DISTINCT FROM (
                SELECT COALESCE(SUM(amount_net), 0)
                FROM finance_cost_allocations
                WHERE line_id = line.id
            )
            OR line.non_recoverable_amount IS DISTINCT FROM (
                SELECT COALESCE(SUM(amount_non_recoverable), 0)
                FROM finance_cost_allocations
                WHERE line_id = line.id
            )
            OR line.eligible_amount IS DISTINCT FROM (
                SELECT COALESCE(SUM(amount_eligible), 0)
                FROM finance_cost_allocations
                WHERE line_id = line.id
            )
          )
    ) THEN
        RAISE EXCEPTION 'allocations do not reconcile to the cost line';
    END IF;
    IF NEW.net_amount IS DISTINCT FROM (
            SELECT COALESCE(SUM(net_amount), 0) FROM finance_cost_lines WHERE document_id = NEW.id
        )
        OR NEW.tax_amount IS DISTINCT FROM (
            SELECT COALESCE(SUM(tax_amount), 0) FROM finance_cost_lines WHERE document_id = NEW.id
        )
        OR NEW.recoverable_amount IS DISTINCT FROM (
            SELECT COALESCE(SUM(recoverable_amount), 0) FROM finance_cost_lines WHERE document_id = NEW.id
        )
        OR NEW.non_recoverable_amount IS DISTINCT FROM (
            SELECT COALESCE(SUM(non_recoverable_amount), 0) FROM finance_cost_lines WHERE document_id = NEW.id
        )
        OR NEW.eligible_amount IS DISTINCT FROM (
            SELECT COALESCE(SUM(eligible_amount), 0) FROM finance_cost_lines WHERE document_id = NEW.id
        )
    THEN
        RAISE EXCEPTION 'lines do not reconcile to the finance document';
    END IF;
    IF NEW.document_type IN ('supplier_invoice', 'supplier_credit')
        AND (NEW.normalized_reference IS NULL OR btrim(NEW.normalized_reference) = '')
    THEN
        RAISE EXCEPTION 'posted supplier document requires a normalised reference';
    END IF;
    IF NEW.document_type IN ('supplier_invoice', 'expense_receipt', 'direct_cash', 'accrual')
        AND (NEW.net_amount < 0 OR NEW.tax_amount < 0 OR NEW.gross_amount <= 0)
    THEN
        RAISE EXCEPTION 'posted positive cost document must be positive';
    END IF;
    IF NEW.document_type IN ('supplier_invoice', 'expense_receipt', 'direct_cash', 'accrual')
        AND (
            EXISTS (
                SELECT 1 FROM finance_cost_lines
                WHERE document_id = NEW.id
                  AND (
                    net_amount < 0 OR tax_amount < 0 OR recoverable_amount < 0
                    OR non_recoverable_amount < 0 OR eligible_amount < 0
                  )
            )
            OR EXISTS (
                SELECT 1
                FROM finance_cost_allocations allocation
                JOIN finance_cost_lines line ON line.id = allocation.line_id
                WHERE line.document_id = NEW.id
                  AND (
                    allocation.amount_net < 0
                    OR allocation.amount_non_recoverable < 0
                    OR allocation.amount_eligible < 0
                  )
            )
        )
    THEN
        RAISE EXCEPTION 'posted positive cost document cannot contain negative lines or allocations';
    END IF;
    IF NEW.document_type = 'supplier_credit' THEN
        IF NEW.net_amount > 0 OR NEW.tax_amount > 0 OR NEW.gross_amount >= 0 OR NEW.credited_document_id IS NULL THEN
            RAISE EXCEPTION 'posted supplier credit must be a negative document with a source';
        END IF;
        IF EXISTS (
            SELECT 1 FROM finance_cost_lines
            WHERE document_id = NEW.id
              AND (
                net_amount > 0 OR tax_amount > 0 OR recoverable_amount > 0
                OR non_recoverable_amount > 0 OR eligible_amount > 0
              )
        ) OR EXISTS (
            SELECT 1
            FROM finance_cost_allocations allocation
            JOIN finance_cost_lines line ON line.id = allocation.line_id
            WHERE line.document_id = NEW.id
              AND (
                allocation.amount_net > 0
                OR allocation.amount_non_recoverable > 0
                OR allocation.amount_eligible > 0
              )
        ) THEN
            RAISE EXCEPTION 'posted supplier credit cannot contain positive lines or allocations';
        END IF;
        SELECT * INTO src
        FROM finance_cost_documents
        WHERE id = NEW.credited_document_id
        FOR UPDATE;
        IF NOT FOUND OR src.status <> 'posted' THEN
            RAISE EXCEPTION 'supplier credit source must be a posted document';
        END IF;
        IF src.document_type NOT IN ('supplier_invoice', 'expense_receipt', 'direct_cash', 'accrual') THEN
            RAISE EXCEPTION 'supplier credit source must be a posted cost document';
        END IF;
        IF src.company_id <> NEW.company_id OR src.counterparty_id IS DISTINCT FROM NEW.counterparty_id THEN
            RAISE EXCEPTION 'supplier credit must keep the source company and counterparty';
        END IF;
        PERFORM 1
        FROM finance_cost_documents credit
        WHERE credit.credited_document_id = src.id
          AND credit.document_type = 'supplier_credit'
          AND credit.id <> NEW.id
        ORDER BY credit.id
        FOR UPDATE;
        PERFORM 1
        FROM finance_cost_documents reversal_row
        WHERE reversal_row.document_type = 'reversal'
          AND reversal_row.status = 'posted'
          AND reversal_row.reverses_document_id IN (src.id, NEW.id)
        ORDER BY reversal_row.id
        FOR UPDATE;
        credit_is_historical := EXISTS (
            SELECT 1 FROM finance_cost_documents credit_reversal
            WHERE credit_reversal.reverses_document_id = NEW.id
              AND credit_reversal.document_type = 'reversal'
              AND credit_reversal.status = 'posted'
        );
        IF NOT credit_is_historical AND EXISTS (
            SELECT 1 FROM finance_cost_documents
            WHERE reverses_document_id = src.id
              AND document_type = 'reversal'
              AND status = 'posted'
        ) THEN
            RAISE EXCEPTION 'cannot credit a reversed document';
        END IF;
        SELECT
            COALESCE(SUM(credit.net_amount), 0),
            COALESCE(SUM(credit.tax_amount), 0),
            COALESCE(SUM(credit.recoverable_amount), 0),
            COALESCE(SUM(credit.non_recoverable_amount), 0),
            COALESCE(SUM(credit.eligible_amount), 0),
            COALESCE(SUM(credit.gross_amount), 0)
        INTO prior_net, prior_tax, prior_recoverable, prior_non_recoverable, prior_eligible, prior_gross
        FROM finance_cost_documents credit
        WHERE credit.credited_document_id = src.id
          AND credit.document_type = 'supplier_credit'
          AND credit.status = 'posted'
          AND credit.id <> NEW.id
          AND NOT EXISTS (
              SELECT 1 FROM finance_cost_documents credit_reversal
              WHERE credit_reversal.reverses_document_id = credit.id
                AND credit_reversal.document_type = 'reversal'
                AND credit_reversal.status = 'posted'
          );
        IF NOT credit_is_historical AND (
            src.net_amount + prior_net + NEW.net_amount < 0
            OR src.tax_amount + prior_tax + NEW.tax_amount < 0
            OR src.recoverable_amount + prior_recoverable + NEW.recoverable_amount < 0
            OR src.non_recoverable_amount + prior_non_recoverable + NEW.non_recoverable_amount < 0
            OR src.eligible_amount + prior_eligible + NEW.eligible_amount < 0
            OR src.gross_amount + prior_gross + NEW.gross_amount < 0
        ) THEN
            RAISE EXCEPTION 'supplier credits exceed the source eligible amount';
        END IF;
        IF NOT credit_is_historical AND EXISTS (
            SELECT 1
            FROM (
                SELECT
                    allocation.project_id,
                    allocation.cost_code_id,
                    allocation.is_overhead,
                    SUM(allocation.amount_net) AS amount_net,
                    SUM(allocation.amount_non_recoverable) AS amount_non_recoverable,
                    SUM(allocation.amount_eligible) AS amount_eligible
                FROM finance_cost_allocations allocation
                JOIN finance_cost_lines line ON line.id = allocation.line_id
                WHERE line.document_id = NEW.id
                GROUP BY allocation.project_id, allocation.cost_code_id, allocation.is_overhead
            ) credit_group
            WHERE (
                SELECT COALESCE(SUM(source_allocation.amount_net), 0)
                FROM finance_cost_allocations source_allocation
                JOIN finance_cost_lines source_line ON source_line.id = source_allocation.line_id
                WHERE source_line.document_id = src.id
                  AND source_allocation.project_id IS NOT DISTINCT FROM credit_group.project_id
                  AND source_allocation.cost_code_id IS NOT DISTINCT FROM credit_group.cost_code_id
                  AND source_allocation.is_overhead IS NOT DISTINCT FROM credit_group.is_overhead
            ) + (
                SELECT COALESCE(SUM(prior_allocation.amount_net), 0)
                FROM finance_cost_documents prior_credit
                JOIN finance_cost_lines prior_line ON prior_line.document_id = prior_credit.id
                JOIN finance_cost_allocations prior_allocation ON prior_allocation.line_id = prior_line.id
                WHERE prior_credit.credited_document_id = src.id
                  AND prior_credit.document_type = 'supplier_credit'
                  AND prior_credit.status = 'posted'
                  AND prior_credit.id <> NEW.id
                  AND prior_allocation.project_id IS NOT DISTINCT FROM credit_group.project_id
                  AND prior_allocation.cost_code_id IS NOT DISTINCT FROM credit_group.cost_code_id
                  AND prior_allocation.is_overhead IS NOT DISTINCT FROM credit_group.is_overhead
                  AND NOT EXISTS (
                      SELECT 1 FROM finance_cost_documents credit_reversal
                      WHERE credit_reversal.reverses_document_id = prior_credit.id
                        AND credit_reversal.document_type = 'reversal'
                        AND credit_reversal.status = 'posted'
                  )
            ) + credit_group.amount_net < 0
            OR (
                SELECT COALESCE(SUM(source_allocation.amount_non_recoverable), 0)
                FROM finance_cost_allocations source_allocation
                JOIN finance_cost_lines source_line ON source_line.id = source_allocation.line_id
                WHERE source_line.document_id = src.id
                  AND source_allocation.project_id IS NOT DISTINCT FROM credit_group.project_id
                  AND source_allocation.cost_code_id IS NOT DISTINCT FROM credit_group.cost_code_id
                  AND source_allocation.is_overhead IS NOT DISTINCT FROM credit_group.is_overhead
            ) + (
                SELECT COALESCE(SUM(prior_allocation.amount_non_recoverable), 0)
                FROM finance_cost_documents prior_credit
                JOIN finance_cost_lines prior_line ON prior_line.document_id = prior_credit.id
                JOIN finance_cost_allocations prior_allocation ON prior_allocation.line_id = prior_line.id
                WHERE prior_credit.credited_document_id = src.id
                  AND prior_credit.document_type = 'supplier_credit'
                  AND prior_credit.status = 'posted'
                  AND prior_credit.id <> NEW.id
                  AND prior_allocation.project_id IS NOT DISTINCT FROM credit_group.project_id
                  AND prior_allocation.cost_code_id IS NOT DISTINCT FROM credit_group.cost_code_id
                  AND prior_allocation.is_overhead IS NOT DISTINCT FROM credit_group.is_overhead
                  AND NOT EXISTS (
                      SELECT 1 FROM finance_cost_documents credit_reversal
                      WHERE credit_reversal.reverses_document_id = prior_credit.id
                        AND credit_reversal.document_type = 'reversal'
                        AND credit_reversal.status = 'posted'
                  )
            ) + credit_group.amount_non_recoverable < 0
            OR (
                SELECT COALESCE(SUM(source_allocation.amount_eligible), 0)
                FROM finance_cost_allocations source_allocation
                JOIN finance_cost_lines source_line ON source_line.id = source_allocation.line_id
                WHERE source_line.document_id = src.id
                  AND source_allocation.project_id IS NOT DISTINCT FROM credit_group.project_id
                  AND source_allocation.cost_code_id IS NOT DISTINCT FROM credit_group.cost_code_id
                  AND source_allocation.is_overhead IS NOT DISTINCT FROM credit_group.is_overhead
            ) + (
                SELECT COALESCE(SUM(prior_allocation.amount_eligible), 0)
                FROM finance_cost_documents prior_credit
                JOIN finance_cost_lines prior_line ON prior_line.document_id = prior_credit.id
                JOIN finance_cost_allocations prior_allocation ON prior_allocation.line_id = prior_line.id
                WHERE prior_credit.credited_document_id = src.id
                  AND prior_credit.document_type = 'supplier_credit'
                  AND prior_credit.status = 'posted'
                  AND prior_credit.id <> NEW.id
                  AND prior_allocation.project_id IS NOT DISTINCT FROM credit_group.project_id
                  AND prior_allocation.cost_code_id IS NOT DISTINCT FROM credit_group.cost_code_id
                  AND prior_allocation.is_overhead IS NOT DISTINCT FROM credit_group.is_overhead
                  AND NOT EXISTS (
                      SELECT 1 FROM finance_cost_documents credit_reversal
                      WHERE credit_reversal.reverses_document_id = prior_credit.id
                        AND credit_reversal.document_type = 'reversal'
                        AND credit_reversal.status = 'posted'
                  )
            ) + credit_group.amount_eligible < 0
        ) THEN
            RAISE EXCEPTION 'supplier credit allocations exceed the source project amounts';
        END IF;
    END IF;
    IF NEW.document_type = 'reversal' THEN
        IF NEW.reverses_document_id IS NULL THEN
            RAISE EXCEPTION 'reversal requires a source document';
        END IF;
        SELECT * INTO src
        FROM finance_cost_documents
        WHERE id = NEW.reverses_document_id
        FOR UPDATE;
        IF NOT FOUND OR src.status <> 'posted' THEN
            RAISE EXCEPTION 'reversal source must be a posted document';
        END IF;
        IF src.document_type = 'reversal' OR src.reverses_document_id IS NOT NULL THEN
            RAISE EXCEPTION 'a reversal cannot be reversed';
        END IF;
        PERFORM 1
        FROM finance_cost_documents credit
        WHERE credit.credited_document_id = src.id
          AND credit.document_type = 'supplier_credit'
        ORDER BY credit.id
        FOR UPDATE;
        IF EXISTS (
            SELECT 1 FROM finance_cost_documents credit
            WHERE credit.credited_document_id = src.id
              AND credit.document_type = 'supplier_credit'
              AND credit.status = 'posted'
              AND NOT EXISTS (
                  SELECT 1 FROM finance_cost_documents credit_reversal
                  WHERE credit_reversal.reverses_document_id = credit.id
                    AND credit_reversal.document_type = 'reversal'
                    AND credit_reversal.status = 'posted'
              )
        ) THEN
            RAISE EXCEPTION 'cannot reverse a document that has posted credits';
        END IF;
        IF src.company_id <> NEW.company_id OR src.counterparty_id IS DISTINCT FROM NEW.counterparty_id THEN
            RAISE EXCEPTION 'reversal must keep the source company and counterparty';
        END IF;
        IF NEW.net_amount <> -src.net_amount
            OR NEW.tax_amount <> -src.tax_amount
            OR NEW.recoverable_amount <> -src.recoverable_amount
            OR NEW.non_recoverable_amount <> -src.non_recoverable_amount
            OR NEW.eligible_amount <> -src.eligible_amount
            OR NEW.gross_amount <> -src.gross_amount
        THEN
            RAISE EXCEPTION 'reversal does not negate its source document';
        END IF;
        IF EXISTS (
            SELECT 1 FROM finance_cost_lines source_line
            WHERE source_line.document_id = src.id
              AND NOT EXISTS (
                SELECT 1 FROM finance_cost_lines reversal_line
                WHERE reversal_line.document_id = NEW.id
                  AND reversal_line.line_number = source_line.line_number
                  AND reversal_line.net_amount = -source_line.net_amount
                  AND reversal_line.tax_amount = -source_line.tax_amount
                  AND reversal_line.recoverable_amount = -source_line.recoverable_amount
                  AND reversal_line.non_recoverable_amount = -source_line.non_recoverable_amount
                  AND reversal_line.eligible_amount = -source_line.eligible_amount
                  AND reversal_line.tax_treatment IS NOT DISTINCT FROM source_line.tax_treatment
              )
        ) OR EXISTS (
            SELECT 1 FROM finance_cost_lines reversal_line
            WHERE reversal_line.document_id = NEW.id
              AND NOT EXISTS (
                SELECT 1 FROM finance_cost_lines source_line
                WHERE source_line.document_id = src.id
                  AND source_line.line_number = reversal_line.line_number
              )
        ) THEN
            RAISE EXCEPTION 'reversal lines do not negate source lines';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM finance_cost_lines source_line
            JOIN finance_cost_allocations source_allocation ON source_allocation.line_id = source_line.id
            WHERE source_line.document_id = src.id
              AND NOT EXISTS (
                SELECT 1
                FROM finance_cost_lines reversal_line
                JOIN finance_cost_allocations reversal_allocation
                  ON reversal_allocation.line_id = reversal_line.id
                WHERE reversal_line.document_id = NEW.id
                  AND reversal_line.line_number = source_line.line_number
                  AND reversal_allocation.allocation_number = source_allocation.allocation_number
                  AND reversal_allocation.amount_net = -source_allocation.amount_net
                  AND reversal_allocation.amount_non_recoverable = -source_allocation.amount_non_recoverable
                  AND reversal_allocation.amount_eligible = -source_allocation.amount_eligible
                  AND reversal_allocation.is_overhead IS NOT DISTINCT FROM source_allocation.is_overhead
                  AND reversal_allocation.project_id IS NOT DISTINCT FROM source_allocation.project_id
                  AND reversal_allocation.cost_code_id IS NOT DISTINCT FROM source_allocation.cost_code_id
              )
        ) OR (
            (SELECT COUNT(*) FROM finance_cost_allocations allocation
             JOIN finance_cost_lines line ON line.id = allocation.line_id
             WHERE line.document_id = NEW.id)
            <>
            (SELECT COUNT(*) FROM finance_cost_allocations allocation
             JOIN finance_cost_lines line ON line.id = allocation.line_id
             WHERE line.document_id = src.id)
        ) THEN
            RAISE EXCEPTION 'reversal allocations do not negate source allocations';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION finance_reject_posted_cost_documents(first_id uuid, second_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    parent_status text;
    ordered_ids uuid[];
    doc_id uuid;
BEGIN
    IF first_id IS NULL AND second_id IS NULL THEN
        RAISE EXCEPTION 'finance cost child is missing its parent';
    END IF;
    IF first_id IS NOT NULL AND second_id IS NOT NULL AND first_id <> second_id THEN
        IF first_id < second_id THEN
            ordered_ids := ARRAY[first_id, second_id];
        ELSE
            ordered_ids := ARRAY[second_id, first_id];
        END IF;
    ELSIF first_id IS NOT NULL THEN
        ordered_ids := ARRAY[first_id];
    ELSE
        ordered_ids := ARRAY[second_id];
    END IF;
    FOREACH doc_id IN ARRAY ordered_ids LOOP
        SELECT status INTO parent_status
        FROM finance_cost_documents
        WHERE id = doc_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'finance cost document parent was not found';
        END IF;
        IF parent_status = 'posted' THEN
            RAISE EXCEPTION 'posted finance document children are immutable';
        END IF;
    END LOOP;
END;
$$;

CREATE FUNCTION finance_cost_child_posted_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    old_document_id uuid;
    new_document_id uuid;
    old_line_id uuid;
    new_line_id uuid;
    locked_line_id uuid;
    reread_document_id uuid;
    line_ids uuid[];
BEGIN
    IF TG_TABLE_NAME = 'finance_cost_lines' THEN
        old_document_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.document_id END;
        new_document_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.document_id END;
        PERFORM finance_reject_posted_cost_documents(old_document_id, new_document_id);
    ELSE
        old_line_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.line_id END;
        new_line_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.line_id END;
        IF old_line_id IS NOT NULL THEN
            SELECT document_id INTO old_document_id FROM finance_cost_lines WHERE id = old_line_id;
        END IF;
        IF new_line_id IS NOT NULL THEN
            SELECT document_id INTO new_document_id FROM finance_cost_lines WHERE id = new_line_id;
        END IF;
        PERFORM finance_reject_posted_cost_documents(old_document_id, new_document_id);
        IF old_line_id IS NOT NULL AND new_line_id IS NOT NULL AND old_line_id <> new_line_id THEN
            IF old_line_id < new_line_id THEN
                line_ids := ARRAY[old_line_id, new_line_id];
            ELSE
                line_ids := ARRAY[new_line_id, old_line_id];
            END IF;
        ELSIF old_line_id IS NOT NULL THEN
            line_ids := ARRAY[old_line_id];
        ELSE
            line_ids := ARRAY[new_line_id];
        END IF;
        FOREACH locked_line_id IN ARRAY line_ids LOOP
            PERFORM 1 FROM finance_cost_lines WHERE id = locked_line_id FOR UPDATE;
            SELECT document_id INTO reread_document_id FROM finance_cost_lines WHERE id = locked_line_id;
            IF reread_document_id IS DISTINCT FROM old_document_id
                AND reread_document_id IS DISTINCT FROM new_document_id
            THEN
                RAISE EXCEPTION 'finance cost line parent changed concurrently';
            END IF;
        END LOOP;
        IF TG_OP <> 'INSERT' THEN
            SELECT document_id INTO reread_document_id FROM finance_cost_lines WHERE id = OLD.line_id;
            IF reread_document_id IS DISTINCT FROM old_document_id THEN
                PERFORM finance_reject_posted_cost_documents(reread_document_id, NULL);
            END IF;
        END IF;
        IF TG_OP = 'UPDATE' AND NEW.line_id IS DISTINCT FROM OLD.line_id THEN
            SELECT document_id INTO reread_document_id FROM finance_cost_lines WHERE id = NEW.line_id;
            IF reread_document_id IS DISTINCT FROM new_document_id THEN
                PERFORM finance_reject_posted_cost_documents(reread_document_id, NULL);
            END IF;
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION finance_budget_version_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status IS DISTINCT FROM 'draft' THEN
            RAISE EXCEPTION 'budget versions must be inserted as drafts';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'only a draft budget version can be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status IN ('approved', 'superseded') THEN
        IF NEW.project_id IS DISTINCT FROM OLD.project_id
            OR NEW.company_id IS DISTINCT FROM OLD.company_id
            OR NEW.version_number IS DISTINCT FROM OLD.version_number
            OR NEW.note IS DISTINCT FROM OLD.note
            OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
            OR NEW.approved_by_user_id IS DISTINCT FROM OLD.approved_by_user_id
        THEN
            RAISE EXCEPTION 'approved budget version is immutable';
        END IF;
        IF OLD.status = 'superseded' AND NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'superseded budget version cannot change status';
        END IF;
        IF OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'superseded') THEN
            RAISE EXCEPTION 'approved budget version can only become superseded';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'approved' THEN
        PERFORM 1 FROM finance_budget_lines WHERE version_id = NEW.id ORDER BY id FOR UPDATE;
        IF (SELECT COUNT(*) FROM finance_budget_lines WHERE version_id = NEW.id) < 1 THEN
            RAISE EXCEPTION 'approved budget requires a line';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'approved') THEN
        RAISE EXCEPTION 'invalid budget version transition';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION finance_budget_line_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    old_version_id uuid;
    new_version_id uuid;
    ordered_ids uuid[];
    version_id uuid;
    parent_status text;
BEGIN
    old_version_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.version_id END;
    new_version_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.version_id END;
    IF old_version_id IS NOT NULL AND new_version_id IS NOT NULL AND old_version_id <> new_version_id THEN
        IF old_version_id < new_version_id THEN
            ordered_ids := ARRAY[old_version_id, new_version_id];
        ELSE
            ordered_ids := ARRAY[new_version_id, old_version_id];
        END IF;
    ELSIF old_version_id IS NOT NULL THEN
        ordered_ids := ARRAY[old_version_id];
    ELSE
        ordered_ids := ARRAY[new_version_id];
    END IF;
    FOREACH version_id IN ARRAY ordered_ids LOOP
        SELECT status INTO parent_status
        FROM finance_budget_versions
        WHERE id = version_id
        FOR UPDATE;
        IF NOT FOUND OR parent_status IS DISTINCT FROM 'draft' THEN
            RAISE EXCEPTION 'approved budget lines are immutable';
        END IF;
    END LOOP;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION finance_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'finance history rows are append-only';
END;
$$;
"""

FINANCE_D2_TRIGGER_SQL = """
CREATE TRIGGER trg_finance_cost_documents_before_write
    BEFORE INSERT OR UPDATE OR DELETE ON finance_cost_documents
    FOR EACH ROW EXECUTE FUNCTION finance_cost_document_before_write();

CREATE CONSTRAINT TRIGGER trg_finance_cost_documents_posted_balance
    AFTER INSERT OR UPDATE ON finance_cost_documents
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION finance_cost_document_posted_balance();

CREATE TRIGGER trg_finance_cost_lines_posted_parent
    BEFORE INSERT OR UPDATE OR DELETE ON finance_cost_lines
    FOR EACH ROW EXECUTE FUNCTION finance_cost_child_posted_guard();

CREATE TRIGGER trg_finance_cost_allocations_posted_parent
    BEFORE INSERT OR UPDATE OR DELETE ON finance_cost_allocations
    FOR EACH ROW EXECUTE FUNCTION finance_cost_child_posted_guard();

CREATE TRIGGER trg_finance_budget_versions_guard
    BEFORE INSERT OR UPDATE OR DELETE ON finance_budget_versions
    FOR EACH ROW EXECUTE FUNCTION finance_budget_version_guard();

CREATE TRIGGER trg_finance_budget_lines_guard
    BEFORE INSERT OR UPDATE OR DELETE ON finance_budget_lines
    FOR EACH ROW EXECUTE FUNCTION finance_budget_line_guard();

CREATE TRIGGER trg_finance_audit_events_append_only
    BEFORE UPDATE OR DELETE ON finance_audit_events
    FOR EACH ROW EXECUTE FUNCTION finance_append_only_guard();

CREATE TRIGGER trg_finance_duplicate_exceptions_append_only
    BEFORE UPDATE OR DELETE ON finance_duplicate_exceptions
    FOR EACH ROW EXECUTE FUNCTION finance_append_only_guard();
"""

FINANCE_D2_TRIGGER_DROP_SQL = """
DROP TRIGGER IF EXISTS trg_finance_duplicate_exceptions_append_only ON finance_duplicate_exceptions;
DROP TRIGGER IF EXISTS trg_finance_audit_events_append_only ON finance_audit_events;
DROP TRIGGER IF EXISTS trg_finance_budget_lines_guard ON finance_budget_lines;
DROP TRIGGER IF EXISTS trg_finance_budget_versions_guard ON finance_budget_versions;
DROP TRIGGER IF EXISTS trg_finance_cost_allocations_posted_parent ON finance_cost_allocations;
DROP TRIGGER IF EXISTS trg_finance_cost_lines_posted_parent ON finance_cost_lines;
DROP TRIGGER IF EXISTS trg_finance_cost_documents_posted_balance ON finance_cost_documents;
DROP TRIGGER IF EXISTS trg_finance_cost_documents_before_write ON finance_cost_documents;
DROP FUNCTION IF EXISTS finance_append_only_guard();
DROP FUNCTION IF EXISTS finance_budget_line_guard();
DROP FUNCTION IF EXISTS finance_budget_version_guard();
DROP FUNCTION IF EXISTS finance_cost_child_posted_guard();
DROP FUNCTION IF EXISTS finance_reject_posted_cost_documents(uuid, uuid);
DROP FUNCTION IF EXISTS finance_cost_document_posted_balance();
DROP FUNCTION IF EXISTS finance_cost_document_before_write();
"""


def _uuid() -> postgresql.UUID:
    return postgresql.UUID(as_uuid=True)


def _company_id() -> sa.Column:
    return sa.Column(
        "company_id",
        _uuid(),
        sa.ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
    )


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    ]


def upgrade() -> None:
    op.create_table(
        "finance_projects",
        sa.Column("id", _uuid(), primary_key=True),
        _company_id(),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("reference_code", sa.String(120), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", _uuid(), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("company_id", "id", name="uq_finance_projects_company_id"),
        sa.CheckConstraint("status IN ('draft', 'active', 'closed')", name="ck_finance_projects_status"),
    )
    op.create_index(
        "uq_finance_projects_company_reference",
        "finance_projects",
        ["company_id", "reference_code"],
        unique=True,
        postgresql_where=sa.text("reference_code IS NOT NULL"),
    )
    op.create_index("ix_finance_projects_company_id", "finance_projects", ["company_id"])

    op.create_table(
        "finance_cost_codes",
        sa.Column("id", _uuid(), primary_key=True),
        _company_id(),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_timestamps(),
        sa.UniqueConstraint("company_id", "id", name="uq_finance_cost_codes_company_id"),
        sa.UniqueConstraint("company_id", "code", name="uq_finance_cost_codes_company_code"),
    )
    op.create_index("ix_finance_cost_codes_company_id", "finance_cost_codes", ["company_id"])

    op.create_table(
        "finance_counterparties",
        sa.Column("id", _uuid(), primary_key=True),
        _company_id(),
        sa.Column("counterparty_type", sa.String(16), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("normalized_name", sa.String(200), nullable=False),
        sa.Column("user_id", _uuid(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_timestamps(),
        sa.UniqueConstraint("company_id", "id", name="uq_finance_counterparties_company_id"),
        sa.UniqueConstraint(
            "company_id",
            "counterparty_type",
            "normalized_name",
            name="uq_finance_counterparties_company_name",
        ),
        sa.CheckConstraint(
            "counterparty_type IN ('supplier', 'customer', 'lender', 'worker', 'director')",
            name="ck_finance_counterparties_type",
        ),
    )
    op.create_index("ix_finance_counterparties_company_id", "finance_counterparties", ["company_id"])

    op.create_table(
        "finance_budget_versions",
        sa.Column("id", _uuid(), primary_key=True),
        _company_id(),
        sa.Column("project_id", _uuid(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by_user_id", _uuid(), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("company_id", "id", name="uq_finance_budget_versions_company_id"),
        sa.UniqueConstraint("project_id", "version_number", name="uq_finance_budget_versions_project_number"),
        sa.ForeignKeyConstraint(
            ["company_id", "project_id"],
            ["finance_projects.company_id", "finance_projects.id"],
            name="fk_finance_budget_versions_project",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'approved', 'superseded')",
            name="ck_finance_budget_versions_status",
        ),
        sa.CheckConstraint("version_number >= 1", name="ck_finance_budget_versions_number"),
    )
    op.create_index(
        "uq_finance_budget_versions_one_approved",
        "finance_budget_versions",
        ["project_id"],
        unique=True,
        postgresql_where=sa.text("status = 'approved'"),
    )
    op.create_index("ix_finance_budget_versions_company_id", "finance_budget_versions", ["company_id"])
    op.create_index("ix_finance_budget_versions_project_id", "finance_budget_versions", ["project_id"])

    op.create_table(
        "finance_budget_lines",
        sa.Column("id", _uuid(), primary_key=True),
        _company_id(),
        sa.Column("version_id", _uuid(), nullable=False),
        sa.Column("line_number", sa.Integer(), nullable=False),
        sa.Column("item_reference", sa.String(120), nullable=True),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("cost_code_id", _uuid(), nullable=False),
        sa.Column("amount_net", MONEY, nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("company_id", "id", name="uq_finance_budget_lines_company_id"),
        sa.UniqueConstraint("version_id", "line_number", name="uq_finance_budget_lines_version_number"),
        sa.ForeignKeyConstraint(
            ["company_id", "version_id"],
            ["finance_budget_versions.company_id", "finance_budget_versions.id"],
            name="fk_finance_budget_lines_version",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "cost_code_id"],
            ["finance_cost_codes.company_id", "finance_cost_codes.id"],
            name="fk_finance_budget_lines_cost_code",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("line_number >= 1", name="ck_finance_budget_lines_number"),
        sa.CheckConstraint("amount_net >= 0", name="ck_finance_budget_lines_amount"),
    )
    op.create_index(
        "ix_finance_budget_lines_version_cost_code",
        "finance_budget_lines",
        ["version_id", "cost_code_id"],
    )
    op.create_index("ix_finance_budget_lines_company_id", "finance_budget_lines", ["company_id"])
    op.create_index("ix_finance_budget_lines_version_id", "finance_budget_lines", ["version_id"])
    op.create_index("ix_finance_budget_lines_cost_code_id", "finance_budget_lines", ["cost_code_id"])

    op.create_table(
        "finance_cost_documents",
        sa.Column("id", _uuid(), primary_key=True),
        _company_id(),
        sa.Column("counterparty_id", _uuid(), nullable=True),
        sa.Column("document_type", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("external_reference", sa.String(120), nullable=True),
        sa.Column("normalized_reference", sa.String(120), nullable=True),
        sa.Column("service_date", sa.Date(), nullable=True),
        sa.Column("document_date", sa.Date(), nullable=True),
        sa.Column("tax_point_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("currency_code", sa.String(3), nullable=False, server_default="GBP"),
        sa.Column("net_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("tax_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("recoverable_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("non_recoverable_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("eligible_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("gross_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("tax_notional_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("credited_document_id", _uuid(), nullable=True),
        sa.Column("reverses_document_id", _uuid(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", _uuid(), nullable=True),
        sa.Column("posted_by_user_id", _uuid(), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("company_id", "id", name="uq_finance_cost_documents_company_id"),
        sa.ForeignKeyConstraint(
            ["company_id", "counterparty_id"],
            ["finance_counterparties.company_id", "finance_counterparties.id"],
            name="fk_finance_cost_documents_counterparty",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("status IN ('draft', 'posted')", name="ck_finance_cost_documents_status"),
        sa.CheckConstraint(
            "document_type IN ("
            "'supplier_invoice', 'expense_receipt', 'supplier_credit', 'reversal', 'direct_cash', 'accrual'"
            ")",
            name="ck_finance_cost_documents_type",
        ),
        sa.CheckConstraint("currency_code = 'GBP'", name="ck_finance_cost_documents_gbp"),
        sa.CheckConstraint("tax_notional_amount = 0", name="ck_finance_cost_documents_no_notional"),
        sa.CheckConstraint("gross_amount = net_amount + tax_amount", name="ck_finance_cost_documents_gross"),
        sa.CheckConstraint(
            "non_recoverable_amount = tax_amount - recoverable_amount",
            name="ck_finance_cost_documents_non_recoverable",
        ),
        sa.CheckConstraint(
            "eligible_amount = net_amount + non_recoverable_amount",
            name="ck_finance_cost_documents_eligible",
        ),
        sa.CheckConstraint(
            "status <> 'posted' OR ("
            "counterparty_id IS NOT NULL AND service_date IS NOT NULL "
            "AND document_date IS NOT NULL AND tax_point_date IS NOT NULL"
            ")",
            name="ck_finance_cost_documents_posted_required",
        ),
        sa.CheckConstraint(
            "status <> 'posted' OR ("
            "(tax_amount >= 0 AND recoverable_amount >= 0 AND recoverable_amount <= tax_amount) "
            "OR (tax_amount < 0 AND recoverable_amount <= 0 AND recoverable_amount >= tax_amount)"
            ")",
            name="ck_finance_cost_documents_recoverable_bounds",
        ),
        sa.CheckConstraint(
            "status <> 'posted' OR document_type NOT IN "
            "('supplier_invoice', 'expense_receipt', 'direct_cash', 'accrual') OR "
            "(net_amount >= 0 AND tax_amount >= 0 AND gross_amount > 0)",
            name="ck_finance_cost_documents_posted_positive",
        ),
        sa.CheckConstraint(
            "status <> 'posted' OR document_type <> 'supplier_credit' OR "
            "(net_amount <= 0 AND tax_amount <= 0 AND gross_amount < 0 AND credited_document_id IS NOT NULL)",
            name="ck_finance_cost_documents_posted_credit",
        ),
        sa.CheckConstraint(
            "status <> 'posted' OR document_type <> 'reversal' OR reverses_document_id IS NOT NULL",
            name="ck_finance_cost_documents_posted_reversal_link",
        ),
        sa.CheckConstraint(
            "status <> 'posted' OR ("
            "(document_type = 'supplier_credit' AND credited_document_id IS NOT NULL "
            "AND reverses_document_id IS NULL) OR "
            "(document_type = 'reversal' AND reverses_document_id IS NOT NULL "
            "AND credited_document_id IS NULL) OR "
            "(document_type NOT IN ('supplier_credit', 'reversal') "
            "AND credited_document_id IS NULL AND reverses_document_id IS NULL)"
            ")",
            name="ck_finance_cost_documents_posted_links",
        ),
    )
    op.create_foreign_key(
        "fk_finance_cost_documents_credited",
        "finance_cost_documents",
        "finance_cost_documents",
        ["company_id", "credited_document_id"],
        ["company_id", "id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_finance_cost_documents_reverses",
        "finance_cost_documents",
        "finance_cost_documents",
        ["company_id", "reverses_document_id"],
        ["company_id", "id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "uq_finance_posted_supplier_invoice_ref",
        "finance_cost_documents",
        ["company_id", "counterparty_id", "normalized_reference"],
        unique=True,
        postgresql_where=sa.text("document_type = 'supplier_invoice' AND status = 'posted'"),
    )
    op.create_index(
        "uq_finance_posted_supplier_credit_ref",
        "finance_cost_documents",
        ["company_id", "counterparty_id", "normalized_reference"],
        unique=True,
        postgresql_where=sa.text("document_type = 'supplier_credit' AND status = 'posted'"),
    )
    op.create_index(
        "uq_finance_posted_reversal_source",
        "finance_cost_documents",
        ["reverses_document_id"],
        unique=True,
        postgresql_where=sa.text(
            "document_type = 'reversal' AND status = 'posted' AND reverses_document_id IS NOT NULL"
        ),
    )
    op.create_index("ix_finance_cost_documents_company_id", "finance_cost_documents", ["company_id"])
    op.create_index("ix_finance_cost_documents_counterparty_id", "finance_cost_documents", ["counterparty_id"])

    op.create_table(
        "finance_cost_lines",
        sa.Column("id", _uuid(), primary_key=True),
        _company_id(),
        sa.Column("document_id", _uuid(), nullable=False),
        sa.Column("line_number", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("net_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("tax_treatment", sa.String(32), nullable=True),
        sa.Column("tax_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("recoverable_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("non_recoverable_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("eligible_amount", MONEY, nullable=False, server_default="0"),
        sa.Column("tax_notional_amount", MONEY, nullable=False, server_default="0"),
        *_timestamps(),
        sa.UniqueConstraint("company_id", "id", name="uq_finance_cost_lines_company_id"),
        sa.UniqueConstraint("document_id", "line_number", name="uq_finance_cost_lines_document_number"),
        sa.ForeignKeyConstraint(
            ["company_id", "document_id"],
            ["finance_cost_documents.company_id", "finance_cost_documents.id"],
            name="fk_finance_cost_lines_document",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("line_number >= 1", name="ck_finance_cost_lines_number"),
        sa.CheckConstraint(
            "tax_treatment IS NULL OR tax_treatment IN "
            "('standard', 'reduced', 'zero', 'exempt', 'outside_scope')",
            name="ck_finance_cost_lines_tax_treatment",
        ),
        sa.CheckConstraint("tax_notional_amount = 0", name="ck_finance_cost_lines_no_notional"),
        sa.CheckConstraint(
            "non_recoverable_amount = tax_amount - recoverable_amount",
            name="ck_finance_cost_lines_non_recoverable",
        ),
        sa.CheckConstraint(
            "eligible_amount = net_amount + non_recoverable_amount",
            name="ck_finance_cost_lines_eligible",
        ),
    )
    op.create_index("ix_finance_cost_lines_company_id", "finance_cost_lines", ["company_id"])
    op.create_index("ix_finance_cost_lines_document_id", "finance_cost_lines", ["document_id"])

    op.create_table(
        "finance_cost_allocations",
        sa.Column("id", _uuid(), primary_key=True),
        _company_id(),
        sa.Column("line_id", _uuid(), nullable=False),
        sa.Column("allocation_number", sa.Integer(), nullable=False),
        sa.Column("project_id", _uuid(), nullable=True),
        sa.Column("cost_code_id", _uuid(), nullable=True),
        sa.Column("is_overhead", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("amount_net", MONEY, nullable=False, server_default="0"),
        sa.Column("amount_non_recoverable", MONEY, nullable=False, server_default="0"),
        sa.Column("amount_eligible", MONEY, nullable=False, server_default="0"),
        *_timestamps(),
        sa.UniqueConstraint("company_id", "id", name="uq_finance_cost_allocations_company_id"),
        sa.UniqueConstraint("line_id", "allocation_number", name="uq_finance_cost_allocations_line_number"),
        sa.ForeignKeyConstraint(
            ["company_id", "line_id"],
            ["finance_cost_lines.company_id", "finance_cost_lines.id"],
            name="fk_finance_cost_allocations_line",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "project_id"],
            ["finance_projects.company_id", "finance_projects.id"],
            name="fk_finance_cost_allocations_project",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "cost_code_id"],
            ["finance_cost_codes.company_id", "finance_cost_codes.id"],
            name="fk_finance_cost_allocations_cost_code",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("allocation_number >= 1", name="ck_finance_cost_allocations_number"),
        sa.CheckConstraint(
            "amount_eligible = amount_net + amount_non_recoverable",
            name="ck_finance_cost_allocations_eligible",
        ),
    )
    op.create_index("ix_finance_cost_allocations_company_id", "finance_cost_allocations", ["company_id"])
    op.create_index("ix_finance_cost_allocations_line_id", "finance_cost_allocations", ["line_id"])
    op.create_index("ix_finance_cost_allocations_project_id", "finance_cost_allocations", ["project_id"])

    op.create_table(
        "finance_audit_events",
        sa.Column("id", _uuid(), primary_key=True),
        _company_id(),
        sa.Column("actor_user_id", _uuid(), nullable=True),
        sa.Column("entity_type", sa.String(64), nullable=False),
        sa.Column("entity_id", _uuid(), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("before_json", postgresql.JSONB(), nullable=True),
        sa.Column("after_json", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("company_id", "id", name="uq_finance_audit_events_company_id"),
    )
    op.create_index("ix_finance_audit_events_company_id", "finance_audit_events", ["company_id"])
    op.create_index("ix_finance_audit_events_entity_id", "finance_audit_events", ["entity_id"])

    op.create_table(
        "finance_duplicate_exceptions",
        sa.Column("id", _uuid(), primary_key=True),
        _company_id(),
        sa.Column("document_id", _uuid(), nullable=False),
        sa.Column("conflicts_with_document_id", _uuid(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("approved_by_user_id", _uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("company_id", "id", name="uq_finance_duplicate_exceptions_company_id"),
        sa.ForeignKeyConstraint(
            ["company_id", "document_id"],
            ["finance_cost_documents.company_id", "finance_cost_documents.id"],
            name="fk_finance_duplicate_exceptions_document",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["company_id", "conflicts_with_document_id"],
            ["finance_cost_documents.company_id", "finance_cost_documents.id"],
            name="fk_finance_duplicate_exceptions_conflict",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "document_id <> conflicts_with_document_id",
            name="ck_finance_duplicate_exceptions_distinct",
        ),
    )
    op.create_index("ix_finance_duplicate_exceptions_company_id", "finance_duplicate_exceptions", ["company_id"])

    op.execute(FINANCE_D2_FUNCTION_SQL)
    op.execute(FINANCE_D2_TRIGGER_SQL)


def downgrade() -> None:
    op.execute(FINANCE_D2_TRIGGER_DROP_SQL)
    op.drop_table("finance_duplicate_exceptions")
    op.drop_table("finance_audit_events")
    op.drop_table("finance_cost_allocations")
    op.drop_table("finance_cost_lines")
    op.drop_table("finance_cost_documents")
    op.drop_table("finance_budget_lines")
    op.drop_table("finance_budget_versions")
    op.drop_table("finance_counterparties")
    op.drop_table("finance_cost_codes")
    op.drop_table("finance_projects")
