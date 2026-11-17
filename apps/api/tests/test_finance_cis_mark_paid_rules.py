from datetime import date
from decimal import Decimal

from app.modules.finance.cis_mark_paid import stable_idempotency_key
from app.modules.finance.vat_historical_policy import forward_vat_label, vat_is_provisional
import uuid


def test_inferred_recoverable_is_provisional_and_amounts_stay() -> None:
    net = Decimal("100")
    tax = Decimal("20")
    label = forward_vat_label(
        "confirmed_recoverable",
        recoverable_amount=tax,
        non_recoverable_amount=Decimal("0"),
        tax_amount=tax,
        evidence_note=None,
    )
    assert label == "historical_unreviewed"
    assert vat_is_provisional(label, "amount_inferred_without_review_note") is True
    assert vat_is_provisional("confirmed_recoverable", "posting_selection") is False
    assert net + Decimal("0") == net


def test_idempotency_key_is_stable_and_changes_with_amount() -> None:
    company = uuid.UUID("00000000-0000-0000-0000-000000000001")
    item = uuid.UUID("00000000-0000-0000-0000-000000000002")
    first = stable_idempotency_key(
        company_id=company,
        payroll_item_id=item,
        transfer_date=date(2026, 10, 15),
        amount=Decimal("40.0000"),
        bank_reference=" bacs 1 ",
    )
    repeat = stable_idempotency_key(
        company_id=company,
        payroll_item_id=item,
        transfer_date=date(2026, 10, 15),
        amount=Decimal("40.0000"),
        bank_reference="BACS 1",
    )
    other = stable_idempotency_key(
        company_id=company,
        payroll_item_id=item,
        transfer_date=date(2026, 10, 15),
        amount=Decimal("60.0000"),
        bank_reference="BACS 1",
    )
    assert first == repeat
    assert first != other
    assert len(first) == 64
