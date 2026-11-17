"""Proposed VAT label correction. This module changes no rows and no amounts.

Gate revision b8 labelled recoverable_amount = 0 as confirmed_non_recoverable
without an accountant note. A zero recoverable amount is not that evidence.

The installed b8 check allows not_determined only when non-recoverable VAT is
also zero. Relabelling a historical row to not_determined without changing its
non-recoverable amount would violate that check. Zeroing the non-recoverable
amount would reduce eligible project cost. Neither is allowed here.

Owner and accountant decision required before any database change:
keep every stored net, tax, recoverable, non-recoverable, and eligible amount.
Add a status historical_unreviewed for rows that b8 labelled from the amount
alone. Eligible cost continues to use the stored amounts. A row stays
confirmed_non_recoverable only when an accountant evidence note is stored.
D2 does not have the status column. Do not apply b8 to D2 as the final label.
"""

from __future__ import annotations

from decimal import Decimal

HISTORICAL_UNREVIEWED = "historical_unreviewed"
CONFIRMED_NON_RECOVERABLE = "confirmed_non_recoverable"
CONFIRMED_RECOVERABLE = "confirmed_recoverable"
AMOUNT_INFERRED_BASIS = "amount_inferred_without_review_note"
POSTING_SELECTION_BASIS = "posting_selection"


def forward_vat_label(
    status: str,
    *,
    recoverable_amount: Decimal,
    non_recoverable_amount: Decimal,
    tax_amount: Decimal,
    evidence_note: str | None,
) -> str:
    """Return the proposed status. This function does not change amounts.

    Both b8 labels were assigned from the stored split. A recoverable amount
    above zero is not an accountant confirmation, just as zero is not.
    """
    if evidence_note and evidence_note.strip():
        return status
    if status in {CONFIRMED_NON_RECOVERABLE, CONFIRMED_RECOVERABLE} and non_recoverable_amount == (
        tax_amount - recoverable_amount
    ):
        return HISTORICAL_UNREVIEWED
    return status


def vat_is_provisional(status: str | None, basis: str | None) -> bool:
    """True when the label is not independent accountant evidence."""
    if status == HISTORICAL_UNREVIEWED:
        return True
    if basis == AMOUNT_INFERRED_BASIS or (basis or "").startswith("b8_") or (basis or "").startswith("pre_b8_"):
        return True
    if status in {CONFIRMED_NON_RECOVERABLE, CONFIRMED_RECOVERABLE} and not (basis or "").strip():
        return True
    return False


def eligible_cost(net_amount: Decimal, non_recoverable_amount: Decimal) -> Decimal:
    return net_amount + non_recoverable_amount


# Design only. This text is not an Alembic revision and must not be executed
# until an accountant names any rows that already have independent evidence.
PROPOSED_STATUS_VALUES = """
vat_recoverability_status IS NULL
OR vat_recoverability_status IN (
    'not_determined',
    'confirmed_non_recoverable',
    'confirmed_recoverable',
    'accountant_review',
    'historical_unreviewed'
)
"""

PROPOSED_AMOUNT_CHECK_ADDITION = """
OR (
    vat_recoverability_status = 'historical_unreviewed'
    AND non_recoverable_amount = tax_amount - recoverable_amount
)
"""

VAT_POSTING_GUARD_SQL = """
CREATE FUNCTION finance_cost_document_vat_status_guard()
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

CREATE TRIGGER trg_finance_cost_documents_vat_status
    BEFORE UPDATE OF status ON finance_cost_documents
    FOR EACH ROW EXECUTE FUNCTION finance_cost_document_vat_status_guard();
"""
