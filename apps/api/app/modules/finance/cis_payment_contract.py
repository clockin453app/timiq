"""Decision rules for a future CIS bank-payment integration.

This module does not post payments, change Payroll, or open a database.
The integration flag defaults to off. Calling code must refuse a mutation
when the flag is off or Finance preview mode is read-only.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

MONEY = Decimal("0.0001")

USER_CONFIRMED = "bank_transfer_confirmed_by_user"
FINANCE_PENDING = "finance_recording_pending"
FINANCE_FAILED = "finance_recording_failed"
FINANCE_COMPLETE = "finance_recording_complete"
PAYROLL_RECONCILED = "payroll_obligation_fully_reconciled"

RECORDING_FAILURE_MESSAGE = (
    "You confirmed that the bank transfer was already made. Do not transfer the funds again. "
    "Finance recording is not complete, and the payroll obligation is not fully reconciled."
)


FUTURE_MARK_PAID_AUDIT_FIELDS = (
    "idempotency_key",
    "company_id",
    "worker_id",
    "payroll_item_id",
    "payroll_period_id",
    "transfer_date",
    "amount",
    "bank_reference",
    "origin",
    "recording_state",
    "remaining_after",
    "cis_withheld",
    "creates_project_expense",
    "user_confirmed_not_bank_reconciled",
)


REQUIRED_PAYROLL_CHANGES = (
    "update_item must grow a commit=False path and Mark Paid must use it",
    "create_internal_audit_event must be called with commit=False inside the same transaction",
    "Payroll Paid must be set only after the Finance payment and allocation succeed",
    "notifications run after the outer commit, not before it",
    "Undo Paid changes payroll status only and does not delete the bank payment",
)


def future_mark_paid_audit_fields() -> tuple[str, ...]:
    """Fields a later Mark Paid integration must store. This does not enable that integration."""
    return FUTURE_MARK_PAID_AUDIT_FIELDS


def integration_enabled() -> bool:
    """On only for an explicit test run. Any other environment stays off."""
    if os.environ.get("TIMIQ_ENV", "").strip().lower() != "test":
        return False
    return os.environ.get("FINANCE_CIS_PAYMENT_INTEGRATION", "").strip().lower() in {"1", "yes", "true"}


@dataclass(frozen=True)
class RecordedTransfer:
    idempotency_key: str
    company_id: uuid.UUID
    worker_id: uuid.UUID
    payroll_item_id: uuid.UUID
    amount: Decimal
    bank_reference: str
    reversed: bool = False


@dataclass(frozen=True)
class CisObligation:
    company_id: uuid.UUID
    worker_id: uuid.UUID
    payroll_item_id: uuid.UUID
    payroll_period_id: uuid.UUID
    net_payable: Decimal
    cis_withheld: Decimal
    payroll_status: str
    source_hash: str


@dataclass(frozen=True)
class TransferRequest:
    idempotency_key: str
    company_id: uuid.UUID
    worker_id: uuid.UUID
    payroll_item_id: uuid.UUID
    amount: Decimal | None
    bank_reference: str
    transfer_date: date
    origin: str


@dataclass(frozen=True)
class TransferDecision:
    outcome: str
    recording_state: str
    amount: Decimal | None
    remaining_before: Decimal
    remaining_after: Decimal
    cumulative_paid: Decimal
    payroll_status_after: str
    mark_payroll_paid: bool
    creates_project_expense: bool
    idempotency_key: str | None
    message: str
    cis_withheld_unchanged: Decimal


def _money(value: Decimal) -> Decimal:
    return value.quantize(MONEY)


def active_paid(transfers: tuple[RecordedTransfer, ...], obligation: CisObligation) -> Decimal:
    total = Decimal("0")
    for transfer in transfers:
        if transfer.reversed:
            continue
        if transfer.company_id != obligation.company_id or transfer.payroll_item_id != obligation.payroll_item_id:
            continue
        total += transfer.amount
    return _money(total)


def plan_cis_transfer(
    obligation: CisObligation,
    transfers: tuple[RecordedTransfer, ...],
    request: TransferRequest,
    *,
    enabled: bool,
    preview_readonly: bool,
    snapshot_hash: str | None = None,
) -> TransferDecision:
    paid = active_paid(transfers, obligation)
    remaining = _money(obligation.net_payable - paid)
    withheld = obligation.cis_withheld
    if not enabled or preview_readonly:
        return TransferDecision(
            "blocked",
            USER_CONFIRMED,
            None,
            remaining,
            remaining,
            paid,
            obligation.payroll_status,
            False,
            False,
            None,
            "CIS payment integration is disabled or Finance is in read-only preview. No payment was recorded.",
            withheld,
        )
    if request.company_id != obligation.company_id or request.worker_id != obligation.worker_id or request.payroll_item_id != obligation.payroll_item_id:
        return _conflict(obligation, paid, remaining, "The payment does not match this worker, company, and payroll item.")
    if obligation.payroll_status == "paid" and not transfers:
        return _conflict(
            obligation,
            paid,
            remaining,
            "This payroll row is already Paid without a Finance bank payment. It must not be imported as a new transfer.",
        )
    if obligation.payroll_status not in {"approved", "paid"}:
        return _conflict(obligation, paid, remaining, "Only an approved payroll obligation can receive a bank payment.")
    if snapshot_hash is not None and snapshot_hash != obligation.source_hash:
        return _conflict(obligation, paid, remaining, "The approved payroll snapshot changed. Record a correction before paying.")
    existing = next((item for item in transfers if item.idempotency_key == request.idempotency_key), None)
    if existing is not None:
        if existing.amount != request.amount and request.amount is not None:
            return _conflict(obligation, paid, remaining, "This submission key was already used for a different amount.")
        return TransferDecision(
            "already_recorded",
            FINANCE_COMPLETE if remaining > 0 else PAYROLL_RECONCILED,
            existing.amount,
            remaining,
            remaining,
            paid,
            obligation.payroll_status,
            False,
            False,
            existing.idempotency_key,
            "This transfer was already recorded. No second payment was created.",
            withheld,
        )
    amount = remaining if request.amount is None else _money(request.amount)
    if amount <= 0 or remaining <= 0:
        return TransferDecision(
            "nothing_to_pay",
            PAYROLL_RECONCILED if remaining <= 0 else USER_CONFIRMED,
            None,
            remaining,
            remaining,
            paid,
            obligation.payroll_status,
            False,
            False,
            None,
            "The remaining payable is already zero. Mark Paid must not create another payment.",
            withheld,
        )
    if amount > remaining:
        return _conflict(
            obligation,
            paid,
            remaining,
            "The transfer is larger than the unpaid balance. It was not capped or moved to another obligation.",
        )
    after = _money(remaining - amount)
    fully_settled = after == 0
    return TransferDecision(
        "record_transfer",
        PAYROLL_RECONCILED if fully_settled else FINANCE_COMPLETE,
        amount,
        remaining,
        after,
        _money(paid + amount),
        "paid" if fully_settled else "approved",
        fully_settled and obligation.payroll_status == "approved",
        False,
        request.idempotency_key,
        "Record one bank payment for the confirmed transfer. CIS withheld is not part of this payment.",
        withheld,
    )


def plan_undo_paid(obligation: CisObligation, transfers: tuple[RecordedTransfer, ...]) -> TransferDecision:
    paid = active_paid(transfers, obligation)
    remaining = _money(obligation.net_payable - paid)
    return TransferDecision(
        "payroll_status_only",
        FINANCE_COMPLETE if transfers else USER_CONFIRMED,
        None,
        remaining,
        remaining,
        paid,
        "approved",
        False,
        False,
        None,
        "Undo Paid changes payroll status only. It does not delete or reverse a bank transfer.",
        obligation.cis_withheld,
    )


def plan_recording_failure(obligation: CisObligation, transfers: tuple[RecordedTransfer, ...]) -> TransferDecision:
    paid = active_paid(transfers, obligation)
    remaining = _money(obligation.net_payable - paid)
    return TransferDecision(
        "recording_failed",
        FINANCE_FAILED,
        None,
        remaining,
        remaining,
        paid,
        obligation.payroll_status,
        False,
        False,
        None,
        RECORDING_FAILURE_MESSAGE,
        obligation.cis_withheld,
    )


def plan_payable_correction(obligation: CisObligation, transfers: tuple[RecordedTransfer, ...], corrected_payable: Decimal) -> TransferDecision:
    paid = active_paid(transfers, obligation)
    corrected = _money(corrected_payable)
    if corrected < paid:
        return _conflict(
            obligation,
            paid,
            _money(obligation.net_payable - paid),
            "The corrected payable is below the transfers already recorded. An explicit adjustment is required.",
        )
    remaining = _money(corrected - paid)
    return TransferDecision(
        "correction_accepted",
        FINANCE_COMPLETE if remaining > 0 else PAYROLL_RECONCILED,
        None,
        remaining,
        remaining,
        paid,
        obligation.payroll_status,
        False,
        False,
        None,
        "The payroll correction does not recalculate CIS or create a bank payment.",
        obligation.cis_withheld,
    )


def _conflict(obligation: CisObligation, paid: Decimal, remaining: Decimal, message: str) -> TransferDecision:
    return TransferDecision(
        "conflict",
        USER_CONFIRMED,
        None,
        remaining,
        remaining,
        paid,
        obligation.payroll_status,
        False,
        False,
        None,
        message,
        obligation.cis_withheld,
    )
