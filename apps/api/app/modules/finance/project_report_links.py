"""Project report rows from stored links.

A payment allocation is counted once. Eligible-cost splits are not used as a
bank-cash split. Closing CVR figures are not calculated here.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.modules.finance.register_query import in_inclusive_range, london_day

COMPANY = "company_id = :company_id"

COST_SQL = f"""
SELECT allocation.id AS allocation_id, document.id AS document_id,
       document.external_reference AS document_reference, document.document_type,
       document.gross_amount AS document_gross, document.document_date,
       allocation.project_id, allocation.amount_eligible
FROM finance_cost_allocations allocation
JOIN finance_cost_lines line
  ON line.id = allocation.line_id AND line.company_id = allocation.company_id
JOIN finance_cost_documents document
  ON document.id = line.document_id AND document.company_id = line.company_id
WHERE allocation.{COMPANY} AND document.status = 'posted'
"""

PAYMENT_SQL = f"""
SELECT pay_alloc.id AS payment_allocation_id, pay_alloc.amount AS allocation_amount,
       pay_alloc.cost_document_id AS document_id, payment.id AS payment_id,
       payment.external_reference AS payment_reference, payment.payment_date,
       payment.amount AS payment_amount
FROM finance_supplier_payment_allocations pay_alloc
JOIN finance_supplier_payments payment
  ON payment.id = pay_alloc.payment_id AND payment.company_id = pay_alloc.company_id
JOIN finance_cost_documents document
  ON document.id = pay_alloc.cost_document_id AND document.company_id = pay_alloc.company_id
WHERE pay_alloc.{COMPANY}
  AND pay_alloc.status = 'posted' AND payment.status = 'posted' AND document.status = 'posted'
  AND NOT EXISTS (
      SELECT 1 FROM finance_supplier_payment_reversals reversal_row
      WHERE reversal_row.payment_id = payment.id AND reversal_row.company_id = payment.company_id
        AND reversal_row.status = 'posted'
  )
  AND NOT EXISTS (
      SELECT 1 FROM finance_supplier_payment_allocation_reversals allocation_reversal
      WHERE allocation_reversal.allocation_id = pay_alloc.id
        AND allocation_reversal.company_id = pay_alloc.company_id
        AND allocation_reversal.status = 'posted'
  )
"""

RECEIPT_SQL = f"""
SELECT alloc.id AS receipt_allocation_id, alloc.amount AS allocation_amount,
       receipt.id AS receipt_id, receipt.external_reference AS receipt_reference, receipt.receipt_date,
       invoice.id AS invoice_id, invoice.project_id, invoice.external_reference AS invoice_reference,
       invoice.gross_amount AS invoice_gross
FROM finance_customer_receipt_allocations alloc
JOIN finance_customer_receipts receipt
  ON receipt.id = alloc.receipt_id AND receipt.company_id = alloc.company_id
JOIN finance_customer_invoices invoice
  ON invoice.id = alloc.invoice_id AND invoice.company_id = alloc.company_id
WHERE alloc.{COMPANY}
  AND alloc.status = 'posted' AND receipt.status = 'posted'
  AND NOT EXISTS (
      SELECT 1 FROM finance_customer_receipt_reversals reversal_row
      WHERE reversal_row.receipt_id = receipt.id AND reversal_row.company_id = receipt.company_id
        AND reversal_row.status = 'posted'
  )
  AND NOT EXISTS (
      SELECT 1 FROM finance_customer_receipt_allocation_reversals allocation_reversal
      WHERE allocation_reversal.allocation_id = alloc.id
        AND allocation_reversal.company_id = alloc.company_id
        AND allocation_reversal.status = 'posted'
  )
"""

CREDIT_SQL = f"""
SELECT credit.id AS credit_id, credit.gross_amount, credit.external_reference, credit.document_date,
       COALESCE(credit.project_id, invoice.project_id) AS project_id
FROM finance_customer_invoices credit
LEFT JOIN finance_customer_invoices invoice
  ON invoice.id = credit.credits_invoice_id AND invoice.company_id = credit.company_id
WHERE credit.{COMPANY} AND credit.status = 'posted' AND credit.document_kind = 'credit'
"""

RETENTION_SQL = f"""
SELECT release.id AS release_id, release.amount, release.release_date,
       certificate.certificate_reference, application.project_id
FROM finance_retention_releases release
JOIN finance_payment_certificates certificate
  ON certificate.id = release.certificate_id AND certificate.company_id = release.company_id
JOIN finance_payment_applications application
  ON application.id = certificate.application_id AND application.company_id = certificate.company_id
WHERE release.{COMPANY} AND release.status = 'posted'
"""

AUDIT_LINK_SQL = f"""
SELECT event.id AS event_id, event.created_at, event.action, event.entity_type, event.entity_id,
       event.reason
