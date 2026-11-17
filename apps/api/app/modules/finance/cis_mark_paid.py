"""Record one CIS bank transfer and the payroll status in a single commit.

The caller must already have passed integration_enabled(). This module does
not treat the user's confirmation as a bank-statement reconciliation.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.auth.models import User
from app.modules.audit.service import create_internal_audit_event
from app.modules.finance.audit import record_finance_audit
from app.modules.finance.cis_payment_contract import (
    CisObligation,
    RecordedTransfer,
    TransferRequest,
    plan_cis_transfer,
)
from app.modules.finance.cost_register_rules import normalize_reference
from app.modules.payroll.models import PayrollItem
from app.modules.payroll.repository import update_item

MONEY = Decimal("0.0001")


def _money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY)


def stable_idempotency_key(
    *,
    company_id: uuid.UUID,
    payroll_item_id: uuid.UUID,
    transfer_date: date,
    amount: Decimal,
    bank_reference: str,
) -> str:
    raw = "|".join(
        (
            str(company_id),
            str(payroll_item_id),
            transfer_date.isoformat(),
            str(_money(amount)),
            normalize_reference(bank_reference) or "",
        )
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def apply_cis_bank_transfer(
    db_session: Session,
    actor: User,
    item_id: uuid.UUID,
    *,
    amount: Decimal | None,
    transfer_date: date,
    bank_reference: str,
) -> PayrollItem:
    from app.modules.payroll.service import PayrollError, PayrollItemStateError

    if not (bank_reference or "").strip():
        raise PayrollError("Enter the bank reference for the transfer that was already made.")
    item = db_session.execute(select(PayrollItem).where(PayrollItem.id == item_id).with_for_update()).scalar_one_or_none()
    if item is None:
        raise PayrollError("Payroll item not found.")
    from app.modules.payroll.permissions import assert_payroll_admin_or_administrator, assert_payroll_company_scope

    assert_payroll_admin_or_administrator(actor)
    assert_payroll_company_scope(actor, item.company_id)
    snapshot = db_session.execute(
        text(
            """
            SELECT id, source_payroll_period_id, source_user_id, effective_payable_amount,
                   effective_cis_deduction, source_hash
            FROM finance_cis_payroll_snapshots snapshot
            WHERE snapshot.company_id = :company_id
              AND snapshot.source_payroll_item_id = :item_id
              AND snapshot.status = 'posted'
              AND NOT EXISTS (
                  SELECT 1 FROM finance_cis_payroll_snapshots child
                  WHERE child.supersedes_snapshot_id = snapshot.id AND child.status = 'posted'
              )
            FOR UPDATE
            """
        ),
        {"company_id": item.company_id, "item_id": item.id},
    ).one_or_none()
    if snapshot is None:
        raise PayrollError(
            "No posted CIS snapshot exists for this row. Payroll was not marked paid and no bank payment was recorded."
        )
    transfers = _recorded_transfers(db_session, item)
    if item.status == "paid":
        if transfers:
            return item
        raise PayrollError(
            "This payroll row is already Paid without a Finance bank payment. It must not be imported as a new transfer."
        )
    if item.status != "approved":
        raise PayrollItemStateError("Only approved rows can be marked paid.")
    if snapshot.source_user_id != item.user_id or snapshot.source_payroll_period_id != item.period_id:
        raise PayrollError("The CIS snapshot does not match this worker and payroll period.")
    obligation = CisObligation(
        company_id=item.company_id,
        worker_id=item.user_id,
        payroll_item_id=item.id,
        payroll_period_id=item.period_id,
        net_payable=_money(Decimal(snapshot.effective_payable_amount)),
        cis_withheld=_money(Decimal(snapshot.effective_cis_deduction)),
        payroll_status=item.status,
        source_hash=snapshot.source_hash,
    )
    paid_now = sum((transfer.amount for transfer in transfers if not transfer.reversed), Decimal("0"))
    remaining = _money(obligation.net_payable - _money(paid_now))
    transfer_amount = remaining if amount is None else _money(amount)
    idempotency_key = stable_idempotency_key(
        company_id=item.company_id,
        payroll_item_id=item.id,
        transfer_date=transfer_date,
        amount=transfer_amount,
        bank_reference=bank_reference,
    )
    decision = plan_cis_transfer(
        obligation,
        transfers,
        TransferRequest(
            idempotency_key=idempotency_key,
            company_id=item.company_id,
            worker_id=item.user_id,
            payroll_item_id=item.id,
            amount=None if amount is None else transfer_amount,
            bank_reference=bank_reference.strip(),
            transfer_date=transfer_date,
            origin="bank_transfer_confirmed_by_user",
        ),
        enabled=True,
        preview_readonly=False,
        snapshot_hash=snapshot.source_hash,
    )
    if decision.outcome in {"blocked", "conflict"}:
        raise PayrollError(decision.message)
    if decision.outcome == "already_recorded":
        return item
    if decision.outcome == "nothing_to_pay":
        return item
    if decision.outcome != "record_transfer" or decision.amount is None:
        raise PayrollError(decision.message)
    payment_id = uuid.uuid4()
    nested = db_session.begin_nested()
    try:
        db_session.execute(
            text(
                """
                INSERT INTO finance_worker_payments (
                    id, company_id, source_user_id, payment_date, payment_method, external_reference,
                    normalized_reference, currency_code, amount, notes, status, idempotency_key,
                    created_by_user_id, created_at, updated_at
                ) VALUES (
                    :id, :company_id, :worker_id, :payment_date, 'bank_transfer', :reference,
                    :normalized, 'GBP', :amount, :notes, 'draft', :idempotency_key,
                    :actor, now(), now()
                )
                """
            ),
            {
                "id": payment_id,
                "company_id": item.company_id,
                "worker_id": item.user_id,
                "payment_date": transfer_date,
                "reference": bank_reference.strip(),
                "normalized": normalize_reference(bank_reference),
                "amount": decision.amount,
                "notes": "User confirmed the bank transfer was already made. This is not bank-statement reconciliation.",
                "idempotency_key": idempotency_key,
                "actor": actor.id,
            },
        )
        db_session.execute(
            text("UPDATE finance_worker_payments SET status = 'posted', posted_at = now(), posted_by_user_id = :actor WHERE id = :id"),
            {"id": payment_id, "actor": actor.id},
        )
        allocation_id = uuid.uuid4()
        db_session.execute(
            text(
                """
                INSERT INTO finance_worker_payment_allocations (
                    id, company_id, payment_id, cis_snapshot_id, paye_snapshot_id, allocation_number, amount,
                    status, created_by_user_id, created_at, updated_at
                ) VALUES (
                    :id, :company_id, :payment_id, :snapshot_id, NULL, 1, :amount,
                    'draft', :actor, now(), now()
                )
                """
            ),
            {
                "id": allocation_id,
                "company_id": item.company_id,
                "payment_id": payment_id,
                "snapshot_id": snapshot.id,
                "amount": decision.amount,
                "actor": actor.id,
            },
        )
        db_session.execute(
            text(
                "UPDATE finance_worker_payment_allocations SET status = 'posted', posted_at = now(), "
                "posted_by_user_id = :actor WHERE id = :id"
            ),
            {"id": allocation_id, "actor": actor.id},
        )
        db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
        nested.commit()
    except IntegrityError as exc:
        nested.rollback()
        diagnostic = getattr(getattr(exc, "orig", None), "diag", None)
        constraint = str(getattr(diagnostic, "constraint_name", "") or "")
        if "uq_finance_worker_payment_idempotency" not in constraint and "uq_finance_worker_payment_idempotency" not in str(
            getattr(exc, "orig", exc)
        ):
            raise PayrollError("The bank transfer could not be recorded. Payroll was not marked paid.") from exc
        return item
    record_finance_audit(
        db_session,
        company_id=item.company_id,
        actor_user_id=actor.id,
        entity_type="finance_worker_payment",
        entity_id=payment_id,
        action="cis_transfer_recorded",
        reason="One confirmed bank transfer recorded against the CIS obligation. Not bank-statement reconciliation.",
        after={
            "amount": str(decision.amount),
            "bank_reference": bank_reference.strip(),
            "cis_withheld": str(obligation.cis_withheld),
            "creates_project_expense": "false",
            "remaining_after": str(decision.remaining_after),
            "user_confirmed_not_bank_reconciled": "true",
        },
    )
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="cis_bank_transfer_recorded",
        entity_type="payroll_item",
        entity_id=str(item.id),
        company_id=item.company_id,
        details={
            "payment_id": str(payment_id),
            "amount": str(decision.amount),
            "bank_reference": bank_reference.strip(),
            "transfer_date": transfer_date.isoformat(),
            "idempotency_key": idempotency_key,
            "creates_project_expense": False,
            "user_confirmed_not_bank_reconciled": True,
        },
        commit=False,
    )
    if decision.mark_payroll_paid:
        item.status = "paid"
        item.paid_at = datetime.now(timezone.utc)
        item.paid_by_user_id = actor.id
        update_item(db_session, item, commit=False)
        create_internal_audit_event(
            db_session=db_session,
            actor=actor,
            action="payroll_item_marked_paid",
            entity_type="payroll_item",
            entity_id=str(item.id),
            company_id=item.company_id,
            details={"payment_id": str(payment_id), "remaining_after": "0"},
            commit=False,
        )
        db_session.execute(
            text(
                """
                INSERT INTO finance_integration_outbox (id, company_id, kind, dedupe_key, payload, created_at)
                VALUES (:id, :company_id, 'payroll_paid_notice', :dedupe_key, CAST(:payload AS jsonb), now())
                """
            ),
            {
                "id": uuid.uuid4(),
                "company_id": item.company_id,
                "dedupe_key": f"payroll:paid:{item.id}:{item.user_id}",
                "payload": '{"kind":"payroll_paid"}',
            },
        )
    db_session.commit()
    if decision.mark_payroll_paid:
        _deliver_paid_notice(db_session, item)
    return item


def _recorded_transfers(db_session: Session, item: PayrollItem) -> tuple[RecordedTransfer, ...]:
    rows = db_session.execute(
        text(
            """
            SELECT payment.idempotency_key, payment.amount, payment.external_reference,
                   EXISTS (
                       SELECT 1 FROM finance_worker_payment_reversals reversal_row
                       WHERE reversal_row.payment_id = payment.id AND reversal_row.status = 'posted'
                   ) AS reversed
            FROM finance_worker_payments payment
            JOIN finance_worker_payment_allocations allocation
              ON allocation.payment_id = payment.id AND allocation.company_id = payment.company_id
            JOIN finance_cis_payroll_snapshots snapshot
              ON snapshot.id = allocation.cis_snapshot_id
            WHERE payment.company_id = :company_id
              AND snapshot.source_payroll_item_id = :item_id
              AND payment.status = 'posted'
              AND allocation.status = 'posted'
            """
        ),
        {"company_id": item.company_id, "item_id": item.id},
    ).all()
    return tuple(
        RecordedTransfer(
            idempotency_key=row.idempotency_key or "",
            company_id=item.company_id,
            worker_id=item.user_id,
            payroll_item_id=item.id,
            amount=_money(Decimal(row.amount)),
            bank_reference=row.external_reference or "",
            reversed=bool(row.reversed),
        )
        for row in rows
    )


def _deliver_paid_notice(db_session: Session, item: PayrollItem) -> None:
    from app.modules.notifications.events import record_payroll_paid

    try:
        record_payroll_paid(
            db_session,
            company_id=item.company_id,
            payroll_item_id=item.id,
            employee_user_id=item.user_id,
        )
        db_session.execute(
            text(
                """
                UPDATE finance_integration_outbox
                   SET delivered_at = now()
                 WHERE company_id = :company_id
                   AND dedupe_key = :dedupe_key
                   AND delivered_at IS NULL
                """
            ),
            {"company_id": item.company_id, "dedupe_key": f"payroll:paid:{item.id}:{item.user_id}"},
        )
        db_session.commit()
    except Exception:
        db_session.rollback()
