"""Invoice payment recording and reversal for budget customer billing."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import User
from app.modules.budgets.billing import MONEY_QUANT, _load_invoice, _money
from app.modules.budgets.models import BudgetCustomerInvoice, BudgetInvoicePayment
from app.modules.budgets.repository import (
    get_invoice_payment,
    get_invoice_payment_by_client_action_id,
    list_payments_for_invoice,
    lock_customer_invoice_for_update,
    save_payment,
    sum_active_payments_for_invoice,
)
from app.modules.budgets.schemas import (
    PaymentCreateRequest,
    PaymentResponse,
    PaymentReverseRequest,
)


def active_payments_total(db_session: Session, invoice_id: uuid.UUID) -> Decimal:
    return _money(sum_active_payments_for_invoice(db_session, invoice_id))


def derive_display_status(
    invoice: BudgetCustomerInvoice,
    today_local: date,
    payments_received: Decimal,
) -> str:
    """Display status precedence: draft → void → paid → part_paid → overdue → issued."""
    if invoice.status == "draft":
        return "draft"
    if invoice.status == "void":
        return "void"
    if invoice.status != "issued":
        return invoice.status

    gross = _money(invoice.gross_amount)
    received = _money(payments_received)
    outstanding = (gross - received).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)

    if received == gross:
        return "paid"
    if Decimal("0.00") < received < gross:
        return "part_paid"
    if outstanding > Decimal("0.00") and invoice.due_date is not None and invoice.due_date < today_local:
        return "overdue"
    return "issued"


def _payment_response(
    db_session: Session,
    payment: BudgetInvoicePayment,
) -> PaymentResponse:
    created_by_display: str | None = None
    if payment.created_by_user_id is not None:
        creator = db_session.get(User, payment.created_by_user_id)
        if creator is not None:
            created_by_display = creator.email
    return PaymentResponse(
        id=payment.id,
        company_id=payment.company_id,
        budget_id=payment.budget_id,
        invoice_id=payment.invoice_id,
        client_action_id=payment.client_action_id,
        payment_date=payment.payment_date,
        amount=_money(payment.amount),
        currency=payment.currency,
        payment_method=payment.payment_method,
        reference=payment.reference,
        notes=payment.notes,
        created_by_user_id=payment.created_by_user_id,
        created_by_display=created_by_display,
        created_at=payment.created_at,
        reversed_at=payment.reversed_at,
        reversed_by_user_id=payment.reversed_by_user_id,
        reversal_reason=payment.reversal_reason,
        is_reversed=payment.reversed_at is not None,
    )


def list_payments(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
) -> list[PaymentResponse]:
    _project, invoice = _load_invoice(db_session, actor, budget_id, invoice_id)
    rows = list_payments_for_invoice(db_session, invoice.id)
    return [_payment_response(db_session, row) for row in rows]


def create_payment(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    body: PaymentCreateRequest,
) -> PaymentResponse:
    project, invoice = _load_invoice(db_session, actor, budget_id, invoice_id)

    existing = get_invoice_payment_by_client_action_id(
        db_session,
        company_id=project.company_id,
        client_action_id=body.client_action_id,
    )
    if existing is not None:
        if existing.invoice_id != invoice.id or existing.budget_id != budget_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="client_action_id already used for another payment.",
            )
        return _payment_response(db_session, existing)

    if invoice.status != "issued":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Payments can only be recorded against issued invoices.",
        )

    locked = lock_customer_invoice_for_update(db_session, invoice.id)
    if locked is None or locked.status != "issued":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Payments can only be recorded against issued invoices.",
        )

    amount = _money(body.amount)
    if amount <= Decimal("0.00"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Payment amount must be greater than zero.",
        )

    currency = (body.currency or locked.currency).strip().upper()
    if currency != (locked.currency or "").strip().upper():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Payment currency must match the invoice currency.",
        )

    received = active_payments_total(db_session, locked.id)
    gross = _money(locked.gross_amount)
    outstanding = _money(gross - received)
    if amount > outstanding:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Payment exceeds the invoice outstanding balance.",
        )

    row = BudgetInvoicePayment(
        company_id=project.company_id,
        budget_id=project.id,
        invoice_id=locked.id,
        client_action_id=body.client_action_id,
        payment_date=body.payment_date,
        amount=float(amount),
        currency=currency,
        payment_method=body.payment_method,
        reference=body.reference,
        notes=body.notes,
        created_by_user_id=actor.id,
    )
    save_payment(db_session, row, commit=False)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.invoice_payment_recorded",
        entity_type="budget_invoice_payment",
        entity_id=str(row.id),
        company_id=project.company_id,
        details={
            "budget_id": str(project.id),
            "invoice_id": str(locked.id),
            "payment_id": str(row.id),
            "client_action_id": str(body.client_action_id),
            "amount": str(amount),
            "currency": currency,
            "payment_method": body.payment_method,
            "payment_date": body.payment_date.isoformat(),
        },
        commit=False,
    )
    db_session.commit()
    db_session.refresh(row)
    return _payment_response(db_session, row)


def reverse_payment(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    payment_id: uuid.UUID,
    body: PaymentReverseRequest,
) -> PaymentResponse:
    project, invoice = _load_invoice(db_session, actor, budget_id, invoice_id)
    if not body.confirm:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="confirm must be true to reverse a payment.",
        )

    payment = get_invoice_payment(db_session, payment_id)
    if (
        payment is None
        or payment.invoice_id != invoice.id
        or payment.budget_id != budget_id
        or payment.company_id != project.company_id
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found.")

    if payment.reversed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Payment is already reversed.",
        )

    # Lock invoice so outstanding recalculation races with new payments stay consistent.
    lock_customer_invoice_for_update(db_session, invoice.id)

    now = datetime.now(timezone.utc)
    payment.reversed_at = now
    payment.reversed_by_user_id = actor.id
    payment.reversal_reason = body.reason
    save_payment(db_session, payment, commit=False)
    create_internal_audit_event(
        db_session,
        actor,
        action="budget.invoice_payment_reversed",
        entity_type="budget_invoice_payment",
        entity_id=str(payment.id),
        company_id=project.company_id,
        details={
            "budget_id": str(project.id),
            "invoice_id": str(invoice.id),
            "payment_id": str(payment.id),
            "amount": str(_money(payment.amount)),
            "reason": body.reason,
        },
        commit=False,
    )
    db_session.commit()
    db_session.refresh(payment)
    return _payment_response(db_session, payment)