FROM finance_audit_events event
WHERE event.{COMPANY}
"""


def _rows(db_session: Session, statement: str, company_id: uuid.UUID) -> list[dict[str, object]]:
    return [dict(row) for row in db_session.execute(text(statement), {"company_id": company_id}).mappings()]


def load_report_links(db_session: Session, company_id: uuid.UUID) -> dict[str, list[dict[str, object]]]:
    return {
        "costs": _rows(db_session, COST_SQL, company_id),
        "payments": _rows(db_session, PAYMENT_SQL, company_id),
        "receipts": _rows(db_session, RECEIPT_SQL, company_id),
        "credits": _rows(db_session, CREDIT_SQL, company_id),
        "retention": _rows(db_session, RETENTION_SQL, company_id),
        "audit": _rows(db_session, AUDIT_LINK_SQL, company_id),
    }


def _same(left: object, right: object) -> bool:
    return str(left or "") == str(right or "")


def _in_period(value: object, date_from: str | None, date_to: str | None) -> bool:
    if not date_from and not date_to:
        return True
    if london_day(value) is None:
        return False
    start = date.fromisoformat(date_from) if date_from else None
    end = date.fromisoformat(date_to) if date_to else None
    return in_inclusive_range(value, start, end)


def _unique(rows: list[dict[str, object]], key: str) -> list[dict[str, object]]:
    seen: set[str] = set()
    selected: list[dict[str, object]] = []
    for row in rows:
        identity = str(row.get(key) or "")
        if not identity or identity in seen:
            continue
        seen.add(identity)
        selected.append(row)
    return selected


def document_projects(costs: list[dict[str, object]]) -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for row in costs:
        if not row.get("project_id"):
            continue
        found.setdefault(str(row["document_id"]), set()).add(str(row["project_id"]))
    return found


def project_cost_rows(costs: list[dict[str, object]], project_id: object, date_from: str | None = None, date_to: str | None = None) -> list[dict[str, object]]:
    return [
        row for row in _unique(costs, "allocation_id")
        if _same(row.get("project_id"), project_id) and _in_period(row.get("document_date"), date_from, date_to)
    ]


def project_supplier_cash(
    payments: list[dict[str, object]],
    projects_by_document: dict[str, set[str]],
    project_id: object,
    date_from: str | None = None,
    date_to: str | None = None,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """Return project cash, then payments that touch this project but cannot be split."""
    seen_ids: set[str] = set()
    cash: list[dict[str, object]] = []
    unassigned: list[dict[str, object]] = []
    project = str(project_id)
    for row in _unique(payments, "payment_allocation_id"):
        if row.get("reversed") is True:
            continue
        if not _in_period(row.get("payment_date"), date_from, date_to):
            continue
        identity = str(row["payment_allocation_id"])
        if identity in seen_ids:
            continue
        seen_ids.add(identity)
        projects = projects_by_document.get(str(row.get("document_id")), set())
        if projects == {project}:
            cash.append(row)
        elif project in projects and len(projects) > 1:
            unassigned.append(row)
    return cash, unassigned


def project_receipt_rows(receipts: list[dict[str, object]], project_id: object, date_from: str | None = None, date_to: str | None = None) -> list[dict[str, object]]:
    return [
        row for row in _unique(receipts, "receipt_allocation_id")
        if row.get("reversed") is not True and _same(row.get("project_id"), project_id) and _in_period(row.get("receipt_date"), date_from, date_to)
    ]


def project_credit_rows(credits: list[dict[str, object]], project_id: object, date_from: str | None = None, date_to: str | None = None) -> list[dict[str, object]]:
    return [
        row for row in _unique(credits, "credit_id")
        if _same(row.get("project_id"), project_id) and _in_period(row.get("document_date"), date_from, date_to)
    ]


def project_retention_rows(releases: list[dict[str, object]], project_id: object, date_from: str | None = None, date_to: str | None = None) -> list[dict[str, object]]:
    return [
        row for row in _unique(releases, "release_id")
        if _same(row.get("project_id"), project_id) and _in_period(row.get("release_date"), date_from, date_to)
    ]


def _decimal(value: object) -> Decimal:
    return Decimal(str(value or "0"))


def sum_amount(rows: list[dict[str, object]], key: str) -> Decimal:
    return sum((_decimal(row.get(key)) for row in rows), Decimal("0"))


def project_audit_rows(
    events: list[dict[str, object]],
    *,
    costs: list[dict[str, object]],
    payments: list[dict[str, object]],
    receipts: list[dict[str, object]],
    retention: list[dict[str, object]],
    direct_project: dict[tuple[str, str], str],
    project_id: object,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[dict[str, object]]:
    projects = document_projects(costs)
    allocation_document = {str(row["payment_allocation_id"]): str(row["document_id"]) for row in payments}
    payment_documents: dict[str, set[str]] = {}
    for row in payments:
        payment_documents.setdefault(str(row["payment_id"]), set()).add(str(row["document_id"]))
    receipt_projects: dict[str, set[str]] = {}
    for row in receipts:
        if row.get("project_id") and row.get("receipt_id"):
            receipt_projects.setdefault(str(row["receipt_id"]), set()).add(str(row["project_id"]))
    retention_project = {str(row["release_id"]): str(row["project_id"]) for row in retention if row.get("project_id")}
    project = str(project_id)
    selected: list[dict[str, object]] = []
    seen: set[str] = set()
    for event in events:
        identity = str(event.get("event_id") or event.get("id") or "")
        if not identity or identity in seen:
            continue
        if not _in_period(event.get("created_at"), date_from, date_to):
            continue
        entity = str(event.get("entity_type") or "")
        entity_id = str(event.get("entity_id") or "")
        include = False
        if entity == "supplier_payment_allocation":
            document_id = allocation_document.get(entity_id)
            include = projects.get(document_id, set()) == {project}
        elif entity == "supplier_payment":
            documents = payment_documents.get(entity_id, set())
            include = bool(documents) and all(projects.get(document_id, set()) == {project} for document_id in documents)
        elif entity == "finance_cost_document":
            include = projects.get(entity_id, set()) == {project}
        elif entity in {"retention_release", "finance_retention_release"}:
            include = retention_project.get(entity_id) == project
        elif entity == "finance_customer_receipt":
            include = receipt_projects.get(entity_id) == {project} or direct_project.get((entity, entity_id)) == project
        elif entity == "finance_customer_invoice":
            include = direct_project.get((entity, entity_id)) == project
        elif entity in {"finance_commitment", "finance_variation", "finance_daywork"}:
            include = direct_project.get((entity, entity_id)) == project
        if include:
            seen.add(identity)
            selected.append(event)
    return selected
