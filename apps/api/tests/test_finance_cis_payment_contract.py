"""Database-free CIS payment decisions. No payroll or finance rows are written."""

import uuid
from datetime import date
from decimal import Decimal

from app.modules.finance.cis_payment_contract import (
    RECORDING_FAILURE_MESSAGE,
    CisObligation,
    RecordedTransfer,
    TransferRequest,
    integration_enabled,
    plan_cis_transfer,
    plan_payable_correction,
    plan_recording_failure,
    plan_undo_paid,
)


def _obligation(**overrides) -> CisObligation:
    base = dict(
        company_id=uuid.uuid4(),
        worker_id=uuid.uuid4(),
        payroll_item_id=uuid.uuid4(),
        payroll_period_id=uuid.uuid4(),
        net_payable=Decimal("1000.0000"),
        cis_withheld=Decimal("200.0000"),
        payroll_status="approved",
        source_hash="hash-1",
    )
    base.update(overrides)
    return CisObligation(**base)


def _request(obligation: CisObligation, **overrides) -> TransferRequest:
    base = dict(
        idempotency_key="submit-1",
        company_id=obligation.company_id,
        worker_id=obligation.worker_id,
        payroll_item_id=obligation.payroll_item_id,
        amount=None,
        bank_reference="BANK-1",
        transfer_date=date(2026, 10, 14),
        origin="mark_paid",
    )
    base.update(overrides)
    return TransferRequest(**base)


def _paid(obligation: CisObligation, amount: str, key: str, reference: str = "BANK") -> RecordedTransfer:
    return RecordedTransfer(key, obligation.company_id, obligation.worker_id, obligation.payroll_item_id, Decimal(amount), reference)


def test_integration_is_disabled_unless_explicitly_enabled(monkeypatch) -> None:
    monkeypatch.delenv("FINANCE_CIS_PAYMENT_INTEGRATION", raising=False)
    assert integration_enabled() is False
    monkeypatch.setenv("FINANCE_CIS_PAYMENT_INTEGRATION", "yes")
    assert integration_enabled() is True


def test_single_full_mark_paid_records_one_net_payment() -> None:
    obligation = _obligation()
    decision = plan_cis_transfer(obligation, (), _request(obligation), enabled=True, preview_readonly=False)
    assert decision.outcome == "record_transfer"
    assert decision.amount == Decimal("1000.0000")
    assert decision.remaining_after == Decimal("0.0000")
    assert decision.mark_payroll_paid is True
    assert decision.creates_project_expense is False
    assert decision.cis_withheld_unchanged == Decimal("200.0000")


def test_three_partial_transfers_then_a_settled_mark_paid() -> None:
    obligation = _obligation()
    first = plan_cis_transfer(obligation, (), _request(obligation, amount=Decimal("400.0000"), idempotency_key="a", origin="manual_partial"), enabled=True, preview_readonly=False)
    assert first.remaining_after == Decimal("600.0000")
    assert first.payroll_status_after == "approved"
    assert first.mark_payroll_paid is False
    recorded = (_paid(obligation, "400.0000", "a"),)
    second = plan_cis_transfer(obligation, recorded, _request(obligation, amount=Decimal("350.0000"), idempotency_key="b"), enabled=True, preview_readonly=False)
    assert second.remaining_after == Decimal("250.0000")
    recorded = recorded + (_paid(obligation, "350.0000", "b"),)
    third = plan_cis_transfer(obligation, recorded, _request(obligation, amount=Decimal("250.0000"), idempotency_key="c"), enabled=True, preview_readonly=False)
    assert third.remaining_after == Decimal("0.0000")
    assert third.cumulative_paid == Decimal("1000.0000")
    assert third.mark_payroll_paid is True
    settled = plan_cis_transfer(obligation, recorded + (_paid(obligation, "250.0000", "c"),), _request(obligation, idempotency_key="d"), enabled=True, preview_readonly=False)
    assert settled.outcome == "nothing_to_pay"
    assert settled.amount is None


