"""Unapplied PostgreSQL text for the next Finance safety revision.

Nothing in this module connects to a database. The Alembic file that executes
it is not applied to D2 or Gate.
"""

ONE_PROJECT_FUNCTION = """
CREATE FUNCTION finance_new_posted_cost_one_project()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    project_count integer;
    overhead_count integer;
BEGIN
    IF NEW.status IS DISTINCT FROM 'posted' THEN
        RETURN NEW;
    END IF;
    IF NEW.document_type NOT IN ('supplier_invoice', 'expense_receipt') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
        RETURN NEW;
    END IF;
    SELECT
        COUNT(DISTINCT allocation.project_id) FILTER (WHERE allocation.project_id IS NOT NULL),
        COUNT(*) FILTER (WHERE allocation.is_overhead)
    INTO project_count, overhead_count
    FROM finance_cost_allocations AS allocation
    JOIN finance_cost_lines AS line
      ON line.id = allocation.line_id
     AND line.company_id = allocation.company_id
    WHERE line.document_id = NEW.id
      AND line.company_id = NEW.company_id;
    IF overhead_count > 0 AND project_count > 0 THEN
        RAISE EXCEPTION 'new posted supplier document cannot mix overhead and a project';
    END IF;
    -- Multiple projects on one supplier invoice/expense receipt are allowed
    -- when every allocation belongs to the document company (app-enforced).
    IF overhead_count = 0 AND project_count < 1 THEN
        RAISE EXCEPTION 'new posted supplier document requires one project or company overhead';
    END IF;
    RETURN NEW;
END;
$$;
"""

ONE_PROJECT_TRIGGER = """
CREATE CONSTRAINT TRIGGER trg_finance_new_posted_cost_one_project
    AFTER INSERT OR UPDATE ON finance_cost_documents
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION finance_new_posted_cost_one_project();
"""

CUSTOMER_REFERENCE_FUNCTION = """
CREATE FUNCTION finance_customer_invoice_normalize_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
        RETURN NEW;
    END IF;
    NEW.normalized_reference := NULLIF(
        btrim(regexp_replace(
            upper(translate(
                COALESCE(NEW.external_reference, ''),
                chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195)
                    || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201)
                    || chr(8202) || chr(8239) || chr(8287) || chr(12288),
                repeat(' ', 16)
            )),
            '[[:space:]]+',
            ' ',
            'g'
        )),
        ''
    );
    RETURN NEW;
END;
$$;
"""

CUSTOMER_REFERENCE_TRIGGER = """
CREATE TRIGGER trg_fin_cust_inv_normalize
    BEFORE INSERT OR UPDATE OF external_reference, status ON finance_customer_invoices
    FOR EACH ROW
    EXECUTE FUNCTION finance_customer_invoice_normalize_reference();
"""

CUSTOMER_REFERENCE_INDEX = """
CREATE UNIQUE INDEX uq_finance_posted_customer_invoice_ref
    ON finance_customer_invoices (company_id, counterparty_id, normalized_reference)
    WHERE status = 'posted'
      AND document_kind = 'invoice'
      AND normalized_reference IS NOT NULL;
"""

CUSTOMER_REFERENCE_INDEX_NAME = "uq_finance_posted_customer_invoice_ref"

# Not included in c9d0e1f2a3b4. A partial unique index cannot subquery reversals.
# A posted reversal keeps the original payment row, so the key stays unique.
PROPOSED_WORKER_PAYMENT_IDEMPOTENCY = """
ALTER TABLE finance_worker_payments
    ADD COLUMN idempotency_key varchar(80);
CREATE UNIQUE INDEX uq_finance_worker_payment_idempotency
    ON finance_worker_payments (company_id, idempotency_key)
    WHERE status = 'posted'
      AND idempotency_key IS NOT NULL;
"""
