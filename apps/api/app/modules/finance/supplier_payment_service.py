"""Supplier payment drafts, posting, allocations, and reversals.

Cash settlement does not change project cost, VAT, or eligible cost. Those
amounts stay on the cost document. This service does not commit the caller
transaction. Posted rows are immutable; corrections are new reversal rows.

Available money and invoice outstanding come from the D4 SQL functions.
Row locks reduce lost updates inside the caller transaction. They do not
replace a two-session concurrency test.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.modules.finance.constants import SUPPORTED_CURRENCY_CODE
from app.modules.finance.cost_register_rules import normalize_reference
from app.modules.finance.models import (
    FinanceAuditEvent,
    FinanceCostAllocation,
    FinanceCostDocument,
    FinanceCostLine,
    FinanceCounterparty,
)
from app.modules.finance.supplier_payment_errors import (
    ALLOCATION_NOT_FOUND,
    ALLOCATION_REJECTED,
    DATABASE_REJECTED,
    DOCUMENT_NOT_FOUND,
    DUPLICATE_REFERENCE,
    DUPLICATE_REVERSAL,
    IMMUTABLE_PAYMENT,
    PAYMENT_NOT_FOUND,
    REFERENCE_NOT_IN_COMPANY,
    REQUIRED_FIELD,
    REVERSAL_REJECTED,
    SupplierPaymentError,
)
from app.modules.finance.supplier_payment_models import (
    FinanceSupplierPayment,
    FinanceSupplierPaymentAllocation,
    FinanceSupplierPaymentAllocationReversal,
    FinanceSupplierPaymentReversal,
)
from app.modules.finance.supplier_payment_rules import (
    ALLOCATABLE_DOCUMENT_TYPES,
    AllocationRequest,
    PaymentDraft,
    DUPLICATE_EFFECTIVE_ALLOCATION,
    allocation_conflict,
    payment_audit_snapshot,
    posting_blockers,
    require_positive_money,
)
from app.modules.finance.supplier_payment_schemas import (
    AllocationBatchInput,
    AllocationView,
    PostingBlockerView,
    ReversalInput,
    SupplierPaymentDraftInput,
    SupplierPaymentReversalView,
    SupplierPaymentValidationView,
    SupplierPaymentView,
)

_SAFE_DATABASE_MESSAGES = {
    "posted supplier payment is immutable": (
        IMMUTABLE_PAYMENT,
        "A posted supplier payment cannot be changed.",
    ),
    "posted supplier payment cannot be deleted": (
        IMMUTABLE_PAYMENT,
        "A posted supplier payment cannot be deleted.",
    ),
    "supplier payments must be inserted as drafts": (
        IMMUTABLE_PAYMENT,
        "A supplier payment must be saved as a draft before it is posted.",
    ),
    "supplier payment requires a supplier counterparty": (
        REQUIRED_FIELD,
        "Supplier payment requires a supplier counterparty.",
    ),
    "posted supplier payment allocation is immutable": (
        IMMUTABLE_PAYMENT,
        "A posted supplier payment allocation cannot be changed.",
    ),
    "supplier payment allocations must be inserted as drafts": (
        IMMUTABLE_PAYMENT,
        "A supplier payment allocation must be saved as a draft before it is posted.",
    ),
    "supplier payment allocations require a posted payment": (
        ALLOCATION_REJECTED,
        "Supplier payment allocations require a posted payment.",
    ),
    "cannot allocate a reversed supplier payment": (
        ALLOCATION_REJECTED,
        "Cannot allocate a reversed supplier payment.",
    ),
    "supplier payment allocation must stay in its company": (
        REFERENCE_NOT_IN_COMPANY,
        "Supplier payment allocation must stay in its company.",
    ),
    "supplier payments allocate only to posted supplier invoices and expense receipts": (
        ALLOCATION_REJECTED,
        "Supplier payments allocate only to posted supplier invoices and expense receipts.",
    ),
    "supplier payment allocation must use the same supplier": (
        ALLOCATION_REJECTED,
        "Supplier payment allocation must use the same supplier.",
    ),
    "payment allocation exceeds the unallocated payment amount": (
        ALLOCATION_REJECTED,
        "Payment allocation exceeds the unallocated payment amount.",
    ),
    "payment allocation exceeds the supplier outstanding balance": (
        ALLOCATION_REJECTED,
        "Payment allocation exceeds the supplier outstanding balance.",
    ),
    "an effective allocation already exists for this payment and supplier invoice": (
        ALLOCATION_REJECTED,
        DUPLICATE_EFFECTIVE_ALLOCATION,
    ),
    "only a posted supplier payment can be reversed": (
        REVERSAL_REJECTED,
        "Only a posted supplier payment can be reversed.",
    ),
    "supplier payment reversal must match the payment amount": (
        REVERSAL_REJECTED,
        "Supplier payment reversal must match the payment amount.",
    ),
    "reverse supplier payment allocations before reversing the payment": (
        REVERSAL_REJECTED,
        "Reverse supplier payment allocations before reversing the payment.",
    ),
    "posted supplier payment reversal is immutable": (
        IMMUTABLE_PAYMENT,
        "A posted supplier payment reversal cannot be changed.",
    ),
    "only a posted supplier payment allocation can be reversed": (
        REVERSAL_REJECTED,
        "Only a posted supplier payment allocation can be reversed.",
    ),
    "supplier payment allocation reversal must match the allocation amount": (
        REVERSAL_REJECTED,
        "Supplier payment allocation reversal must match the allocation amount.",
    ),
    "cannot reverse an allocation after the supplier payment is reversed": (
        REVERSAL_REJECTED,
        "Cannot reverse an allocation after the supplier payment is reversed.",
    ),
    "posted supplier payment allocation reversal is immutable": (
        IMMUTABLE_PAYMENT,
        "A posted supplier payment allocation reversal cannot be changed.",
    ),
}


def create_supplier_payment_draft(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    payload: SupplierPaymentDraftInput,
) -> SupplierPaymentView:
    _require_supplier_if_present(db_session, company_id, payload.counterparty_id)
    payment = FinanceSupplierPayment(
        id=uuid.uuid4(),
        company_id=company_id,
        status="draft",
        currency_code=SUPPORTED_CURRENCY_CODE,
        amount=require_positive_money(payload.amount),
        created_by_user_id=actor_user_id,
    )
    db_session.add(payment)
    _apply_draft(payment, payload)
    _audit(db_session, company_id, actor_user_id, "supplier_payment", payment.id, "payment_draft_saved", "Draft saved.")
    _flush(db_session)
    return _view(db_session, payment)


def update_supplier_payment_draft(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    payment_id: uuid.UUID,
    payload: SupplierPaymentDraftInput,
) -> SupplierPaymentView:
    payment = _lock_draft(db_session, company_id, payment_id)
    _require_supplier_if_present(db_session, company_id, payload.counterparty_id)
    payment.amount = require_positive_money(payload.amount)
    _apply_draft(payment, payload)
    _audit(db_session, company_id, actor_user_id, "supplier_payment", payment.id, "payment_draft_saved", "Draft updated.")
    _flush(db_session)
    return _view(db_session, payment)


def validate_supplier_payment(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    payment_id: uuid.UUID,
) -> SupplierPaymentValidationView:
    payment = _load_payment(db_session, company_id, payment_id)
    if payment.status == "posted":
        return SupplierPaymentValidationView(
            ready_to_post=False,
            blockers=[
                PostingBlockerView(
                    code=IMMUTABLE_PAYMENT,
                    message="A posted supplier payment cannot be changed.",
                )
            ],
        )
    blockers = posting_blockers(_draft_shape(payment))
    return SupplierPaymentValidationView(
        ready_to_post=not blockers,
        blockers=[PostingBlockerView(code=item.code, message=item.message) for item in blockers],
    )


def post_supplier_payment(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    payment_id: uuid.UUID,
) -> SupplierPaymentView:
    payment = _lock_draft(db_session, company_id, payment_id)
    blockers = posting_blockers(_draft_shape(payment))
    if blockers:
        raise SupplierPaymentError(blockers[0].code, blockers[0].message)
    _require_supplier(db_session, company_id, payment.counterparty_id)
    savepoint = db_session.begin_nested()
    payment.status = "posted"
    payment.posted_at = datetime.now(timezone.utc)
    payment.posted_by_user_id = actor_user_id
    _audit(
        db_session,
        company_id,
        actor_user_id,
        "supplier_payment",
        payment.id,
        "payment_posted",
        "Payment posted.",
        payment_audit_snapshot(
            amount=Decimal(payment.amount),
            currency_code=payment.currency_code,
            payment_date=payment.payment_date,
            external_reference=payment.external_reference,
        ),
    )
    try:
        db_session.flush()
        db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
        savepoint.commit()
    except DBAPIError as exc:
        savepoint.rollback()
        db_session.expire_all()
        raise _from_database(exc) from exc
    db_session.refresh(payment)
    return _view(db_session, payment)


def allocate_supplier_payment(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    payment_id: uuid.UUID,
    payload: AllocationBatchInput,
) -> SupplierPaymentView:
    """Post every allocation in the batch, or leave the payment unchanged."""
    documents = _prepare_allocations(db_session, company_id, payment_id, payload)
    payment = _load_payment(db_session, company_id, payment_id)
    next_number = _next_allocation_number(db_session, payment.id)
    savepoint = db_session.begin_nested()
    try:
        for offset, item in enumerate(payload.allocations):
            document = documents[item.cost_document_id]
            allocation = FinanceSupplierPaymentAllocation(
                id=uuid.uuid4(),
                company_id=company_id,
                payment_id=payment.id,
                cost_document_id=document.id,
                allocation_number=next_number + offset,
                status="draft",
                amount=require_positive_money(item.amount),
                created_by_user_id=actor_user_id,
            )
            db_session.add(allocation)
            db_session.flush()
            allocation.status = "posted"
            allocation.posted_at = datetime.now(timezone.utc)
            allocation.posted_by_user_id = actor_user_id
            project_ids = _document_project_ids(db_session, company_id, document.id)
            _audit(
                db_session,
                company_id,
                actor_user_id,
                "supplier_payment_allocation",
                allocation.id,
                "payment_allocated",
                "Payment allocated.",
                payment_audit_snapshot(
                    amount=Decimal(allocation.amount),
                    currency_code=payment.currency_code,
                    payment_date=payment.payment_date,
                    external_reference=payment.external_reference,
                    cost_document_id=document.id,
                    project_id=next(iter(project_ids)) if len(project_ids) == 1 else None,
                    project_attribution="multiple_stored_projects" if len(project_ids) > 1 else None,
                ),
            )
            db_session.flush()
        db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
        savepoint.commit()
    except DBAPIError as exc:
        savepoint.rollback()
        db_session.expire_all()
        raise _from_database(exc) from exc
    db_session.refresh(payment)
    return _view(db_session, payment)


def reverse_supplier_payment_allocation(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    allocation_id: uuid.UUID,
    payload: ReversalInput,
) -> SupplierPaymentView:
    allocation = _load_allocation(db_session, company_id, allocation_id)
    payment = _lock_payment(db_session, company_id, allocation.payment_id)
    allocation = _lock_allocation(db_session, company_id, allocation_id)
    if allocation.status != "posted":
        raise SupplierPaymentError(REVERSAL_REJECTED, "Only a posted supplier payment allocation can be reversed.")
    if _posted_payment_reversal(db_session, payment.id) is not None:
        raise SupplierPaymentError(
            REVERSAL_REJECTED,
            "Cannot reverse an allocation after the supplier payment is reversed.",
        )
    if _allocation_reversal(db_session, allocation.id) is not None:
        raise SupplierPaymentError(DUPLICATE_REVERSAL, "This allocation already has a reversal.")
    reversal = FinanceSupplierPaymentAllocationReversal(
        id=uuid.uuid4(),
        company_id=company_id,
        allocation_id=allocation.id,
        status="draft",
        amount=Decimal(allocation.amount),
        reason=_clean_text(payload.reason),
        created_by_user_id=actor_user_id,
    )
    savepoint = db_session.begin_nested()
    db_session.add(reversal)
    try:
        db_session.flush()
        reversal.status = "posted"
        reversal.posted_at = datetime.now(timezone.utc)
        reversal.posted_by_user_id = actor_user_id
        _audit(
            db_session,
            company_id,
            actor_user_id,
            "supplier_payment_allocation_reversal",
            reversal.id,
            "allocation_reversed",
            "Allocation reversed.",
        )
        db_session.flush()
        db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
        savepoint.commit()
    except DBAPIError as exc:
        savepoint.rollback()
        db_session.expire_all()
        raise _from_database(exc) from exc
    return _view(db_session, payment)


def reverse_supplier_payment(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    payment_id: uuid.UUID,
    payload: ReversalInput,
) -> SupplierPaymentView:
    payment = _lock_payment(db_session, company_id, payment_id)
    if payment.status != "posted":
        raise SupplierPaymentError(REVERSAL_REJECTED, "Only a posted supplier payment can be reversed.")
    if _payment_reversal(db_session, payment.id) is not None:
        raise SupplierPaymentError(DUPLICATE_REVERSAL, "This supplier payment already has a reversal.")
    _lock_payment_allocations(db_session, payment.id)
    if _money_function(db_session, "finance_supplier_allocated_from_payment", payment.id) > 0:
        raise SupplierPaymentError(
            REVERSAL_REJECTED,
            "Reverse supplier payment allocations before reversing the payment.",
        )
    reversal = FinanceSupplierPaymentReversal(
        id=uuid.uuid4(),
        company_id=company_id,
        payment_id=payment.id,
        status="draft",
        amount=Decimal(payment.amount),
        reason=_clean_text(payload.reason),
        created_by_user_id=actor_user_id,
    )
    savepoint = db_session.begin_nested()
    db_session.add(reversal)
    try:
        db_session.flush()
        reversal.status = "posted"
        reversal.posted_at = datetime.now(timezone.utc)
        reversal.posted_by_user_id = actor_user_id
        _audit(
            db_session,
            company_id,
            actor_user_id,
            "supplier_payment_reversal",
            reversal.id,
            "payment_reversed",
            "Payment reversed.",
        )
        db_session.flush()
        db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
        savepoint.commit()
    except DBAPIError as exc:
        savepoint.rollback()
        db_session.expire_all()
        raise _from_database(exc) from exc
    db_session.refresh(payment)
    return _view(db_session, payment)


def get_supplier_payment(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    payment_id: uuid.UUID,
) -> SupplierPaymentView:
    return _view(db_session, _load_payment(db_session, company_id, payment_id))


def supplier_document_outstanding(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    document_id: uuid.UUID,
) -> Decimal:
    """Outstanding gross payable from the D4 liability and allocation functions."""
    document = _load_document(db_session, company_id, document_id)
    return _document_outstanding(db_session, document.id)


def _prepare_allocations(
    db_session: Session,
    company_id: uuid.UUID,
    payment_id: uuid.UUID,
    payload: AllocationBatchInput,
) -> dict[uuid.UUID, FinanceCostDocument]:
    document_ids = [item.cost_document_id for item in payload.allocations]
    if len(set(document_ids)) != len(document_ids):
        raise SupplierPaymentError(
            ALLOCATION_REJECTED,
            "Each supplier document can appear only once in an allocation batch.",
        )
    payment = _lock_payment(db_session, company_id, payment_id)
    if payment.status != "posted":
        raise SupplierPaymentError(ALLOCATION_REJECTED, "Supplier payment allocations require a posted payment.")
    if _posted_payment_reversal(db_session, payment.id) is not None:
        raise SupplierPaymentError(ALLOCATION_REJECTED, "Cannot allocate a reversed supplier payment.")
    _require_supplier(db_session, company_id, payment.counterparty_id)
    documents = _lock_documents(db_session, company_id, document_ids)
    _lock_payment_allocations(db_session, payment.id)
    for document_id in sorted(document_ids):
        _lock_document_allocations(db_session, document_id)
    # CVR-1: after row locks, reject a second effective allocation for the same
    # payment/invoice pair. Payment FOR UPDATE serialises service callers; a
    # database active-allocation UNIQUE guard remains deferred (dual Alembic heads).
    effective_document_ids = _effective_cost_document_ids_for_payment(db_session, payment.id)
    available = _money_function(db_session, "finance_supplier_payment_available", payment.id)
    requested = sum((require_positive_money(item.amount) for item in payload.allocations), Decimal("0"))
    if requested > available:
        raise SupplierPaymentError(
            ALLOCATION_REJECTED,
            "Payment allocation exceeds the unallocated payment amount.",
        )
    conflict = allocation_conflict(
        payment_supplier_id=payment.counterparty_id,
        available=available,
        requests=[
            AllocationRequest(
                document_id=item.cost_document_id,
                supplier_id=documents[item.cost_document_id].counterparty_id,
                document_type=documents[item.cost_document_id].document_type,
                status=documents[item.cost_document_id].status,
                outstanding=_document_outstanding(db_session, item.cost_document_id),
                amount=require_positive_money(item.amount),
            )
            for item in payload.allocations
        ],
        existing_effective_document_ids=effective_document_ids,
    )
    if conflict is not None:
        raise SupplierPaymentError(ALLOCATION_REJECTED, conflict)
    return documents


def _document_project_ids(db_session: Session, company_id: uuid.UUID, document_id: uuid.UUID) -> set[uuid.UUID]:
    rows = db_session.scalars(
        select(FinanceCostAllocation.project_id)
        .join(FinanceCostLine, FinanceCostLine.id == FinanceCostAllocation.line_id)
        .where(
            FinanceCostLine.document_id == document_id,
            FinanceCostLine.company_id == company_id,
            FinanceCostAllocation.company_id == company_id,
            FinanceCostAllocation.project_id.is_not(None),
        )
    )
    return {project_id for project_id in rows if project_id is not None}


def _apply_draft(payment: FinanceSupplierPayment, payload: SupplierPaymentDraftInput) -> None:
    payment.counterparty_id = payload.counterparty_id
    payment.payment_date = payload.payment_date
    payment.payment_method = payload.payment_method
    payment.external_reference = _clean_text(payload.external_reference)
    payment.normalized_reference = normalize_reference(payload.external_reference)
    payment.notes = _clean_text(payload.notes)
    payment.currency_code = SUPPORTED_CURRENCY_CODE


def _draft_shape(payment: FinanceSupplierPayment) -> PaymentDraft:
    return PaymentDraft(
        counterparty_id=payment.counterparty_id,
        payment_date=payment.payment_date,
        payment_method=payment.payment_method,
        amount=Decimal(payment.amount),
    )


def _require_supplier_if_present(
    db_session: Session,
    company_id: uuid.UUID,
    counterparty_id: uuid.UUID | None,
) -> None:
    if counterparty_id is not None:
        _require_supplier(db_session, company_id, counterparty_id)


def _require_supplier(db_session: Session, company_id: uuid.UUID, counterparty_id: uuid.UUID | None) -> None:
    if counterparty_id is None:
        raise SupplierPaymentError(REQUIRED_FIELD, "A supplier is required before posting a payment.")
    counterparty = db_session.execute(
        select(FinanceCounterparty)
        .where(
            FinanceCounterparty.id == counterparty_id,
            FinanceCounterparty.company_id == company_id,
        )
        .with_for_update()
    ).scalar_one_or_none()
    if counterparty is None:
        raise SupplierPaymentError(REFERENCE_NOT_IN_COMPANY, "Supplier was not found in this company.")
    if counterparty.counterparty_type != "supplier":
        raise SupplierPaymentError(REQUIRED_FIELD, "Supplier payment requires a supplier counterparty.")


def _lock_payment(db_session: Session, company_id: uuid.UUID, payment_id: uuid.UUID) -> FinanceSupplierPayment:
    payment = db_session.execute(
        select(FinanceSupplierPayment)
        .where(
            FinanceSupplierPayment.id == payment_id,
            FinanceSupplierPayment.company_id == company_id,
        )
        .with_for_update()
    ).scalar_one_or_none()
    if payment is None:
        raise SupplierPaymentError(PAYMENT_NOT_FOUND, "Supplier payment was not found.")
    return payment


def _lock_draft(db_session: Session, company_id: uuid.UUID, payment_id: uuid.UUID) -> FinanceSupplierPayment:
    payment = _lock_payment(db_session, company_id, payment_id)
    if payment.status != "draft":
        raise SupplierPaymentError(IMMUTABLE_PAYMENT, "A posted supplier payment cannot be changed.")
    return payment


def _load_payment(db_session: Session, company_id: uuid.UUID, payment_id: uuid.UUID) -> FinanceSupplierPayment:
    payment = db_session.execute(
        select(FinanceSupplierPayment)
        .where(
            FinanceSupplierPayment.id == payment_id,
            FinanceSupplierPayment.company_id == company_id,
        )
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if payment is None:
        raise SupplierPaymentError(PAYMENT_NOT_FOUND, "Supplier payment was not found.")
    return payment


def _load_allocation(
    db_session: Session,
    company_id: uuid.UUID,
    allocation_id: uuid.UUID,
) -> FinanceSupplierPaymentAllocation:
    allocation = db_session.execute(
        select(FinanceSupplierPaymentAllocation).where(
            FinanceSupplierPaymentAllocation.id == allocation_id,
            FinanceSupplierPaymentAllocation.company_id == company_id,
        )
    ).scalar_one_or_none()
    if allocation is None:
        raise SupplierPaymentError(ALLOCATION_NOT_FOUND, "Supplier payment allocation was not found.")
    return allocation


def _lock_allocation(
    db_session: Session,
    company_id: uuid.UUID,
    allocation_id: uuid.UUID,
) -> FinanceSupplierPaymentAllocation:
    allocation = db_session.execute(
        select(FinanceSupplierPaymentAllocation)
        .where(
            FinanceSupplierPaymentAllocation.id == allocation_id,
            FinanceSupplierPaymentAllocation.company_id == company_id,
        )
        .with_for_update()
    ).scalar_one_or_none()
    if allocation is None:
        raise SupplierPaymentError(ALLOCATION_NOT_FOUND, "Supplier payment allocation was not found.")
    return allocation


def _lock_documents(
    db_session: Session,
    company_id: uuid.UUID,
    document_ids: list[uuid.UUID],
) -> dict[uuid.UUID, FinanceCostDocument]:
    rows = db_session.execute(
        select(FinanceCostDocument)
        .where(
            FinanceCostDocument.company_id == company_id,
            FinanceCostDocument.id.in_(document_ids),
        )
        .order_by(FinanceCostDocument.id)
        .with_for_update()
    ).scalars()
    found = {row.id: row for row in rows}
    missing = [document_id for document_id in document_ids if document_id not in found]
    if missing:
        raise SupplierPaymentError(
            REFERENCE_NOT_IN_COMPANY,
            "Supplier document was not found in this company.",
        )
    return found


def _load_document(db_session: Session, company_id: uuid.UUID, document_id: uuid.UUID) -> FinanceCostDocument:
    document = db_session.execute(
        select(FinanceCostDocument).where(
            FinanceCostDocument.id == document_id,
            FinanceCostDocument.company_id == company_id,
        )
    ).scalar_one_or_none()
    if document is None:
        raise SupplierPaymentError(DOCUMENT_NOT_FOUND, "Supplier document was not found.")
    return document


def _lock_payment_allocations(db_session: Session, payment_id: uuid.UUID) -> None:
    db_session.execute(
        select(FinanceSupplierPaymentAllocation.id)
        .where(FinanceSupplierPaymentAllocation.payment_id == payment_id)
        .order_by(FinanceSupplierPaymentAllocation.id)
        .with_for_update()
    ).all()


def _lock_document_allocations(db_session: Session, document_id: uuid.UUID) -> None:
    db_session.execute(
        select(FinanceSupplierPaymentAllocation.id)
        .where(FinanceSupplierPaymentAllocation.cost_document_id == document_id)
        .order_by(FinanceSupplierPaymentAllocation.id)
        .with_for_update()
    ).all()


def _next_allocation_number(db_session: Session, payment_id: uuid.UUID) -> int:
    current = db_session.scalar(
        select(func.max(FinanceSupplierPaymentAllocation.allocation_number)).where(
            FinanceSupplierPaymentAllocation.payment_id == payment_id
        )
    )
    return int(current or 0) + 1


def _document_outstanding(db_session: Session, document_id: uuid.UUID) -> Decimal:
    liability = _money_function(db_session, "finance_supplier_gross_liability", document_id)
    allocated = _money_function(db_session, "finance_supplier_allocated_to_document", document_id)
    return liability - allocated


def _money_function(db_session: Session, function_name: str, row_id: uuid.UUID) -> Decimal:
    if function_name not in {
        "finance_supplier_gross_liability",
        "finance_supplier_allocated_to_document",
        "finance_supplier_allocated_from_payment",
        "finance_supplier_payment_available",
    }:
        raise SupplierPaymentError(DATABASE_REJECTED, "Supplier balance function is not available.")
    value = db_session.execute(text(f"SELECT {function_name}(:row_id)"), {"row_id": row_id}).scalar_one()
    return Decimal(value)


def _allocations_for(db_session: Session, payment_id: uuid.UUID) -> list[FinanceSupplierPaymentAllocation]:
    return list(
        db_session.execute(
            select(FinanceSupplierPaymentAllocation)
            .where(FinanceSupplierPaymentAllocation.payment_id == payment_id)
            .order_by(FinanceSupplierPaymentAllocation.allocation_number)
            .execution_options(populate_existing=True)
        ).scalars()
    )


def _posted_payment_reversal(
    db_session: Session,
    payment_id: uuid.UUID,
) -> FinanceSupplierPaymentReversal | None:
    return db_session.execute(
        select(FinanceSupplierPaymentReversal).where(
            FinanceSupplierPaymentReversal.payment_id == payment_id,
            FinanceSupplierPaymentReversal.status == "posted",
        )
    ).scalar_one_or_none()


def _payment_reversal(db_session: Session, payment_id: uuid.UUID) -> FinanceSupplierPaymentReversal | None:
    return db_session.execute(
        select(FinanceSupplierPaymentReversal).where(FinanceSupplierPaymentReversal.payment_id == payment_id)
    ).scalar_one_or_none()


def _allocation_reversal(
    db_session: Session,
    allocation_id: uuid.UUID,
) -> FinanceSupplierPaymentAllocationReversal | None:
    return db_session.execute(
        select(FinanceSupplierPaymentAllocationReversal).where(
            FinanceSupplierPaymentAllocationReversal.allocation_id == allocation_id
        )
    ).scalar_one_or_none()


def _reversed_allocation_ids(db_session: Session, allocation_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not allocation_ids:
        return set()
    rows = db_session.execute(
        select(FinanceSupplierPaymentAllocationReversal.allocation_id).where(
            FinanceSupplierPaymentAllocationReversal.allocation_id.in_(allocation_ids),
            FinanceSupplierPaymentAllocationReversal.status == "posted",
        )
    ).scalars()
    return set(rows)


def _effective_cost_document_ids_for_payment(db_session: Session, payment_id: uuid.UUID) -> set[uuid.UUID]:
    """Invoices with a posted allocation from this payment that is not allocation-reversed.

    Matches the effective-allocation definition used by D4 balance functions
    (excluding allocation reversals). Payment-level reversal already blocks new
    allocations before this helper runs.
    """
    allocations = list(
        db_session.execute(
            select(FinanceSupplierPaymentAllocation).where(
                FinanceSupplierPaymentAllocation.payment_id == payment_id,
                FinanceSupplierPaymentAllocation.status == "posted",
            )
        ).scalars()
    )
    reversed_ids = _reversed_allocation_ids(db_session, [row.id for row in allocations])
    return {row.cost_document_id for row in allocations if row.id not in reversed_ids}


def _view(db_session: Session, payment: FinanceSupplierPayment) -> SupplierPaymentView:
    allocations = _allocations_for(db_session, payment.id)
    reversed_ids = _reversed_allocation_ids(db_session, [row.id for row in allocations])
    outstanding_by_document = {
        row.cost_document_id: _document_outstanding(db_session, row.cost_document_id) for row in allocations
    }
    reversal = _payment_reversal(db_session, payment.id)
    return SupplierPaymentView(
        id=payment.id,
        company_id=payment.company_id,
        counterparty_id=payment.counterparty_id,
        status=payment.status,
        payment_date=payment.payment_date,
        payment_method=payment.payment_method,
        external_reference=payment.external_reference,
        normalized_reference=payment.normalized_reference,
        currency_code=payment.currency_code,
        amount=Decimal(payment.amount),
        allocated_amount=_money_function(db_session, "finance_supplier_allocated_from_payment", payment.id),
        available_amount=_money_function(db_session, "finance_supplier_payment_available", payment.id),
        notes=payment.notes,
        posted_at=payment.posted_at,
        allocations=[
            AllocationView(
                id=row.id,
                payment_id=row.payment_id,
                cost_document_id=row.cost_document_id,
                allocation_number=row.allocation_number,
                status=row.status,
                amount=Decimal(row.amount),
                reversed=row.id in reversed_ids,
                document_outstanding_amount=outstanding_by_document[row.cost_document_id],
            )
            for row in allocations
        ],
        reversal=None
        if reversal is None
        else SupplierPaymentReversalView(
            id=reversal.id,
            payment_id=reversal.payment_id,
            status=reversal.status,
            amount=Decimal(reversal.amount),
            reason=reversal.reason,
        ),
    )


def _audit(
    db_session: Session,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    entity_type: str,
    entity_id: uuid.UUID,
    action: str,
    reason: str,
    after_json: dict[str, object] | None = None,
) -> None:
    db_session.add(
        FinanceAuditEvent(
            id=uuid.uuid4(),
            company_id=company_id,
            actor_user_id=actor_user_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            reason=reason,
            after_json=after_json,
        )
    )


def _flush(db_session: Session) -> None:
    savepoint = db_session.begin_nested()
    try:
        db_session.flush()
        db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
        savepoint.commit()
    except DBAPIError as exc:
        savepoint.rollback()
        db_session.expire_all()
        raise _from_database(exc) from exc


def _from_database(exc: DBAPIError) -> SupplierPaymentError:
    primary = ""
    constraint = ""
    diagnostic = getattr(getattr(exc, "orig", None), "diag", None)
    if diagnostic is not None:
        primary = str(getattr(diagnostic, "message_primary", "") or "")
        constraint = str(getattr(diagnostic, "constraint_name", "") or "")
    if constraint == "uq_finance_supplier_payments_posted_reference":
        return SupplierPaymentError(DUPLICATE_REFERENCE, "That posted supplier payment reference already exists.")
    if constraint in {
        "uq_finance_supplier_payment_reversals_payment",
        "uq_finance_supplier_payment_allocation_reversals_allocation",
    }:
        return SupplierPaymentError(DUPLICATE_REVERSAL, "This supplier payment record already has a reversal.")
    mapped = _SAFE_DATABASE_MESSAGES.get(primary)
    if mapped is not None:
        return SupplierPaymentError(mapped[0], mapped[1])
    return SupplierPaymentError(DATABASE_REJECTED, "The supplier payment was rejected by the settlement rules.")


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.strip().split())
    return cleaned or None