def test_duplicate_retry_and_same_key_do_not_create_another_payment() -> None:
    obligation = _obligation()
    recorded = (_paid(obligation, "1000.0000", "submit-1"),)
    decision = plan_cis_transfer(obligation, recorded, _request(obligation, amount=Decimal("1000.0000")), enabled=True, preview_readonly=False)
    assert decision.outcome == "already_recorded"
    mismatch = plan_cis_transfer(obligation, recorded, _request(obligation, amount=Decimal("1.0000")), enabled=True, preview_readonly=False)
    assert mismatch.outcome == "conflict"


def test_similar_bank_references_remain_separate_transfers() -> None:
    obligation = _obligation()
    recorded = (_paid(obligation, "400.0000", "one", "BANK-100"),)
    decision = plan_cis_transfer(
        obligation,
        recorded,
        _request(obligation, amount=Decimal("100.0000"), idempotency_key="two", bank_reference="BANK-100"),
        enabled=True,
        preview_readonly=False,
    )
    assert decision.outcome == "record_transfer"
    assert decision.idempotency_key == "two"


def test_wrong_worker_company_and_overpayment_conflict() -> None:
    obligation = _obligation()
    wrong = plan_cis_transfer(obligation, (), _request(obligation, worker_id=uuid.uuid4()), enabled=True, preview_readonly=False)
    assert wrong.outcome == "conflict"
    other_company = plan_cis_transfer(obligation, (), _request(obligation, company_id=uuid.uuid4()), enabled=True, preview_readonly=False)
    assert other_company.outcome == "conflict"
    over = plan_cis_transfer(obligation, (), _request(obligation, amount=Decimal("1000.0001")), enabled=True, preview_readonly=False)
    assert over.outcome == "conflict"
    assert "not capped" in over.message


def test_paid_locked_history_is_not_a_new_bank_payment() -> None:
    obligation = _obligation(payroll_status="paid")
    decision = plan_cis_transfer(obligation, (), _request(obligation), enabled=True, preview_readonly=False)
    assert decision.outcome == "conflict"
    assert "already Paid" in decision.message


def test_undo_paid_and_recording_failure_do_not_reverse_or_repeat_the_transfer() -> None:
    obligation = _obligation()
    recorded = (_paid(obligation, "400.0000", "a"),)
    undo = plan_undo_paid(obligation, recorded)
    assert undo.cumulative_paid == Decimal("400.0000")
    assert undo.mark_payroll_paid is False
    assert "does not delete or reverse" in undo.message
    failed = plan_recording_failure(obligation, ())
    assert failed.recording_state == "finance_recording_failed"
    assert failed.message == RECORDING_FAILURE_MESSAGE
    assert "again" in failed.message
    assert failed.payroll_status_after == "approved"


def test_snapshot_repeat_and_correction_do_not_invent_payments() -> None:
    obligation = _obligation()
    same = plan_cis_transfer(obligation, (), _request(obligation, amount=Decimal("100.0000")), enabled=True, preview_readonly=False, snapshot_hash="hash-1")
    assert same.outcome == "record_transfer"
    changed = plan_cis_transfer(obligation, (), _request(obligation), enabled=True, preview_readonly=False, snapshot_hash="hash-2")
    assert changed.outcome == "conflict"
    recorded = (_paid(obligation, "400.0000", "a"),)
    too_low = plan_payable_correction(obligation, recorded, Decimal("300.0000"))
    assert too_low.outcome == "conflict"
    accepted = plan_payable_correction(obligation, recorded, Decimal("900.0000"))
    assert accepted.outcome == "correction_accepted"
    assert accepted.amount is None
    assert accepted.cis_withheld_unchanged == obligation.cis_withheld


def test_preview_and_disabled_flag_block_every_mutation() -> None:
    obligation = _obligation()
    disabled = plan_cis_transfer(obligation, (), _request(obligation), enabled=False, preview_readonly=False)
    preview = plan_cis_transfer(obligation, (), _request(obligation), enabled=True, preview_readonly=True)
    assert disabled.outcome == "blocked"
    assert preview.outcome == "blocked"
    assert disabled.mark_payroll_paid is False
    assert preview.creates_project_expense is False
