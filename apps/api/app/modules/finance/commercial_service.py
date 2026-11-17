"""Commercial Finance workflows on the installed f5 tables.

Services do not commit. Posted rows are inserted as drafts and then posted.
Original contract value is stored as one reviewed opening-balance row with
source reference contract:<project id>. It is not revenue and not a cost.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.modules.finance.audit import record_finance_audit
from app.modules.finance.cvr_as_of import compose_as_of_cvr
from app.modules.finance.cvr_forecast import MISSING, compose_cvr_forecast
from app.modules.finance.ledger_service import (
    FinanceLedgerError,
    _flush,
    _money,
    _post_row,
    _required_money,
)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.split())
    return cleaned or None


def _normalize_name(value: str) -> str:
    return " ".join(value.upper().split())


def _rows(result) -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    for row in result.mappings():
        item: dict[str, object] = {}
        for key, value in row.items():
            if isinstance(value, (Decimal, uuid.UUID, date, datetime)):
                item[key] = str(value)
            else:
                item[key] = value
        output.append(item)
    return output


def _insert(db_session: Session, statement: str, params: dict[str, object]) -> None:
    db_session.execute(text(statement), params)


def _event(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    entity_type: str,
    entity_id: uuid.UUID,
    action: str,
    reason: str,
    before: dict[str, str] | None = None,
    after: dict[str, str] | None = None,
) -> None:
    record_finance_audit(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        reason=reason,
        before=before,
        after=after,
    )
    _flush(db_session)


def list_projects(db_session: Session, *, company_id: uuid.UUID) -> list[dict[str, object]]:
    return _rows(
        db_session.execute(
            text(
                "SELECT id, name, reference_code, status, notes FROM finance_projects "
                "WHERE company_id = :company_id ORDER BY name"
            ),
            {"company_id": company_id},
        )
    )


def create_project(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    name: str,
    reference_code: str | None,
    contract_value_net: Decimal,
) -> uuid.UUID:
    project_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_projects (id, company_id, name, reference_code, status, created_by_user_id, created_at, updated_at) "
        "VALUES (:id, :company_id, :name, :reference_code, 'active', :actor, now(), now())",
        {
            "id": project_id,
            "company_id": company_id,
            "name": name.strip(),
            "reference_code": _clean(reference_code),
            "actor": actor_user_id,
        },
    )
    if contract_value_net < 0:
        raise FinanceLedgerError("INVALID_AMOUNT", "Original contract value cannot be negative.")
    set_contract_value(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        project_id=project_id,
        amount=contract_value_net,
        effective_date=date.today(),
    )
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_project",
        entity_id=project_id,
        action="project_created",
        reason="Project created.",
        after={"name": name.strip()},
    )
    return project_id


def list_cost_codes(db_session: Session, *, company_id: uuid.UUID) -> list[dict[str, object]]:
    return _rows(
        db_session.execute(
            text(
                "SELECT id, code, name, is_active FROM finance_cost_codes "
                "WHERE company_id = :company_id ORDER BY code"
            ),
            {"company_id": company_id},
        )
    )


def create_cost_code(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    code: str,
    name: str,
    actor_user_id: uuid.UUID | None = None,
) -> uuid.UUID:
    cost_code_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_cost_codes (id, company_id, code, name, is_active, created_at, updated_at) "
        "VALUES (:id, :company_id, :code, :name, true, now(), now())",
        {"id": cost_code_id, "company_id": company_id, "code": code.strip(), "name": name.strip()},
    )
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_cost_code",
        entity_id=cost_code_id,
        action="cost_code_created",
        reason="Cost code created.",
        after={"code": code.strip(), "name": name.strip()},
    )
    return cost_code_id


def list_counterparties(db_session: Session, *, company_id: uuid.UUID, counterparty_type: str | None) -> list[dict[str, object]]:
    return _rows(
        db_session.execute(
            text(
                "SELECT id, counterparty_type, name, is_active FROM finance_counterparties "
                "WHERE company_id = :company_id AND counterparty_type = COALESCE(:counterparty_type, counterparty_type) "
                "ORDER BY name"
            ),
            {"company_id": company_id, "counterparty_type": counterparty_type},
        )
    )


def create_counterparty(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    counterparty_type: str,
    name: str,
    actor_user_id: uuid.UUID | None = None,
) -> uuid.UUID:
    counterparty_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_counterparties (id, company_id, counterparty_type, name, normalized_name, is_active, created_at, updated_at) "
        "VALUES (:id, :company_id, :counterparty_type, :name, :normalized_name, true, now(), now())",
        {
            "id": counterparty_id,
            "company_id": company_id,
            "counterparty_type": counterparty_type,
            "name": name.strip(),
            "normalized_name": _normalize_name(name),
        },
    )
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_counterparty",
        entity_id=counterparty_id,
        action="counterparty_created",
        reason="Counterparty created.",
        after={"counterparty_type": counterparty_type, "name": name.strip()},
    )
    return counterparty_id


def create_budget(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    note: str | None,
    lines: list[dict[str, object]],
    actor_user_id: uuid.UUID | None = None,
) -> uuid.UUID:
    if not lines:
        raise FinanceLedgerError("REQUIRED_FIELD", "A budget version needs at least one line.")
    version_number = db_session.execute(
        text("SELECT COALESCE(MAX(version_number), 0) + 1 FROM finance_budget_versions WHERE project_id = :project_id"),
        {"project_id": project_id},
    ).scalar_one()
    version_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_budget_versions (id, company_id, project_id, version_number, status, note, created_at, updated_at) "
        "VALUES (:id, :company_id, :project_id, :version_number, 'draft', :note, now(), now())",
        {
            "id": version_id,
            "company_id": company_id,
            "project_id": project_id,
            "version_number": version_number,
            "note": note,
        },
    )
    for number, line in enumerate(lines, start=1):
        _insert(
            db_session,
            "INSERT INTO finance_budget_lines ("
            "id, company_id, version_id, line_number, item_reference, description, cost_code_id, amount_net, created_at, updated_at"
            ") VALUES (:id, :company_id, :version_id, :line_number, :item_reference, :description, :cost_code_id, :amount_net, now(), now())",
            {
                "id": uuid.uuid4(),
                "company_id": company_id,
                "version_id": version_id,
                "line_number": number,
                "item_reference": line.get("item_reference"),
                "description": line.get("description"),
                "cost_code_id": line["cost_code_id"],
                "amount_net": _required_money(line["amount_net"]),  # type: ignore[arg-type]
            },
        )
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_budget_version",
        entity_id=version_id,
        action="budget_saved",
        reason="Budget version saved.",
        after={"project_id": str(project_id), "status": "draft"},
    )
    return version_id


def approve_budget(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    version_id: uuid.UUID,
) -> None:
    """Approve one draft. The current approved budget stays until this draft is accepted."""
    project_id = db_session.execute(
        text(
            "SELECT project_id FROM finance_budget_versions "
            "WHERE id = :version_id AND company_id = :company_id"
        ),
        {"company_id": company_id, "version_id": version_id},
    ).scalar_one_or_none()
    if project_id is None:
        raise FinanceLedgerError("NOT_FOUND", "Budget version was not found.")
    locked_project = db_session.execute(
        text(
            "SELECT id FROM finance_projects "
            "WHERE id = :project_id AND company_id = :company_id FOR UPDATE"
        ),
        {"company_id": company_id, "project_id": project_id},
    ).scalar_one_or_none()
    if locked_project is None:
        raise FinanceLedgerError("NOT_FOUND", "Budget project was not found.")
    target = db_session.execute(
        text(
            "SELECT status FROM finance_budget_versions "
            "WHERE id = :version_id AND company_id = :company_id AND project_id = :project_id"
        ),
        {"company_id": company_id, "version_id": version_id, "project_id": project_id},
    ).scalar_one_or_none()
    if target != "draft":
        raise FinanceLedgerError("INVALID_STATUS", "Only a draft budget version can be approved.")
    savepoint = db_session.begin_nested()
    try:
        current = db_session.execute(
            text(
                "SELECT id FROM finance_budget_versions "
                "WHERE company_id = :company_id AND project_id = :project_id AND status = 'approved' "
                "FOR UPDATE"
            ),
            {"company_id": company_id, "project_id": project_id},
        ).scalar_one_or_none()
        if current is not None and current != version_id:
            superseded = db_session.execute(
                text(
                    "UPDATE finance_budget_versions SET status = 'superseded', updated_at = now() "
                    "WHERE id = :id AND company_id = :company_id AND project_id = :project_id AND status = 'approved'"
                ),
                {"id": current, "company_id": company_id, "project_id": project_id},
            )
            if superseded.rowcount != 1:
                raise FinanceLedgerError("INVALID_STATUS", "The current approved budget could not be superseded.")
        updated = db_session.execute(
            text(
                "UPDATE finance_budget_versions SET status = 'approved', approved_at = now(), "
                "approved_by_user_id = :actor, updated_at = now() "
                "WHERE id = :id AND company_id = :company_id AND project_id = :project_id AND status = 'draft'"
            ),
            {"id": version_id, "company_id": company_id, "project_id": project_id, "actor": actor_user_id},
        )
        if updated.rowcount != 1:
            raise FinanceLedgerError("INVALID_STATUS", "Only a draft budget version can be approved.")
        savepoint.commit()
    except FinanceLedgerError:
        savepoint.rollback()
        raise
    except DBAPIError as exc:
        savepoint.rollback()
        diagnostic = getattr(getattr(exc, "orig", None), "diag", None)
        primary = str(getattr(diagnostic, "message_primary", "") or "") if diagnostic is not None else ""
        detail = primary or str(getattr(exc, "orig", "") or "") or "The finance record was rejected."
        raise FinanceLedgerError("DATABASE_REJECTED", detail) from exc
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_budget_version",
        entity_id=version_id,
        action="budget_approved",
        reason="Budget version approved.",
        after={"status": "approved", "project_id": str(project_id)},
    )


def list_budgets(db_session: Session, *, company_id: uuid.UUID, project_id: uuid.UUID | None) -> list[dict[str, object]]:
    return _rows(
        db_session.execute(
            text(
                "SELECT version.id, version.project_id, version.version_number, version.status, "
                "COALESCE(SUM(line.amount_net), 0) AS amount_net "
                "FROM finance_budget_versions version "
                "LEFT JOIN finance_budget_lines line ON line.version_id = version.id "
                "WHERE version.company_id = :company_id AND version.project_id = COALESCE(:project_id, version.project_id) "
                "GROUP BY version.id ORDER BY version.project_id, version.version_number"
            ),
            {"company_id": company_id, "project_id": project_id},
        )
    )


def _next_revision(db_session: Session, table: str, project_id: uuid.UUID) -> int:
    current = db_session.execute(
        text(f"SELECT COALESCE(MAX(revision_number), 0) FROM {table} WHERE project_id = :project_id"),
        {"project_id": project_id},
    ).scalar_one()
    return int(current) + 1


def set_contract_value(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None = None,
    project_id: uuid.UUID,
    amount: Decimal,
    effective_date: date,
    explanation: str = "Original contract value. This is not revenue and not project cost.",
) -> uuid.UUID:
    contract_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_contract_values ("
        "id, company_id, project_id, revision_number, amount, effective_date, explanation, created_by_user_id, created_at"
        ") VALUES (:id, :company_id, :project_id, :revision_number, :amount, :effective_date, :explanation, :actor, now())",
        {
            "id": contract_id,
            "company_id": company_id,
            "project_id": project_id,
            "revision_number": _next_revision(db_session, "finance_contract_values", project_id),
            "amount": _required_money(amount),
            "effective_date": effective_date,
            "explanation": explanation.strip(),
            "actor": actor_user_id,
        },
    )
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_contract_value",
        entity_id=contract_id,
        action="contract_value_set",
        reason="Contract value revision stored.",
        after={"project_id": str(project_id), "amount": str(_required_money(amount))},
    )
    return contract_id


def record_cost_to_complete(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    project_id: uuid.UUID,
    amount: Decimal,
    explanation: str,
) -> uuid.UUID:
    forecast_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_cost_to_complete ("
        "id, company_id, project_id, revision_number, amount, explanation, created_by_user_id, created_at"
        ") VALUES (:id, :company_id, :project_id, :revision_number, :amount, :explanation, :actor, now())",
        {
            "id": forecast_id,
            "company_id": company_id,
            "project_id": project_id,
            "revision_number": _next_revision(db_session, "finance_cost_to_complete", project_id),
            "amount": _required_money(amount),
            "explanation": explanation.strip(),
            "actor": actor_user_id,
        },
    )
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_cost_to_complete",
        entity_id=forecast_id,
        action="cost_to_complete_set",
        reason="Cost to complete revision stored.",
        after={"project_id": str(project_id), "amount": str(_required_money(amount))},
    )
    return forecast_id


def create_receipt(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    counterparty_id: uuid.UUID,
    receipt_date: date,
    amount: Decimal,
    external_reference: str | None,
    notes: str | None,
) -> uuid.UUID:
    receipt_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_customer_receipts ("
        "id, company_id, counterparty_id, receipt_date, external_reference, currency_code, amount, notes, "
        "status, created_by_user_id, created_at, updated_at"
        ") VALUES (:id, :company_id, :counterparty_id, :receipt_date, :external_reference, 'GBP', :amount, :notes, "
        "'draft', :actor, now(), now())",
        {
            "id": receipt_id,
            "company_id": company_id,
            "counterparty_id": counterparty_id,
            "receipt_date": receipt_date,
            "external_reference": external_reference,
            "amount": _required_money(amount),
            "notes": notes,
            "actor": actor_user_id,
        },
    )
    _post_row(db_session, "finance_customer_receipts", receipt_id, actor_user_id)
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_customer_receipt",
        entity_id=receipt_id,
        action="receipt_posted",
        reason="Customer receipt posted.",
        after={"amount": str(_required_money(amount))},
    )
    return receipt_id


def allocate_receipt(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    receipt_id: uuid.UUID,
    allocations: list[dict[str, object]],
) -> None:
    if not allocations:
        raise FinanceLedgerError("REQUIRED_FIELD", "A receipt allocation batch cannot be empty.")
    next_number = int(
        db_session.execute(
            text("SELECT COALESCE(MAX(allocation_number), 0) FROM finance_customer_receipt_allocations WHERE receipt_id = :receipt_id"),
            {"receipt_id": receipt_id},
        ).scalar_one()
    )
    savepoint = db_session.begin_nested()
    try:
        for offset, allocation in enumerate(allocations, start=1):
            allocation_id = uuid.uuid4()
            db_session.execute(
                text(
                    "INSERT INTO finance_customer_receipt_allocations ("
                    "id, company_id, receipt_id, invoice_id, allocation_number, amount, status, created_by_user_id, created_at, updated_at"
                    ") VALUES (:id, :company_id, :receipt_id, :invoice_id, :allocation_number, :amount, 'draft', :actor, now(), now())"
                ),
                {
                    "id": allocation_id,
                    "company_id": company_id,
                    "receipt_id": receipt_id,
                    "invoice_id": allocation["invoice_id"],
                    "allocation_number": next_number + offset,
                    "amount": _required_money(allocation["amount"]),  # type: ignore[arg-type]
                    "actor": actor_user_id,
                },
            )
            db_session.flush()
            _post_row(db_session, "finance_customer_receipt_allocations", allocation_id, actor_user_id)
        savepoint.commit()
    except FinanceLedgerError:
        savepoint.rollback()
        raise
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_customer_receipt",
        entity_id=receipt_id,
        action="receipt_allocated",
        reason="Customer receipt allocated.",
        after={"allocation_count": str(len(allocations))},
    )


def _reverse_exact(
    db_session: Session,
    *,
    table: str,
    parent_column: str,
    parent_id: uuid.UUID,
    amount: Decimal,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    reason: str | None,
) -> uuid.UUID:
    reversal_id = uuid.uuid4()
    _insert(
        db_session,
        f"INSERT INTO {table} (id, company_id, {parent_column}, amount, reason, status, created_by_user_id, created_at, updated_at) "
        "VALUES (:id, :company_id, :parent_id, :amount, :reason, 'draft', :actor, now(), now())",
        {
            "id": reversal_id,
            "company_id": company_id,
            "parent_id": parent_id,
            "amount": amount,
            "reason": reason,
            "actor": actor_user_id,
        },
    )
    _post_row(db_session, table, reversal_id, actor_user_id)
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type=table,
        entity_id=reversal_id,
        action="reversal_posted",
        reason=(reason or "Reversal posted.")[:500],
        after={"parent_id": str(parent_id), "amount": str(amount)},
    )
    return reversal_id


def reverse_receipt_allocation(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    allocation_id: uuid.UUID,
    reason: str | None,
) -> uuid.UUID:
    row = db_session.execute(
        text(
            "SELECT amount, status FROM finance_customer_receipt_allocations "
            "WHERE id = :id AND company_id = :company_id"
        ),
        {"id": allocation_id, "company_id": company_id},
    ).mappings().first()
    if row is None or row["status"] != "posted":
        raise FinanceLedgerError("NOT_FOUND", "Posted customer receipt allocation was not found.")
    return _reverse_exact(
        db_session,
        table="finance_customer_receipt_allocation_reversals",
        parent_column="allocation_id",
        parent_id=allocation_id,
        amount=Decimal(str(row["amount"])),
        company_id=company_id,
        actor_user_id=actor_user_id,
        reason=reason,
    )


def reverse_receipt(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    receipt_id: uuid.UUID,
    reason: str | None,
) -> uuid.UUID:
    open_allocations = db_session.execute(
        text(
            "SELECT COUNT(*) FROM finance_customer_receipt_allocations allocation "
            "WHERE allocation.receipt_id = :receipt_id AND allocation.company_id = :company_id AND allocation.status = 'posted' "
            "AND NOT EXISTS (SELECT 1 FROM finance_customer_receipt_allocation_reversals reversal_row "
            "WHERE reversal_row.allocation_id = allocation.id AND reversal_row.status = 'posted')"
        ),
        {"receipt_id": receipt_id, "company_id": company_id},
    ).scalar_one()
    if int(open_allocations) > 0:
        raise FinanceLedgerError("REVERSAL_REJECTED", "Reverse the receipt allocations before reversing the receipt.")
    row = db_session.execute(
        text("SELECT amount, status FROM finance_customer_receipts WHERE id = :id AND company_id = :company_id"),
        {"id": receipt_id, "company_id": company_id},
    ).mappings().first()
    if row is None or row["status"] != "posted":
        raise FinanceLedgerError("NOT_FOUND", "Posted customer receipt was not found.")
    return _reverse_exact(
        db_session,
        table="finance_customer_receipt_reversals",
        parent_column="receipt_id",
        parent_id=receipt_id,
        amount=Decimal(str(row["amount"])),
        company_id=company_id,
        actor_user_id=actor_user_id,
        reason=reason,
    )


def create_application(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    project_id: uuid.UUID,
    counterparty_id: uuid.UUID,
    period_start: date,
    period_end: date,
    applied_net: Decimal,
    notes: str | None,
) -> uuid.UUID:
    number = int(
        db_session.execute(
            text("SELECT COALESCE(MAX(application_number), 0) + 1 FROM finance_payment_applications WHERE project_id = :project_id"),
            {"project_id": project_id},
        ).scalar_one()
    )
    application_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_payment_applications ("
        "id, company_id, project_id, counterparty_id, application_number, period_start, period_end, applied_net, notes, "
        "status, created_by_user_id, created_at, updated_at"
        ") VALUES (:id, :company_id, :project_id, :counterparty_id, :number, :period_start, :period_end, :applied_net, :notes, "
        "'draft', :actor, now(), now())",
        {
            "id": application_id,
            "company_id": company_id,
            "project_id": project_id,
            "counterparty_id": counterparty_id,
            "number": number,
            "period_start": period_start,
            "period_end": period_end,
            "applied_net": _required_money(applied_net),
            "notes": notes,
            "actor": actor_user_id,
        },
    )
    _post_row(db_session, "finance_payment_applications", application_id, actor_user_id)
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_payment_application",
        entity_id=application_id,
        action="application_posted",
        reason="Payment application posted.",
        after={"project_id": str(project_id), "applied_net": str(_required_money(applied_net))},
    )
    return application_id


def retention_withheld_for(certified_net: Decimal, retention_rate: Decimal) -> Decimal:
    return (certified_net * retention_rate / Decimal("100")).quantize(Decimal("0.0001"))


def create_certificate(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    application_id: uuid.UUID,
    certificate_reference: str,
    certified_net: Decimal,
    retention_rate: Decimal,
    invoice_id: uuid.UUID | None,
) -> uuid.UUID:
    certified = _required_money(certified_net)
    rate = _required_money(retention_rate)
    withheld = retention_withheld_for(certified, rate)
    certificate_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_payment_certificates ("
        "id, company_id, application_id, certificate_reference, certified_net, retention_rate, retention_withheld, invoice_id, "
        "status, created_by_user_id, created_at, updated_at"
        ") VALUES (:id, :company_id, :application_id, :certificate_reference, :certified_net, :retention_rate, :retention_withheld, "
        ":invoice_id, 'draft', :actor, now(), now())",
        {
            "id": certificate_id,
            "company_id": company_id,
            "application_id": application_id,
            "certificate_reference": certificate_reference.strip(),
            "certified_net": certified,
            "retention_rate": rate,
            "retention_withheld": withheld,
            "invoice_id": invoice_id,
            "actor": actor_user_id,
        },
    )
    _post_row(db_session, "finance_payment_certificates", certificate_id, actor_user_id)
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_payment_certificate",
        entity_id=certificate_id,
        action="certificate_posted",
        reason="Payment certificate posted.",
        after={"certified_net": str(certified), "retention_withheld": str(withheld)},
    )
    return certificate_id


def create_retention_release(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    certificate_id: uuid.UUID,
    amount: Decimal,
    release_date: date,
    notes: str | None,
) -> uuid.UUID:
    release_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_retention_releases ("
        "id, company_id, certificate_id, amount, release_date, notes, status, created_by_user_id, created_at, updated_at"
        ") VALUES (:id, :company_id, :certificate_id, :amount, :release_date, :notes, 'draft', :actor, now(), now())",
        {
            "id": release_id,
            "company_id": company_id,
            "certificate_id": certificate_id,
            "amount": _required_money(amount),
            "release_date": release_date,
            "notes": notes,
            "actor": actor_user_id,
        },
    )
    _post_row(db_session, "finance_retention_releases", release_id, actor_user_id)
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="retention_release",
        entity_id=release_id,
        action="retention_released",
        reason="Retention release posted.",
        after={"certificate_id": str(certificate_id), "amount": str(_required_money(amount))},
    )
    return release_id


def save_variation(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    reference_code: str,
    description: str,
    requested_value: Decimal,
    submitted_value: Decimal,
    counterparty_id: uuid.UUID | None,
    actor_user_id: uuid.UUID | None = None,
) -> uuid.UUID:
    variation_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_variations ("
        "id, company_id, project_id, counterparty_id, reference_code, description, requested_value, submitted_value, "
        "approved_value, approval_status, created_at, updated_at"
        ") VALUES (:id, :company_id, :project_id, :counterparty_id, :reference_code, :description, :requested_value, "
        ":submitted_value, 0, 'draft', now(), now())",
        {
            "id": variation_id,
            "company_id": company_id,
            "project_id": project_id,
            "counterparty_id": counterparty_id,
            "reference_code": reference_code.strip(),
            "description": description.strip(),
            "requested_value": _required_money(requested_value),
            "submitted_value": _required_money(submitted_value),
        },
    )
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_variation",
        entity_id=variation_id,
        action="variation_saved",
        reason="Variation saved.",
        after={"reference_code": reference_code.strip(), "status": "draft"},
    )
    return variation_id


def transition_variation(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    variation_id: uuid.UUID,
    approval_status: str,
    approved_value: Decimal | None,
    actor_user_id: uuid.UUID | None = None,
) -> None:
    current = db_session.execute(
        text("SELECT approval_status FROM finance_variations WHERE id = :id AND company_id = :company_id"),
        {"id": variation_id, "company_id": company_id},
    ).scalar_one_or_none()
    if current is None:
        raise FinanceLedgerError("NOT_FOUND", "Variation was not found.")
    if current in {"approved", "rejected"}:
        raise FinanceLedgerError("IMMUTABLE", "An approved or rejected variation cannot be changed.")
    allowed = {"draft": {"submitted", "rejected"}, "submitted": {"approved", "rejected"}}
    if approval_status not in allowed.get(str(current), set()):
        raise FinanceLedgerError("INVALID_STATUS", "That variation status change is not allowed.")
    value = _required_money(approved_value) if approved_value is not None else Decimal("0")
    if approval_status == "approved":
        db_session.execute(
            text(
                "UPDATE finance_variations SET approval_status = 'approved', approved_value = :value, "
                "approved_at = now(), updated_at = now() WHERE id = :id"
            ),
            {"id": variation_id, "value": value},
        )
    else:
        db_session.execute(
            text("UPDATE finance_variations SET approval_status = :status, updated_at = now() WHERE id = :id"),
            {"id": variation_id, "status": approval_status},
        )
    _flush(db_session)
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_variation",
        entity_id=variation_id,
        action="variation_transitioned",
        reason="Variation status changed.",
        before={"approval_status": str(current)},
        after={"approval_status": approval_status},
    )


def save_daywork(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    reference_code: str,
    work_date: date,
    description: str,
    labour_amount: Decimal,
    material_amount: Decimal,
    plant_amount: Decimal,
    actor_user_id: uuid.UUID | None = None,
) -> uuid.UUID:
    labour = _required_money(labour_amount)
    material = _required_money(material_amount)
    plant = _required_money(plant_amount)
    total = labour + material + plant
    detail = f"Labour {labour}; Material {material}; Plant {plant}. {description.strip()}"
    daywork_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_dayworks ("
        "id, company_id, project_id, reference_code, work_date, description, submitted_value, approved_value, "
        "approval_status, counts_in_contract_value, labour_amount, material_amount, plant_amount, created_at, updated_at"
        ") VALUES (:id, :company_id, :project_id, :reference_code, :work_date, :description, :submitted_value, 0, "
        "'draft', false, :labour, :material, :plant, now(), now())",
        {
            "id": daywork_id,
            "company_id": company_id,
            "project_id": project_id,
            "reference_code": reference_code.strip(),
            "work_date": work_date,
            "description": detail,
            "submitted_value": total,
            "labour": labour,
            "material": material,
            "plant": plant,
        },
    )
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_daywork",
        entity_id=daywork_id,
        action="daywork_saved",
        reason="Daywork saved.",
        after={"reference_code": reference_code.strip(), "submitted_value": str(total)},
    )
    return daywork_id


def approve_daywork(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    daywork_id: uuid.UUID,
    counts_in_contract_value: bool,
    actor_user_id: uuid.UUID | None = None,
) -> None:
    row = db_session.execute(
        text("SELECT approval_status, submitted_value FROM finance_dayworks WHERE id = :id AND company_id = :company_id"),
        {"id": daywork_id, "company_id": company_id},
    ).mappings().first()
    if row is None:
        raise FinanceLedgerError("NOT_FOUND", "Daywork was not found.")
    if row["approval_status"] in {"approved", "rejected"}:
        raise FinanceLedgerError("IMMUTABLE", "An approved or rejected daywork cannot be changed.")
    db_session.execute(
        text(
            "UPDATE finance_dayworks SET approval_status = 'approved', approved_value = submitted_value, "
            "counts_in_contract_value = :counts, updated_at = now() WHERE id = :id"
        ),
        {"id": daywork_id, "counts": counts_in_contract_value},
    )
    _flush(db_session)
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_daywork",
        entity_id=daywork_id,
        action="daywork_approved",
        reason="Daywork approved.",
        after={"counts_in_contract_value": str(counts_in_contract_value).lower()},
    )


def create_commitment(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    project_id: uuid.UUID,
    cost_code_id: uuid.UUID | None,
    counterparty_id: uuid.UUID,
    reference_code: str,
    committed_amount: Decimal,
) -> uuid.UUID:
    commitment_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_commitments ("
        "id, company_id, project_id, cost_code_id, counterparty_id, reference_code, committed_amount, commitment_status, "
        "status, created_by_user_id, created_at, updated_at"
        ") VALUES (:id, :company_id, :project_id, :cost_code_id, :counterparty_id, :reference_code, :committed_amount, "
        "'open', 'draft', :actor, now(), now())",
        {
            "id": commitment_id,
            "company_id": company_id,
            "project_id": project_id,
            "cost_code_id": cost_code_id,
            "counterparty_id": counterparty_id,
            "reference_code": reference_code.strip(),
            "committed_amount": _required_money(committed_amount),
            "actor": actor_user_id,
        },
    )
    _post_row(db_session, "finance_commitments", commitment_id, actor_user_id)
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_commitment",
        entity_id=commitment_id,
        action="commitment_posted",
        reason="Commitment posted.",
        after={"reference_code": reference_code.strip(), "committed_amount": str(_required_money(committed_amount))},
    )
    return commitment_id


def draw_commitment(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    commitment_id: uuid.UUID,
    cost_document_id: uuid.UUID,
    amount: Decimal,
) -> uuid.UUID:
    draw_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_commitment_draws ("
        "id, company_id, commitment_id, cost_document_id, amount, status, created_by_user_id, created_at, updated_at"
        ") VALUES (:id, :company_id, :commitment_id, :cost_document_id, :amount, 'draft', :actor, now(), now())",
        {
            "id": draw_id,
            "company_id": company_id,
            "commitment_id": commitment_id,
            "cost_document_id": cost_document_id,
            "amount": _required_money(amount),
            "actor": actor_user_id,
        },
    )
    _post_row(db_session, "finance_commitment_draws", draw_id, actor_user_id)
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_commitment_draw",
        entity_id=draw_id,
        action="commitment_drawn",
        reason="Commitment draw posted.",
        after={"commitment_id": str(commitment_id), "amount": str(_required_money(amount))},
    )
    return draw_id


def create_cis_split(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    snapshot_id: uuid.UUID,
    project_id: uuid.UUID,
    gross_amount: Decimal,
    review_note: str | None,
) -> uuid.UUID:
    split_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_cis_project_splits ("
        "id, company_id, snapshot_id, project_id, gross_amount, review_note, status, created_by_user_id, created_at, updated_at"
        ") VALUES (:id, :company_id, :snapshot_id, :project_id, :gross_amount, :review_note, 'draft', :actor, now(), now())",
        {
            "id": split_id,
            "company_id": company_id,
            "snapshot_id": snapshot_id,
            "project_id": project_id,
            "gross_amount": _required_money(gross_amount),
            "review_note": review_note,
            "actor": actor_user_id,
        },
    )
    _post_row(db_session, "finance_cis_project_splits", split_id, actor_user_id)
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_cis_project_split",
        entity_id=split_id,
        action="cis_split_posted",
        reason="CIS project split posted.",
        after={"snapshot_id": str(snapshot_id), "gross_amount": str(_required_money(gross_amount))},
    )
    return split_id


def create_funding(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    entry_kind: str,
    entry_date: date,
    amount: Decimal,
    counterparty_id: uuid.UUID | None,
    source_user_id: uuid.UUID | None,
    external_reference: str | None,
    notes: str | None,
) -> uuid.UUID:
    funding_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_funding_entries ("
        "id, company_id, entry_kind, counterparty_id, source_user_id, entry_date, amount, external_reference, notes, "
        "review_required, status, created_by_user_id, created_at, updated_at"
        ") VALUES (:id, :company_id, :entry_kind, :counterparty_id, :source_user_id, :entry_date, :amount, "
        ":external_reference, :notes, true, 'draft', :actor, now(), now())",
        {
            "id": funding_id,
            "company_id": company_id,
            "entry_kind": entry_kind,
            "counterparty_id": counterparty_id,
            "source_user_id": source_user_id,
            "entry_date": entry_date,
            "amount": _required_money(amount),
            "external_reference": external_reference,
            "notes": notes,
            "actor": actor_user_id,
        },
    )
    _post_row(db_session, "finance_funding_entries", funding_id, actor_user_id)
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_funding_entry",
        entity_id=funding_id,
        action="funding_posted",
        reason="Funding entry posted.",
        after={"entry_kind": entry_kind, "amount": str(_required_money(amount))},
    )
    return funding_id


def create_opening_balance(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    balance_kind: str,
    effective_date: date,
    amount: Decimal,
    source_reference: str,
    explanation: str,
    counterparty_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
    source_user_id: uuid.UUID | None,
    actor_user_id: uuid.UUID | None = None,
) -> uuid.UUID:
    if balance_kind == "other" and source_reference.startswith("contract:"):
        raise FinanceLedgerError("INVALID_STATUS", "Contract value uses the project contract action.")
    opening_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_opening_balances ("
        "id, company_id, balance_kind, effective_date, amount, counterparty_id, project_id, source_user_id, "
        "source_reference, explanation, review_status, created_at, updated_at"
        ") VALUES (:id, :company_id, :balance_kind, :effective_date, :amount, :counterparty_id, :project_id, "
        ":source_user_id, :source_reference, :explanation, 'draft', now(), now())",
        {
            "id": opening_id,
            "company_id": company_id,
            "balance_kind": balance_kind,
            "effective_date": effective_date,
            "amount": _required_money(amount),
            "counterparty_id": counterparty_id,
            "project_id": project_id,
            "source_user_id": source_user_id,
            "source_reference": source_reference.strip(),
            "explanation": explanation.strip(),
        },
    )
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_opening_balance",
        entity_id=opening_id,
        action="opening_saved",
        reason="Opening balance saved.",
        after={"balance_kind": balance_kind, "amount": str(_required_money(amount)), "review_status": "draft"},
    )
    return opening_id


def review_opening_balance(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    opening_id: uuid.UUID,
    actor_user_id: uuid.UUID | None = None,
) -> None:
    updated = db_session.execute(
        text(
            "UPDATE finance_opening_balances SET review_status = 'reviewed', updated_at = now() "
            "WHERE id = :id AND company_id = :company_id AND review_status = 'draft'"
        ),
        {"id": opening_id, "company_id": company_id},
    )
    if updated.rowcount != 1:
        raise FinanceLedgerError("NOT_FOUND", "Draft opening balance was not found.")
    _flush(db_session)
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_opening_balance",
        entity_id=opening_id,
        action="opening_reviewed",
        reason="Opening balance reviewed.",
        before={"review_status": "draft"},
        after={"review_status": "reviewed"},
    )


def create_hmrc_payment(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    payment_kind: str,
    payment_date: date,
    amount: Decimal,
    external_reference: str | None,
    notes: str | None,
) -> uuid.UUID:
    payment_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_hmrc_payments ("
        "id, company_id, payment_kind, payment_date, amount, external_reference, notes, status, created_by_user_id, created_at, updated_at"
        ") VALUES (:id, :company_id, :payment_kind, :payment_date, :amount, :external_reference, :notes, 'draft', :actor, now(), now())",
        {
            "id": payment_id,
            "company_id": company_id,
            "payment_kind": payment_kind,
            "payment_date": payment_date,
            "amount": _required_money(amount),
            "external_reference": external_reference,
            "notes": notes or "Record only. This does not file anything with HMRC.",
            "actor": actor_user_id,
        },
    )
    _post_row(db_session, "finance_hmrc_payments", payment_id, actor_user_id)
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_hmrc_payment",
        entity_id=payment_id,
        action="hmrc_payment_posted",
        reason="HMRC payment recorded. This does not file anything with HMRC.",
        after={"payment_kind": payment_kind, "amount": str(_required_money(amount))},
    )
    return payment_id


def project_cvr(db_session: Session, *, company_id: uuid.UUID, project_id: uuid.UUID) -> dict[str, str]:
    if company_id is None or project_id is None:
        raise FinanceLedgerError("REQUIRED_FIELD", "company_id and project_id are required.")
    owned = db_session.execute(
        text(
            "SELECT 1 FROM finance_projects "
            "WHERE id = :project_id AND company_id = :company_id"
        ),
        {"company_id": company_id, "project_id": project_id},
    ).scalar()
    if owned is None:
        raise FinanceLedgerError("NOT_FOUND", "Project was not found in this company.")

    params = {"company_id": company_id, "project_id": project_id}
    stored_contract = db_session.execute(
        text(
            "SELECT amount FROM finance_contract_values "
            "WHERE company_id = :company_id AND project_id = :project_id "
            "ORDER BY revision_number DESC LIMIT 1"
        ),
        params,
    ).scalar()
    contract_known = stored_contract is not None
    contract = Decimal(str(stored_contract)) if contract_known else Decimal("0")
    cost_to_complete = db_session.execute(
        text(
            "SELECT amount FROM finance_cost_to_complete "
            "WHERE company_id = :company_id AND project_id = :project_id "
            "ORDER BY revision_number DESC LIMIT 1"
        ),
        params,
    ).scalar()
    variations = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(approved_value), 0) FROM finance_variations "
            "WHERE company_id = :company_id AND project_id = :project_id AND approval_status = 'approved'"
        ),
        params,
    ).scalar_one()))
    dayworks = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(approved_value), 0) FROM finance_dayworks "
            "WHERE company_id = :company_id AND project_id = :project_id AND approval_status = 'approved' "
            "AND counts_in_contract_value = true"
        ),
        params,
    ).scalar_one()))
    budget = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(line.amount_net), 0) FROM finance_budget_lines line "
            "JOIN finance_budget_versions version ON version.id = line.version_id "
            "WHERE version.company_id = :company_id AND version.project_id = :project_id AND version.status = 'approved'"
        ),
        params,
    ).scalar_one()))
    actual = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(allocation.amount_eligible), 0) FROM finance_cost_allocations allocation "
            "JOIN finance_cost_lines line ON line.id = allocation.line_id "
            "JOIN finance_cost_documents document ON document.id = line.document_id "
            "WHERE document.company_id = :company_id AND document.status = 'posted' AND allocation.project_id = :project_id"
        ),
        params,
    ).scalar_one()))
    labour = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(gross_amount), 0) FROM finance_cis_project_splits "
            "WHERE company_id = :company_id AND project_id = :project_id AND status = 'posted'"
        ),
        params,
    ).scalar_one()))
    committed = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(committed_amount), 0) FROM finance_commitments "
            "WHERE company_id = :company_id AND project_id = :project_id AND status = 'posted'"
        ),
        params,
    ).scalar_one()))
    drawn = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(draw.amount), 0) FROM finance_commitment_draws draw "
            "JOIN finance_commitments commitment ON commitment.id = draw.commitment_id "
            "WHERE commitment.company_id = :company_id AND commitment.project_id = :project_id AND draw.status = 'posted'"
        ),
        params,
    ).scalar_one()))
    remaining_commitment = committed - drawn
    ctc_value: Decimal | None
    if cost_to_complete is None:
        ctc_value = None
    else:
        ctc_value = Decimal(str(cost_to_complete))
    return compose_cvr_forecast(
        contract_known=contract_known,
        original_contract=contract,
        approved_variations=variations,
        approved_dayworks_in_contract=dayworks,
        approved_budget=budget,
        actual_eligible_cost=actual,
        cis_labour_gross=labour,
        open_commitment=remaining_commitment,
        cost_to_complete=ctc_value,
    )


def project_cvr_as_of(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    cut_off: date,
) -> dict[str, str]:
    """Company/project-scoped CVR position using stored economic/recording dates.

    Cut-off policy (documented limitations included in the response):
    - Eligible costs use ``document_date`` (economic). Accrual documents are excluded.
    - CIS labour, commitments and draws use ``posted_at`` date (recording).
    - Contract and CTC revisions use ``created_at`` date (recording).
    - Customer invoices use ``document_date``; receipts use ``receipt_date``.
    - Certificates use ``posted_at`` date; certified-to-date basis is unvalidated.
    - Internal VOW and accruals remain unavailable until persistence exists.
    A backdated document_date recorded after the cut-off can still appear in as-of
    results; that is not a January-close snapshot.
    """
    if company_id is None or project_id is None:
        raise FinanceLedgerError("REQUIRED_FIELD", "company_id and project_id are required.")
    owned = db_session.execute(
        text(
            "SELECT 1 FROM finance_projects "
            "WHERE id = :project_id AND company_id = :company_id"
        ),
        {"company_id": company_id, "project_id": project_id},
    ).scalar()
    if owned is None:
        raise FinanceLedgerError("NOT_FOUND", "Project was not found in this company.")

    params = {"company_id": company_id, "project_id": project_id, "cut_off": cut_off}

    stored_contract = db_session.execute(
        text(
            "SELECT amount FROM finance_contract_values "
            "WHERE company_id = :company_id AND project_id = :project_id "
            "AND (created_at AT TIME ZONE 'UTC')::date <= :cut_off "
            "ORDER BY revision_number DESC LIMIT 1"
        ),
        params,
    ).scalar()
    contract_known = stored_contract is not None
    contract = Decimal(str(stored_contract)) if contract_known else Decimal("0")

    cost_to_complete = db_session.execute(
        text(
            "SELECT amount FROM finance_cost_to_complete "
            "WHERE company_id = :company_id AND project_id = :project_id "
            "AND (created_at AT TIME ZONE 'UTC')::date <= :cut_off "
            "ORDER BY revision_number DESC LIMIT 1"
        ),
        params,
    ).scalar()
    ctc_value = None if cost_to_complete is None else Decimal(str(cost_to_complete))

    variations = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(approved_value), 0) FROM finance_variations "
            "WHERE company_id = :company_id AND project_id = :project_id "
            "AND approval_status = 'approved' "
            "AND (updated_at AT TIME ZONE 'UTC')::date <= :cut_off"
        ),
        params,
    ).scalar_one()))
    dayworks = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(approved_value), 0) FROM finance_dayworks "
            "WHERE company_id = :company_id AND project_id = :project_id "
            "AND approval_status = 'approved' AND counts_in_contract_value = true "
            "AND work_date <= :cut_off"
        ),
        params,
    ).scalar_one()))
    budget = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(line.amount_net), 0) FROM finance_budget_lines line "
            "JOIN finance_budget_versions version ON version.id = line.version_id "
            "WHERE version.company_id = :company_id AND version.project_id = :project_id "
            "AND version.status = 'approved' "
            "AND (version.updated_at AT TIME ZONE 'UTC')::date <= :cut_off"
        ),
        params,
    ).scalar_one()))

    # Non-accrual eligible cost by document economic date.
    eligible = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(allocation.amount_eligible), 0) "
            "FROM finance_cost_allocations allocation "
            "JOIN finance_cost_lines line ON line.id = allocation.line_id "
            "JOIN finance_cost_documents document ON document.id = line.document_id "
            "WHERE document.company_id = :company_id "
            "AND document.status = 'posted' "
            "AND allocation.project_id = :project_id "
            "AND document.document_type <> 'accrual' "
            "AND document.document_date IS NOT NULL "
            "AND document.document_date <= :cut_off"
        ),
        params,
    ).scalar_one()))
    labour = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(gross_amount), 0) FROM finance_cis_project_splits "
            "WHERE company_id = :company_id AND project_id = :project_id AND status = 'posted' "
            "AND posted_at IS NOT NULL AND (posted_at AT TIME ZONE 'UTC')::date <= :cut_off"
        ),
        params,
    ).scalar_one()))
    committed = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(committed_amount), 0) FROM finance_commitments "
            "WHERE company_id = :company_id AND project_id = :project_id AND status = 'posted' "
            "AND posted_at IS NOT NULL AND (posted_at AT TIME ZONE 'UTC')::date <= :cut_off"
        ),
        params,
    ).scalar_one()))
    drawn = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(draw.amount), 0) FROM finance_commitment_draws draw "
            "JOIN finance_commitments commitment ON commitment.id = draw.commitment_id "
            "WHERE commitment.company_id = :company_id AND commitment.project_id = :project_id "
            "AND draw.status = 'posted' AND draw.posted_at IS NOT NULL "
            "AND (draw.posted_at AT TIME ZONE 'UTC')::date <= :cut_off"
        ),
        params,
    ).scalar_one()))
    open_commitment = committed - drawn

    invoiced = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(net_amount), 0) FROM finance_customer_invoices "
            "WHERE company_id = :company_id AND project_id = :project_id "
            "AND status = 'posted' AND document_kind = 'invoice' "
            "AND document_date IS NOT NULL AND document_date <= :cut_off"
        ),
        params,
    ).scalar_one()))
    receipts = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(allocation.amount), 0) "
            "FROM finance_customer_receipt_allocations allocation "
            "JOIN finance_customer_receipts receipt "
            "  ON receipt.id = allocation.receipt_id AND receipt.company_id = allocation.company_id "
            "JOIN finance_customer_invoices invoice "
            "  ON invoice.id = allocation.invoice_id AND invoice.company_id = allocation.company_id "
            "WHERE allocation.company_id = :company_id "
            "AND invoice.project_id = :project_id "
            "AND allocation.status = 'posted' AND receipt.status = 'posted' "
            "AND receipt.receipt_date IS NOT NULL AND receipt.receipt_date <= :cut_off "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM finance_customer_receipt_allocation_reversals reversal_row "
            "  WHERE reversal_row.allocation_id = allocation.id AND reversal_row.status = 'posted'"
            ") "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM finance_customer_receipt_reversals receipt_reversal "
            "  WHERE receipt_reversal.receipt_id = receipt.id AND receipt_reversal.status = 'posted'"
            ")"
        ),
        params,
    ).scalar_one()))

    certified = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(certificate.certified_net), 0) "
            "FROM finance_payment_certificates certificate "
            "JOIN finance_payment_applications application "
            "  ON application.id = certificate.application_id "
            " AND application.company_id = certificate.company_id "
            "WHERE certificate.company_id = :company_id "
            "AND application.project_id = :project_id "
            "AND certificate.status = 'posted' "
            "AND certificate.posted_at IS NOT NULL "
            "AND (certificate.posted_at AT TIME ZONE 'UTC')::date <= :cut_off"
        ),
        params,
    ).scalar_one()))

    report = compose_as_of_cvr(
        cut_off=cut_off,
        contract_known=contract_known,
        original_contract=contract,
        approved_variations=variations,
        approved_dayworks_in_contract=dayworks,
        approved_budget=budget,
        non_accrual_eligible_cost=eligible,
        cis_labour_gross=labour,
        effective_accrual_balance=Decimal("0"),
        open_commitment=open_commitment,
        cost_to_complete=ctc_value,
        internal_vow=None,
        certified_value=certified,
        customer_invoiced_net=invoiced,
        customer_receipts=receipts,
    )
    report["accrued_cost"] = MISSING
    report["effective_accrual_balance"] = MISSING
    report["accruals_status"] = "unavailable_until_posting_workflow"
    report["internal_vow"] = MISSING
    report["internal_vow_status"] = "unavailable_until_persistent_valuations"
    report["certified_basis"] = "unvalidated_sum_of_posted_certified_net"
    report["certified_status"] = (
        "unvalidated — certificate amounts are summed from posted certificates; "
        "period versus cumulative semantics are not product-approved"
    )
    report["cut_off_policy"] = (
        "Eligible costs use document_date; CIS/commitments/certificates use posted_at date; "
        "contract/CTC use created_at date; invoices use document_date; receipts use receipt_date. "
        "This is not an immutable month-end snapshot. Backdated document dates can appear in earlier cut-offs."
    )
    report["location_reporting"] = "not_supported — Finance stores project attribution, not site/location"
    return report


def vat_cis_report(db_session: Session, *, company_id: uuid.UUID) -> dict[str, str]:
    params = {"company_id": company_id}
    output_vat = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(tax_amount), 0) FROM finance_customer_invoices "
            "WHERE company_id = :company_id AND status = 'posted' AND document_kind IN ('invoice', 'credit')"
        ),
        params,
    ).scalar_one()))
    input_vat = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(tax_amount), 0) FROM finance_cost_documents "
            "WHERE company_id = :company_id AND status = 'posted'"
        ),
        params,
    ).scalar_one()))
    cis = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(snapshot.effective_cis_deduction), 0) FROM finance_cis_payroll_snapshots snapshot "
            "WHERE snapshot.company_id = :company_id AND snapshot.status = 'posted' "
            "AND NOT EXISTS (SELECT 1 FROM finance_cis_payroll_snapshots child "
            "WHERE child.supersedes_snapshot_id = snapshot.id AND child.status = 'posted')"
        ),
        params,
    ).scalar_one()))
    paye_tax = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(snapshot.paye_tax + snapshot.employee_ni + snapshot.student_loan + snapshot.postgraduate_loan), 0) "
            "FROM finance_paye_payroll_snapshots snapshot WHERE snapshot.company_id = :company_id AND snapshot.status = 'posted' "
            "AND NOT EXISTS (SELECT 1 FROM finance_paye_payroll_snapshots child "
            "WHERE child.supersedes_snapshot_id = snapshot.id AND child.status = 'posted')"
        ),
        params,
    ).scalar_one()))
    employer = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(snapshot.employer_ni + snapshot.employer_pension), 0) "
            "FROM finance_paye_payroll_snapshots snapshot WHERE snapshot.company_id = :company_id AND snapshot.status = 'posted' "
            "AND NOT EXISTS (SELECT 1 FROM finance_paye_payroll_snapshots child "
            "WHERE child.supersedes_snapshot_id = snapshot.id AND child.status = 'posted')"
        ),
        params,
    ).scalar_one()))
    hmrc = Decimal(str(db_session.execute(
        text("SELECT COALESCE(SUM(amount), 0) FROM finance_hmrc_payments WHERE company_id = :company_id AND status = 'posted'"),
        params,
    ).scalar_one()))
    return {
        "output_vat": str(output_vat),
        "input_vat": str(input_vat),
        "net_vat_control": str(output_vat - input_vat),
        "cis_deduction_control": str(cis),
        "paye_deduction_control": str(paye_tax),
        "employer_ni_and_pension": str(employer),
        "hmrc_payments_recorded": str(hmrc),
        "review_required": "These are control totals for the accountant. Nothing is filed with HMRC.",
    }


def list_table(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    statement: str,
    params: dict[str, object] | None = None,
) -> list[dict[str, object]]:
    values = {"company_id": company_id}
    if params:
        values.update(params)
    return _rows(db_session.execute(text(statement), values))


def reverse_worker_allocation(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    allocation_id: uuid.UUID,
    reason: str | None,
) -> uuid.UUID:
    row = db_session.execute(
        text("SELECT amount, status FROM finance_worker_payment_allocations WHERE id = :id AND company_id = :company_id"),
        {"id": allocation_id, "company_id": company_id},
    ).mappings().first()
    if row is None or row["status"] != "posted":
        raise FinanceLedgerError("NOT_FOUND", "Posted worker allocation was not found.")
    return _reverse_exact(
        db_session,
        table="finance_worker_payment_allocation_reversals",
        parent_column="allocation_id",
        parent_id=allocation_id,
        amount=Decimal(str(row["amount"])),
        company_id=company_id,
        actor_user_id=actor_user_id,
        reason=reason,
    )


def reverse_worker_payment(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    payment_id: uuid.UUID,
    reason: str | None,
) -> uuid.UUID:
    open_allocations = db_session.execute(
        text(
            "SELECT COUNT(*) FROM finance_worker_payment_allocations allocation "
            "WHERE allocation.payment_id = :payment_id AND allocation.status = 'posted' "
            "AND NOT EXISTS (SELECT 1 FROM finance_worker_payment_allocation_reversals reversal_row "
            "WHERE reversal_row.allocation_id = allocation.id AND reversal_row.status = 'posted')"
        ),
        {"payment_id": payment_id},
    ).scalar_one()
    if int(open_allocations) > 0:
        raise FinanceLedgerError("REVERSAL_REJECTED", "Reverse the worker allocations before reversing the payment.")
    row = db_session.execute(
        text("SELECT amount, status FROM finance_worker_payments WHERE id = :id AND company_id = :company_id"),
        {"id": payment_id, "company_id": company_id},
    ).mappings().first()
    if row is None or row["status"] != "posted":
        raise FinanceLedgerError("NOT_FOUND", "Posted worker payment was not found.")
    return _reverse_exact(
        db_session,
        table="finance_worker_payment_reversals",
        parent_column="payment_id",
        parent_id=payment_id,
        amount=Decimal(str(row["amount"])),
        company_id=company_id,
        actor_user_id=actor_user_id,
        reason=reason,
    )


def supplier_position(db_session: Session, *, company_id: uuid.UUID) -> dict[str, str]:
    invoice_outstanding = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(finance_supplier_gross_liability(document.id) - finance_supplier_allocated_to_document(document.id)), 0) "
            "FROM finance_cost_documents document WHERE document.company_id = :company_id AND document.status = 'posted' "
            "AND document.document_type IN ('supplier_invoice', 'expense_receipt')"
        ),
        {"company_id": company_id},
    ).scalar_one()))
    opening = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(opening.amount), 0) FROM finance_opening_balances opening "
            "WHERE opening.company_id = :company_id AND opening.balance_kind = 'supplier_payable' AND opening.review_status = 'reviewed'"
        ),
        {"company_id": company_id},
    ).scalar_one()))
    settled = Decimal(str(db_session.execute(
        text(
            "SELECT COALESCE(SUM(settlement.amount), 0) FROM finance_opening_settlements settlement "
            "JOIN finance_opening_balances opening ON opening.id = settlement.opening_balance_id "
            "WHERE settlement.company_id = :company_id AND settlement.status = 'posted' "
            "AND opening.balance_kind = 'supplier_payable'"
        ),
        {"company_id": company_id},
    ).scalar_one()))
    remaining_opening = opening - settled
    return {
        "invoice_outstanding": str(invoice_outstanding),
        "opening_supplier_payable": str(opening),
        "opening_settled": str(settled),
        "opening_remaining": str(remaining_opening),
        "combined_supplier_position": str(invoice_outstanding + remaining_opening),
        "review_required": "Opening settlements are separate from supplier invoice payments. Invoice allocations do not reduce opening balances.",
    }


def settle_opening_balance(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    opening_id: uuid.UUID,
    amount: Decimal,
    settlement_date: date,
    external_reference: str | None,
) -> uuid.UUID:
    settlement_id = uuid.uuid4()
    _insert(
        db_session,
        "INSERT INTO finance_opening_settlements ("
        "id, company_id, opening_balance_id, amount, settlement_date, external_reference, notes, status, created_by_user_id, created_at, updated_at"
        ") VALUES (:id, :company_id, :opening_id, :amount, :settlement_date, :external_reference, "
        "'Cash against a historical opening balance. This is not a supplier-invoice allocation.', 'draft', :actor, now(), now())",
        {
            "id": settlement_id,
            "company_id": company_id,
            "opening_id": opening_id,
            "amount": _required_money(amount),
            "settlement_date": settlement_date,
            "external_reference": external_reference,
            "actor": actor_user_id,
        },
    )
    _post_row(db_session, "finance_opening_settlements", settlement_id, actor_user_id)
    _event(
        db_session,
        company_id=company_id,
        actor_user_id=actor_user_id,
        entity_type="finance_opening_settlement",
        entity_id=settlement_id,
        action="opening_settled",
        reason="Opening balance settlement posted.",
        after={"opening_id": str(opening_id), "amount": str(_required_money(amount))},
    )
    return settlement_id


def list_snapshot_history(db_session: Session, *, company_id: uuid.UUID, kind: str, source_id: uuid.UUID) -> list[dict[str, object]]:
    if kind == "cis":
        statement = (
            "SELECT id, revision_number, gross_amount, effective_cis_deduction, effective_payable_amount, source_status, source_hash, created_at "
            "FROM finance_cis_payroll_snapshots WHERE company_id = :company_id AND source_payroll_item_id = :source_id "
            "ORDER BY revision_number"
        )
    elif kind == "paye":
        statement = (
            "SELECT id, revision_number, net_pay, paye_tax, employer_ni, employer_pension, source_status, source_hash, created_at "
            "FROM finance_paye_payroll_snapshots WHERE company_id = :company_id AND source_paye_item_id = :source_id "
            "ORDER BY revision_number"
        )
    else:
        raise FinanceLedgerError("NOT_FOUND", "Unknown snapshot history.")
    return _rows(db_session.execute(text(statement), {"company_id": company_id, "source_id": source_id}))


def list_cis_sources(db_session: Session, *, company_id: uuid.UUID) -> list[dict[str, object]]:
    return _rows(
        db_session.execute(
            text(
                "SELECT item.id, item.user_id, users.email, period.week_start, item.gross_amount, item.net_amount, item.status "
                "FROM payroll_items item "
                "JOIN payroll_periods period ON period.id = item.period_id "
                "JOIN users ON users.id = item.user_id "
                "WHERE item.company_id = :company_id AND item.status IN ('approved', 'paid') "
                "ORDER BY period.week_start, users.email"
            ),
            {"company_id": company_id},
        )
    )


def list_paye_sources(db_session: Session, *, company_id: uuid.UUID) -> list[dict[str, object]]:
    return _rows(
        db_session.execute(
            text(
                "SELECT item.id, item.user_id, users.email, period.tax_year, period.tax_month, item.net_pay, item.employer_ni, item.employer_pension, item.status "
                "FROM monthly_paye_items item "
                "JOIN monthly_paye_periods period ON period.id = item.period_id "
                "JOIN users ON users.id = item.user_id "
                "WHERE item.company_id = :company_id AND item.status IN ('approved', 'paid') "
                "ORDER BY period.tax_year, period.tax_month, users.email"
            ),
            {"company_id": company_id},
        )
    )


def report_csv(report: dict[str, str]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["item", "amount_or_note"])
    for key, value in report.items():
        writer.writerow([key, value])
    return buffer.getvalue()
