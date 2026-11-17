"""Finance ledger operations for CIS, PAYE, customers, and commercial records.

Payroll and PAYE source rows are read and never updated. Posted Finance rows
are inserted as drafts and then posted. This module does not commit.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.modules.finance.audit import record_finance_audit
from app.modules.finance.cost_register_rules import normalize_reference
from app.modules.paye_payroll.models import MonthlyPayeItem, MonthlyPayePeriod
from app.modules.payroll.calculation import normalize_payroll_payment_mode
from app.modules.payroll.models import PayrollItem, PayrollPeriod
from app.modules.payroll.service import _effective_net_amount_for_item, _effective_tax_amount_for_item

MONEY = Decimal("0.0001")


class FinanceLedgerError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def _money(value: Decimal | str | None) -> Decimal | None:
    if value is None:
        return None
    decimal_value = value if isinstance(value, Decimal) else Decimal(str(value))
    return decimal_value.quantize(MONEY)


def _required_money(value: Decimal | str) -> Decimal:
    money = _money(value)
    if money is None:
        raise FinanceLedgerError("INVALID_AMOUNT", "A money amount is required.")
    return money


def _hash(parts: list[object]) -> str:
    payload = "|".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _flush(db_session: Session) -> None:
    savepoint = db_session.begin_nested()
    try:
        db_session.flush()
        db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
        savepoint.commit()
    except DBAPIError as exc:
        savepoint.rollback()
        db_session.expire_all()
        primary = ""
        diagnostic = getattr(getattr(exc, "orig", None), "diag", None)
        constraint = ""
        if diagnostic is not None:
            primary = str(getattr(diagnostic, "message_primary", "") or "")
            constraint = str(getattr(diagnostic, "constraint_name", "") or "")
        if constraint == "uq_finance_posted_customer_invoice_ref":
            raise FinanceLedgerError(
                "DUPLICATE_REFERENCE",
                "This customer already has a posted invoice with this reference. The existing invoice was not changed.",
            ) from exc
        raise FinanceLedgerError("DATABASE_REJECTED", primary or "The finance record was rejected.") from exc


def _post_row(db_session: Session, table: str, row_id: uuid.UUID, actor_user_id: uuid.UUID | None) -> None:
    db_session.execute(
        text(
            f"UPDATE {table} SET status = 'posted', posted_at = now(), posted_by_user_id = :actor, "
            "updated_at = now() WHERE id = :id AND status = 'draft'"
        ),
        {"id": row_id, "actor": actor_user_id},
    )
    _flush(db_session)


def cis_snapshot_from_source(item: PayrollItem, period: PayrollPeriod) -> dict[str, object]:
    """Copy effective CIS figures using the existing payroll server rules."""
    if item.status not in {"approved", "paid"}:
        raise FinanceLedgerError("SOURCE_NOT_READY", "Only an approved or paid CIS row can be snapshotted.")
    if item.rate_missing or item.gross_amount is None:
        raise FinanceLedgerError("SOURCE_NOT_READY", "The CIS row has no usable gross amount.")
    mode = normalize_payroll_payment_mode(item.payment_mode)
    gross = _required_money(Decimal(str(item.gross_amount)))
    other = _required_money(Decimal(str(item.other_deductions_amount or 0)))
    effective_cis = _effective_tax_amount_for_item(item)
    effective_net = _effective_net_amount_for_item(item)
    if effective_cis is None or effective_net is None:
        raise FinanceLedgerError("SOURCE_NOT_READY", "The CIS row has no effective tax or net amount.")
    cis = _required_money(effective_cis)
    payable = _required_money(effective_net)
    expected = (gross - cis - other).quantize(MONEY)
    source_hash = _hash(
        [
            item.id,
            period.id,
            item.user_id,
            item.company_id,
            period.week_start.isoformat(),
            gross,
            item.tax_amount,
            item.net_amount,
            item.display_tax_amount,
            item.display_net_amount,
            other,
            mode,
            item.status,
            item.updated_at.isoformat() if item.updated_at else "",
        ]
    )
    return {
        "source_payroll_item_id": item.id,
        "source_payroll_period_id": period.id,
        "source_user_id": item.user_id,
        "company_id": item.company_id,
        "week_start": period.week_start,
        "timezone_name": period.timezone_name,
        "gross_amount": gross,
        "tax_amount": _money(Decimal(str(item.tax_amount))) if item.tax_amount is not None else None,
        "net_amount": _money(Decimal(str(item.net_amount))) if item.net_amount is not None else None,
        "display_tax_amount": _money(Decimal(str(item.display_tax_amount))) if item.display_tax_amount is not None else None,
        "display_net_amount": _money(Decimal(str(item.display_net_amount))) if item.display_net_amount is not None else None,
        "other_deductions_amount": other,
        "payment_mode": mode,
        "effective_cis_deduction": cis,
        "effective_payable_amount": payable,
        "amounts_do_not_reconcile": expected != payable,
        "source_status": item.status,
        "source_approved_at": item.approved_at,
        "source_paid_at": item.paid_at,
        "source_updated_at": item.updated_at,
        "source_hash": source_hash,
    }


def import_cis_snapshot(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    payroll_item_id: uuid.UUID,
    correct: bool = False,
) -> dict[str, object]:
    item = db_session.get(PayrollItem, payroll_item_id)
    if item is None or item.company_id != company_id:
        raise FinanceLedgerError("SOURCE_NOT_FOUND", "CIS payroll item was not found in this company.")
    period = db_session.get(PayrollPeriod, item.period_id)
    if period is None or period.company_id != company_id:
        raise FinanceLedgerError("SOURCE_NOT_FOUND", "CIS payroll period was not found in this company.")
    payload = cis_snapshot_from_source(item, period)
    tail = _cis_tail(db_session, company_id, payroll_item_id)
    if tail is not None and tail["source_hash"] == payload["source_hash"]:
        return _cis_obligation(db_session, company_id, payroll_item_id)
    if tail is not None and not correct:
        raise FinanceLedgerError(
            "SOURCE_CHANGED",
            "The CIS source changed after the snapshot. Record an explicit correction.",
        )
    revision = 1 if tail is None else int(tail["revision_number"]) + 1
    supersedes = None if tail is None else tail["id"]
    snapshot_id = uuid.uuid4()
    db_session.execute(
        text(
            "INSERT INTO finance_cis_payroll_snapshots ("
            "id, company_id, source_payroll_item_id, source_payroll_period_id, source_user_id, "
            "week_start, timezone_name, supersedes_snapshot_id, revision_number, gross_amount, tax_amount, "
            "net_amount, display_tax_amount, display_net_amount, other_deductions_amount, payment_mode, "
            "effective_cis_deduction, effective_payable_amount, amounts_do_not_reconcile, source_status, "
            "source_approved_at, source_paid_at, source_updated_at, source_hash, status, created_by_user_id, "
            "created_at, updated_at"
            ") VALUES ("
            ":id, :company_id, :source_payroll_item_id, :source_payroll_period_id, :source_user_id, "
            ":week_start, :timezone_name, :supersedes, :revision, :gross_amount, :tax_amount, :net_amount, "
            ":display_tax_amount, :display_net_amount, :other_deductions_amount, :payment_mode, "
            ":effective_cis_deduction, :effective_payable_amount, :amounts_do_not_reconcile, :source_status, "
            ":source_approved_at, :source_paid_at, :source_updated_at, :source_hash, 'draft', :actor, now(), now())"
        ),
        {**payload, "id": snapshot_id, "supersedes": supersedes, "revision": revision, "actor": actor_user_id},
    )
    _flush(db_session)
    _post_row(db_session, "finance_cis_payroll_snapshots", snapshot_id, actor_user_id)
    record_finance_audit(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_cis_payroll_snapshot",
        entity_id=snapshot_id,
        action="cis_snapshot_imported",
        reason="CIS payroll snapshot imported. Operational payroll was not changed.",
        after={"source_payroll_item_id": str(payroll_item_id)},
    )
    return _cis_obligation(db_session, company_id, payroll_item_id)


def _cis_tail(db_session: Session, company_id: uuid.UUID, source_item_id: uuid.UUID) -> dict[str, object] | None:
    row = db_session.execute(
        text(
            "SELECT id, revision_number, source_hash, effective_payable_amount, effective_cis_deduction, "
            "gross_amount, source_status, source_paid_at, source_user_id, week_start, payment_mode, "
            "amounts_do_not_reconcile "
            "FROM finance_cis_payroll_snapshots snapshot "
            "WHERE company_id = :company_id AND source_payroll_item_id = :source_item AND status = 'posted' "
            "AND NOT EXISTS ("
            "SELECT 1 FROM finance_cis_payroll_snapshots child "
            "WHERE child.supersedes_snapshot_id = snapshot.id AND child.status = 'posted')"
        ),
        {"company_id": company_id, "source_item": source_item_id},
    ).mappings().first()
    return dict(row) if row else None


def _cis_obligation(db_session: Session, company_id: uuid.UUID, source_item_id: uuid.UUID) -> dict[str, object]:
    tail = _cis_tail(db_session, company_id, source_item_id)
    if tail is None:
        raise FinanceLedgerError("OBLIGATION_NOT_FOUND", "CIS obligation was not found.")
    allocated = db_session.execute(
        text("SELECT finance_cis_allocated(:source_item)"),
        {"source_item": source_item_id},
    ).scalar_one()
    payable = Decimal(str(tail["effective_payable_amount"]))
    bank_allocated = Decimal(str(allocated))
    outstanding = payable - bank_allocated
    return {
        **tail,
        "bank_allocated": bank_allocated,
        "outstanding": outstanding,
        "still_owed": outstanding if outstanding > 0 else Decimal("0"),
        "overpaid": -outstanding if outstanding < 0 else Decimal("0"),
        "source_paid_is_bank_evidence": False,
    }


def list_cis_obligations(db_session: Session, *, company_id: uuid.UUID) -> list[dict[str, object]]:
    rows = db_session.execute(
        text(
            "SELECT source_payroll_item_id FROM finance_cis_payroll_snapshots "
            "WHERE company_id = :company_id AND status = 'posted' AND supersedes_snapshot_id IS NULL"
        ),
        {"company_id": company_id},
    ).scalars()
    return [_cis_obligation(db_session, company_id, source_id) for source_id in rows]


def create_worker_payment(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    source_user_id: uuid.UUID,
    amount: Decimal,
    payment_date: date,
    payment_method: str | None,
    external_reference: str | None,
    notes: str | None,
) -> uuid.UUID:
    payment_id = uuid.uuid4()
    db_session.execute(
        text(
            "INSERT INTO finance_worker_payments ("
            "id, company_id, source_user_id, payment_date, payment_method, external_reference, "
            "normalized_reference, currency_code, amount, notes, status, created_by_user_id, created_at, updated_at"
            ") VALUES ("
            ":id, :company_id, :source_user_id, :payment_date, :payment_method, :external_reference, "
            ":normalized_reference, 'GBP', :amount, :notes, 'draft', :actor, now(), now())"
        ),
        {
            "id": payment_id,
            "company_id": company_id,
            "source_user_id": source_user_id,
            "payment_date": payment_date,
            "payment_method": payment_method,
            "external_reference": external_reference,
            "normalized_reference": normalize_reference(external_reference),
            "amount": _required_money(amount),
            "notes": notes,
            "actor": actor_user_id,
        },
    )
    _flush(db_session)
    _post_row(db_session, "finance_worker_payments", payment_id, actor_user_id)
    record_finance_audit(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_worker_payment",
        entity_id=payment_id,
        action="worker_payment_posted",
        reason="Worker bank payment posted. This is not a payroll Mark Paid action.",
        after={"amount": str(_required_money(amount))},
    )
    return payment_id


def allocate_worker_payment(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    payment_id: uuid.UUID,
    allocations: list[dict[str, object]],
) -> None:
    if not allocations:
        raise FinanceLedgerError("REQUIRED_FIELD", "At least one allocation is required.")
    next_number = db_session.execute(
        text("SELECT COALESCE(MAX(allocation_number), 0) FROM finance_worker_payment_allocations WHERE payment_id = :id"),
        {"id": payment_id},
    ).scalar_one()
    savepoint = db_session.begin_nested()
    try:
        for offset, item in enumerate(allocations, start=1):
            allocation_id = uuid.uuid4()
            db_session.execute(
                text(
                    "INSERT INTO finance_worker_payment_allocations ("
                    "id, company_id, payment_id, cis_snapshot_id, paye_snapshot_id, allocation_number, amount, "
                    "status, created_by_user_id, created_at, updated_at"
                    ") VALUES ("
                    ":id, :company_id, :payment_id, :cis_snapshot_id, :paye_snapshot_id, :number, :amount, "
                    "'draft', :actor, now(), now())"
                ),
                {
                    "id": allocation_id,
                    "company_id": company_id,
                    "payment_id": payment_id,
                    "cis_snapshot_id": item.get("cis_snapshot_id"),
                    "paye_snapshot_id": item.get("paye_snapshot_id"),
                    "number": int(next_number) + offset,
                    "amount": _required_money(item["amount"]),  # type: ignore[arg-type]
                    "actor": actor_user_id,
                },
            )
            db_session.flush()
            db_session.execute(
                text(
                    "UPDATE finance_worker_payment_allocations SET status = 'posted', posted_at = now(), "
                    "posted_by_user_id = :actor, updated_at = now() WHERE id = :id"
                ),
                {"id": allocation_id, "actor": actor_user_id},
            )
            db_session.flush()
        db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
        savepoint.commit()
    except DBAPIError as exc:
        savepoint.rollback()
        db_session.expire_all()
        primary = ""
        diagnostic = getattr(getattr(exc, "orig", None), "diag", None)
        if diagnostic is not None:
            primary = str(getattr(diagnostic, "message_primary", "") or "")
        raise FinanceLedgerError("ALLOCATION_REJECTED", primary or "Worker allocation was rejected.") from exc
    record_finance_audit(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_worker_payment",
        entity_id=payment_id,
        action="worker_payment_allocated",
        reason="Worker payment allocated.",
        after={"allocation_count": str(len(allocations))},
    )


def paye_obligation(db_session: Session, *, company_id: uuid.UUID, source_item_id: uuid.UUID) -> dict[str, object]:
    tail = db_session.execute(
        text(
            "SELECT id, revision_number, source_hash, net_pay, employer_ni, employer_pension, source_status, source_paid_at "
            "FROM finance_paye_payroll_snapshots snapshot "
            "WHERE company_id = :company_id AND source_paye_item_id = :source_item AND status = 'posted' "
            "AND NOT EXISTS ("
            "SELECT 1 FROM finance_paye_payroll_snapshots child "
            "WHERE child.supersedes_snapshot_id = snapshot.id AND child.status = 'posted')"
        ),
        {"company_id": company_id, "source_item": source_item_id},
    ).mappings().first()
    if tail is None:
        raise FinanceLedgerError("OBLIGATION_NOT_FOUND", "PAYE obligation was not found.")
    allocated = Decimal(str(db_session.execute(
        text("SELECT finance_paye_allocated(:source_item)"),
        {"source_item": source_item_id},
    ).scalar_one()))
    payable = Decimal(str(tail["net_pay"]))
    outstanding = payable - allocated
    return {
        **dict(tail),
        "bank_allocated": allocated,
        "outstanding": outstanding,
        "still_owed": outstanding if outstanding > 0 else Decimal("0"),
        "overpaid": -outstanding if outstanding < 0 else Decimal("0"),
        "employer_cost": Decimal(str(tail["employer_ni"])) + Decimal(str(tail["employer_pension"])),
    }


def import_paye_snapshot(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    paye_item_id: uuid.UUID,
    correct: bool = False,
) -> uuid.UUID:
    item = db_session.get(MonthlyPayeItem, paye_item_id)
    if item is None or item.company_id != company_id:
        raise FinanceLedgerError("SOURCE_NOT_FOUND", "PAYE item was not found in this company.")
    if item.status not in {"approved", "paid"}:
        raise FinanceLedgerError("SOURCE_NOT_READY", "Only an approved or paid PAYE row can be snapshotted.")
    period = db_session.get(MonthlyPayePeriod, item.period_id)
    if period is None:
        raise FinanceLedgerError("SOURCE_NOT_FOUND", "PAYE period was not found.")
    source_hash = _hash([item.id, item.updated_at.isoformat() if item.updated_at else "", item.net_pay, item.gross_pay, item.paye_tax])
    tail = db_session.execute(
        text(
            "SELECT id, revision_number, source_hash FROM finance_paye_payroll_snapshots snapshot "
            "WHERE company_id = :company_id AND source_paye_item_id = :item_id AND status = 'posted' "
            "AND NOT EXISTS (SELECT 1 FROM finance_paye_payroll_snapshots child "
            "WHERE child.supersedes_snapshot_id = snapshot.id AND child.status = 'posted')"
        ),
        {"company_id": company_id, "item_id": paye_item_id},
    ).mappings().first()
    if tail is not None and tail["source_hash"] == source_hash:
        return tail["id"]
    if tail is not None and not correct:
        raise FinanceLedgerError("SOURCE_CHANGED", "The PAYE source changed after the snapshot. Record an explicit correction.")
    revision = 1 if tail is None else int(tail["revision_number"]) + 1
    supersedes = None if tail is None else tail["id"]
    snapshot_id = uuid.uuid4()
    db_session.execute(
        text(
            "INSERT INTO finance_paye_payroll_snapshots ("
            "id, company_id, source_paye_item_id, source_paye_period_id, source_user_id, tax_year, tax_month, "
            "supersedes_snapshot_id, revision_number, gross_pay, paye_tax, employee_ni, employer_ni, "
            "employee_pension, employer_pension, student_loan, postgraduate_loan, other_deductions, net_pay, "
            "source_status, source_paid_at, source_updated_at, source_hash, status, created_by_user_id, "
            "created_at, updated_at"
            ") VALUES ("
            ":id, :company_id, :item_id, :period_id, :user_id, :tax_year, :tax_month, :supersedes, :revision, "
            ":gross_pay, :paye_tax, :employee_ni, :employer_ni, :employee_pension, :employer_pension, "
            ":student_loan, :postgraduate_loan, :other_deductions, :net_pay, :source_status, :source_paid_at, "
            ":source_updated_at, :source_hash, 'draft', :actor, now(), now())"
        ),
        {
            "id": snapshot_id,
            "company_id": company_id,
            "item_id": item.id,
            "period_id": period.id,
            "user_id": item.user_id,
            "tax_year": period.tax_year,
            "tax_month": period.tax_month,
            "gross_pay": _money(item.gross_pay) or Decimal("0"),
            "paye_tax": _money(item.paye_tax) or Decimal("0"),
            "employee_ni": _money(item.employee_ni) or Decimal("0"),
            "employer_ni": _money(item.employer_ni) or Decimal("0"),
            "employee_pension": _money(item.employee_pension) or Decimal("0"),
            "employer_pension": _money(item.employer_pension) or Decimal("0"),
            "student_loan": _money(item.student_loan) or Decimal("0"),
            "postgraduate_loan": _money(item.postgraduate_loan_deduction) or Decimal("0"),
            "other_deductions": _money(item.other_deductions) or Decimal("0"),
            "net_pay": _money(item.net_pay) or Decimal("0"),
            "source_status": item.status,
            "source_paid_at": item.paid_at,
            "source_updated_at": item.updated_at or datetime.now(timezone.utc),
            "source_hash": source_hash,
            "actor": actor_user_id,
            "supersedes": supersedes,
            "revision": revision,
        },
    )
    _flush(db_session)
    _post_row(db_session, "finance_paye_payroll_snapshots", snapshot_id, actor_user_id)
    record_finance_audit(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_paye_payroll_snapshot",
        entity_id=snapshot_id,
        action="paye_snapshot_imported",
        reason="PAYE payroll snapshot imported. Operational payroll was not changed.",
        after={"source_paye_item_id": str(paye_item_id)},
    )
    return snapshot_id


def create_customer_invoice(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    counterparty_id: uuid.UUID,
    project_id: uuid.UUID | None,
    document_kind: str,
    external_reference: str | None,
    document_date: date | None,
    due_date: date | None,
    lines: list[dict[str, object]],
    credits_invoice_id: uuid.UUID | None = None,
    reverses_invoice_id: uuid.UUID | None = None,
) -> uuid.UUID:
    if not lines:
        raise FinanceLedgerError("REQUIRED_FIELD", "A customer invoice needs at least one line.")
    if document_kind == "invoice":
        if not (external_reference or "").strip():
            raise FinanceLedgerError("REQUIRED_FIELD", "A new customer invoice needs a reference.")
        if due_date is None:
            raise FinanceLedgerError("REQUIRED_FIELD", "A new customer invoice needs a due date.")
        normalized = normalize_reference(external_reference)
        existing = db_session.execute(
            text(
                "SELECT id FROM finance_customer_invoices "
                "WHERE company_id = :company_id AND counterparty_id = :counterparty_id "
                "AND document_kind = 'invoice' AND status = 'posted' "
                "AND normalized_reference = :normalized_reference "
                "LIMIT 1"
            ),
            {
                "company_id": company_id,
                "counterparty_id": counterparty_id,
                "normalized_reference": normalized,
            },
        ).first()
        if existing is not None:
            raise FinanceLedgerError(
                "DUPLICATE_REFERENCE",
                "This customer already has a posted invoice with this reference. The existing invoice was not changed.",
            )
    net = Decimal("0")
    tax = Decimal("0")
    for line in lines:
        net += _required_money(line["net_amount"])  # type: ignore[arg-type]
        tax += _required_money(line["tax_amount"])  # type: ignore[arg-type]
    invoice_id = uuid.uuid4()
    db_session.execute(
        text(
            "INSERT INTO finance_customer_invoices ("
            "id, company_id, counterparty_id, project_id, document_kind, external_reference, normalized_reference, "
            "document_date, due_date, currency_code, net_amount, tax_amount, gross_amount, reverses_invoice_id, "
            "credits_invoice_id, status, created_by_user_id, created_at, updated_at"
            ") VALUES ("
            ":id, :company_id, :counterparty_id, :project_id, :document_kind, :external_reference, :normalized_reference, "
            ":document_date, :due_date, 'GBP', :net_amount, :tax_amount, :gross_amount, :reverses_invoice_id, "
            ":credits_invoice_id, 'draft', :actor, now(), now())"
        ),
        {
            "id": invoice_id,
            "company_id": company_id,
            "counterparty_id": counterparty_id,
            "project_id": project_id,
            "document_kind": document_kind,
            "external_reference": external_reference,
            "normalized_reference": normalize_reference(external_reference),
            "document_date": document_date,
            "due_date": due_date,
            "net_amount": net,
            "tax_amount": tax,
            "gross_amount": net + tax,
            "reverses_invoice_id": reverses_invoice_id,
            "credits_invoice_id": credits_invoice_id,
            "actor": actor_user_id,
        },
    )
    for number, line in enumerate(lines, start=1):
        db_session.execute(
            text(
                "INSERT INTO finance_customer_invoice_lines ("
                "id, company_id, invoice_id, line_number, description, taxable, net_amount, tax_amount, created_at, updated_at"
                ") VALUES (:id, :company_id, :invoice_id, :line_number, :description, :taxable, :net_amount, :tax_amount, now(), now())"
            ),
            {
                "id": uuid.uuid4(),
                "company_id": company_id,
                "invoice_id": invoice_id,
                "line_number": number,
                "description": line.get("description"),
                "taxable": bool(line.get("taxable", True)),
                "net_amount": _required_money(line["net_amount"]),  # type: ignore[arg-type]
                "tax_amount": _required_money(line["tax_amount"]),  # type: ignore[arg-type]
            },
        )
    _flush(db_session)
    _post_row(db_session, "finance_customer_invoices", invoice_id, actor_user_id)
    record_finance_audit(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_customer_invoice",
        entity_id=invoice_id,
        action="customer_invoice_posted",
        reason="Customer invoice posted.",
        after={
            "document_kind": document_kind,
            "normalized_reference": normalize_reference(external_reference) or "",
            "gross_amount": str(net + tax),
        },
    )
    return invoice_id


def dashboard_totals(db_session: Session, *, company_id: uuid.UUID, project_id: uuid.UUID | None) -> dict[str, str]:
    project_filter = "AND project_id = :project_id" if project_id else ""
    params: dict[str, object] = {"company_id": company_id, "project_id": project_id}
    supplier_outstanding = db_session.execute(
        text(
            "SELECT COALESCE(SUM(finance_supplier_gross_liability(document.id) - "
            "finance_supplier_allocated_to_document(document.id)), 0) "
            "FROM finance_cost_documents document "
            "WHERE document.company_id = :company_id AND document.status = 'posted' "
            "AND document.document_type IN ('supplier_invoice', 'expense_receipt') "
            + ("AND EXISTS (SELECT 1 FROM finance_cost_lines line JOIN finance_cost_allocations allocation "
               "ON allocation.line_id = line.id WHERE line.document_id = document.id AND allocation.project_id = :project_id) "
               if project_id else "")
        ),
        params,
    ).scalar_one()
    customer_outstanding = db_session.execute(
        text(
            "SELECT COALESCE(SUM(finance_customer_invoice_outstanding(id)), 0) "
            "FROM finance_customer_invoices WHERE company_id = :company_id AND document_kind = 'invoice' "
            + project_filter
        ),
        params,
    ).scalar_one()
    approved_budget = db_session.execute(
        text(
            "SELECT COALESCE(SUM(line.amount_net), 0) FROM finance_budget_lines line "
            "JOIN finance_budget_versions version ON version.id = line.version_id "
            "WHERE version.company_id = :company_id AND version.status = 'approved' "
            + ("AND version.project_id = :project_id " if project_id else "")
        ),
        params,
    ).scalar_one()
    actual_cost = db_session.execute(
        text(
            "SELECT COALESCE(SUM(allocation.amount_eligible), 0) FROM finance_cost_allocations allocation "
            "JOIN finance_cost_lines line ON line.id = allocation.line_id "
            "JOIN finance_cost_documents document ON document.id = line.document_id "
            "WHERE document.company_id = :company_id AND document.status = 'posted' "
            + ("AND allocation.project_id = :project_id " if project_id else "")
        ),
        params,
    ).scalar_one()
    approved_variations = db_session.execute(
        text(
            "SELECT COALESCE(SUM(approved_value), 0) FROM finance_variations "
            "WHERE company_id = :company_id AND approval_status = 'approved' " + project_filter
        ),
        params,
    ).scalar_one()
    return {
        "approved_budget": str(approved_budget),
        "actual_eligible_cost": str(actual_cost),
        "supplier_outstanding": str(supplier_outstanding),
        "customer_outstanding": str(customer_outstanding),
        "approved_variation_value": str(approved_variations),
        "review_required_note": "Gross CIS deduction of zero is the source calculation, not an HMRC filing decision.",
    }
