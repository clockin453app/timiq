"""Pure supplier-payment checks. Balances stay in the D4 database functions."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from app.modules.finance.supplier_payment_errors import (
    INVALID_AMOUNT,
    INVALID_METHOD,
    REQUIRED_FIELD,
    SupplierPaymentError,
)

MONEY_QUANTUM = Decimal("0.0001")
MONEY_MAX = Decimal("99999999999999.9999")
PAYMENT_METHODS = frozenset({"bank_transfer", "card", "cash", "cheque", "other"})
ALLOCATABLE_DOCUMENT_TYPES = frozenset({"supplier_invoice", "expense_receipt"})


@dataclass(frozen=True)
class PaymentDraft:
    counterparty_id: uuid.UUID | None
    payment_date: date | None
    payment_method: str | None
    amount: Decimal


@dataclass(frozen=True)
class PostingBlocker:
    code: str
    message: str


def require_money(value: Decimal) -> Decimal:
    """Accept a Decimal that already fits NUMERIC(18,4)."""
    if not isinstance(value, Decimal):
        raise SupplierPaymentError(INVALID_AMOUNT, "Money values must be decimal amounts.")
    if value != value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP) or abs(value) > MONEY_MAX:
        raise SupplierPaymentError(
            INVALID_AMOUNT,
            "Money values must fit NUMERIC(18,4) without rounding away a remainder.",
        )
    return value


def require_positive_money(value: Decimal) -> Decimal:
    money = require_money(value)
    if money <= 0:
        raise SupplierPaymentError(INVALID_AMOUNT, "Supplier payment amounts must be greater than zero.")
    return money


def require_payment_method(value: str | None) -> str | None:
    if value is None:
        return None
    if value not in PAYMENT_METHODS:
        raise SupplierPaymentError(INVALID_METHOD, "Payment method is not supported.")
    return value


DUPLICATE_EFFECTIVE_ALLOCATION = (
    "An effective allocation already exists for this payment and supplier invoice."
)


@dataclass(frozen=True)
class AllocationRequest:
    document_id: object
    supplier_id: object
    document_type: str
    status: str
    outstanding: Decimal
    amount: Decimal


@dataclass(frozen=True)
class EffectiveAllocation:
    """One posted allocation that is not allocation-reversed (and payment not reversed)."""

    payment_id: object
    cost_document_id: object
    amount: Decimal
    reversed: bool = False


def invoice_outstanding(*, gross: Decimal, effective_allocations: list[Decimal]) -> Decimal:
    """Gross payable remaining after effective payment allocations. Not project cost."""
    allocated = sum((require_positive_money(amount) for amount in effective_allocations), Decimal("0"))
    outstanding = require_money(gross) - allocated
    if outstanding < 0:
        raise SupplierPaymentError(INVALID_AMOUNT, "Effective allocations exceed invoice gross.")
    return outstanding


def payment_unallocated(*, payment_amount: Decimal, effective_allocations: list[Decimal]) -> Decimal:
    """Bank payment remaining after effective allocations from that payment."""
    allocated = sum((require_positive_money(amount) for amount in effective_allocations), Decimal("0"))
    remaining = require_positive_money(payment_amount) - allocated
    if remaining < 0:
        raise SupplierPaymentError(INVALID_AMOUNT, "Effective allocations exceed the payment amount.")
    return remaining


def effective_pair_conflict(
    *,
    payment_id: object,
    cost_document_id: object,
    existing_effective: list[EffectiveAllocation],
) -> str | None:
    """Reject a second simultaneous effective allocation for the same payment/invoice pair."""
    for row in existing_effective:
        if row.reversed:
            continue
        if row.payment_id == payment_id and row.cost_document_id == cost_document_id:
            return DUPLICATE_EFFECTIVE_ALLOCATION
    return None


def allocation_conflict(
    *,
    payment_supplier_id: object,
    available: Decimal,
    requests: list[AllocationRequest],
    existing_effective_document_ids: set[object] | frozenset[object] | None = None,
) -> str | None:
    """Return the first reason a payment allocation batch cannot be posted.

    ``existing_effective_document_ids`` are invoices that already have an
    effective (posted, not allocation-reversed) allocation from this payment.
    A second effective allocation to the same invoice from the same payment is
    rejected even when payment available and invoice outstanding remain.
    """
    document_ids = [item.document_id for item in requests]
    if len(set(document_ids)) != len(document_ids):
        return "Each supplier document can appear only once in an allocation batch."
    existing = existing_effective_document_ids or set()
    for document_id in document_ids:
        if document_id in existing:
            return DUPLICATE_EFFECTIVE_ALLOCATION
    requested = sum((require_positive_money(item.amount) for item in requests), Decimal("0"))
    if requested > available:
        return "Payment allocation exceeds the unallocated payment amount."
    for item in requests:
        if item.status != "posted" or item.document_type not in ALLOCATABLE_DOCUMENT_TYPES:
            return "Supplier payments allocate only to posted supplier invoices and expense receipts."
        if item.supplier_id != payment_supplier_id:
            return "Supplier payment allocation must use the same supplier."
        if require_positive_money(item.amount) > item.outstanding:
            return "Payment allocation exceeds the supplier outstanding balance."
    return None


def payment_audit_snapshot(
    *,
    amount: Decimal,
    currency_code: str,
    payment_date: object,
    external_reference: str | None,
    cost_document_id: object | None = None,
    project_id: object | None = None,
    project_attribution: str | None = None,
) -> dict[str, object]:
    """Facts stored with a supplier payment audit event. This does not create another payment."""
    payload: dict[str, object] = {
        "amount": str(amount),
        "currency_code": currency_code,
        "payment_date": None if payment_date is None else str(payment_date),
        "external_reference": external_reference,
    }
    if cost_document_id is not None:
        payload["cost_document_id"] = str(cost_document_id)
    if project_id is not None:
        payload["project_id"] = str(project_id)
    if project_attribution is not None:
        payload["project_attribution"] = project_attribution
    return payload


def posting_blockers(payment: PaymentDraft) -> list[PostingBlocker]:
    """Return why a draft payment cannot be posted. An empty list means the shape is complete."""
    blockers: list[PostingBlocker] = []
    if payment.counterparty_id is None:
        blockers.append(PostingBlocker(REQUIRED_FIELD, "A supplier is required before posting a payment."))
    if payment.payment_date is None:
        blockers.append(PostingBlocker(REQUIRED_FIELD, "A payment date is required before posting a payment."))
    try:
        require_positive_money(payment.amount)
    except SupplierPaymentError as exc:
        blockers.append(PostingBlocker(exc.code, exc.message))
    if payment.payment_method is not None and payment.payment_method not in PAYMENT_METHODS:
        blockers.append(PostingBlocker(INVALID_METHOD, "Payment method is not supported."))
    return blockers
