"""Owner-facing labels for existing finance audit events.

Historical values come only from the event payload. Linked-record fields are
the current row in this company and are labelled as such.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.modules.finance.register_query import AUDIT_CATEGORIES, sanitize_audit_payload

LONDON = ZoneInfo("Europe/London")

_COST_POSTED = {
    "supplier_invoice": "Supplier invoice posted",
    "expense_receipt": "Project expense posted",
    "supplier_credit": "Supplier credit posted",
    "reversal": "Cost document reversal posted",
    "direct_cash": "Direct cash cost posted",
    "accrual": "Accrual posted",
}

_KNOWN = {
    ("supplier_payment_allocation", "payment_allocated"): ("Supplier payments", "Supplier payment allocated"),
    ("supplier_payment", "payment_posted"): ("Supplier payments", "Supplier bank payment posted"),
    ("supplier_payment", "payment_draft_saved"): ("Approvals and corrections", "Payment draft saved"),
    ("supplier_payment_reversal", "payment_reversed"): ("Reversals", "Supplier payment reversed"),
    ("supplier_payment_allocation_reversal", "allocation_reversed"): ("Reversals", "Supplier allocation reversed"),
    ("finance_cost_document", "cost_document_draft_saved"): ("Approvals and corrections", "Cost document draft saved"),
    ("finance_cost_document", "cost_document_draft_deleted"): ("Approvals and corrections", "Cost document draft deleted"),
    ("finance_customer_receipt", "receipt_posted"): ("Customer receipts", "Customer receipt posted"),
    ("finance_customer_receipt", "receipt_allocated"): ("Customer receipts", "Customer receipt allocated"),
    ("finance_customer_invoice", "customer_invoice_posted"): ("Customer invoices and credits", "Customer invoice posted"),
    ("finance_worker_payment", "worker_payment_posted"): ("CIS worker payments", "CIS bank payment posted"),
    ("finance_worker_payment", "worker_payment_allocated"): ("CIS worker payments", "CIS bank payment allocated"),
    ("finance_cis_payroll_snapshot", "cis_snapshot_imported"): ("CIS/HMRC", "Approved CIS snapshot imported"),
    ("finance_paye_payroll_snapshot", "paye_snapshot_imported"): ("PAYE employee payments", "Approved PAYE snapshot imported"),
    ("finance_retention_release", "retention_released"): ("Retentions", "Retention released"),
    ("retention_release", "retention_released"): ("Retentions", "Retention released"),
    ("finance_hmrc_payment", "hmrc_payment_posted"): ("CIS/HMRC", "HMRC payment posted"),
    ("finance_funding_entry", "funding_posted"): ("Loans and advances", "Loan or advance movement posted"),
}


def describe_audit(entity_type: str, action: str, after: object = None) -> tuple[str, str]:
    if "revers" in action or "revers" in entity_type:
        known = _KNOWN.get((entity_type, action))
        if known:
            return known
        return "Reversals", "Reversal recorded"
    payload = after if isinstance(after, dict) else {}
    if (entity_type, action) == ("finance_cost_document", "cost_document_posted"):
        kind = str(payload.get("document_type") or "")
        return "Project expenses", _COST_POSTED.get(kind, "Cost document posted")
    known = _KNOWN.get((entity_type, action))
    if known:
        return known
    if action in {"budget_approved", "daywork_approved", "variation_transitioned", "opening_reviewed"} or "correct" in action or action.endswith("_saved"):
        return "Approvals and corrections", "Recorded correction or draft"
    category = AUDIT_CATEGORIES.get(entity_type, "Other evidenced financial actions")
    if category == "Other evidenced financial actions":
        return category, "Other recorded action"
    return category, "Recorded financial action"


def format_uk_timestamp(value: object) -> str:
    if value is None or value == "":
        return "Not recorded"
    if isinstance(value, datetime):
        parsed = value
    else:
        text_value = str(value).strip().replace("Z", "+00:00")
        if not text_value:
            return "Not recorded"
        parsed = datetime.fromisoformat(text_value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    local = parsed.astimezone(LONDON)
    return f"{local.day} {local.strftime('%b %Y, %H:%M:%S')} (UK)"


def gbp_text(value: object) -> str:
    if value is None or value == "":
        return "Not recorded"
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return "Not recorded"
    return f"£{amount:,.2f}"


def _snapshot_amount(payload: object) -> str:
    if not isinstance(payload, dict):
        return "Not recorded"
    for key in ("amount", "gross_amount", "eligible_amount", "net_amount"):
        if payload.get(key) not in (None, ""):
            return gbp_text(payload.get(key))
    return "Not recorded"


def _snapshot_reference(payload: object) -> str:
    if not isinstance(payload, dict):
        return "Not recorded"
    for key in ("external_reference", "document_reference", "bank_reference"):
        if payload.get(key) not in (None, ""):
            return str(payload.get(key))
    return "Not recorded"


def present_audit_row(event: dict[str, object], current: dict[str, object] | None) -> dict[str, object]:
    after = sanitize_audit_payload(event.get("after_json"))
    before = sanitize_audit_payload(event.get("before_json"))
    category, operation = describe_audit(str(event.get("entity_type") or ""), str(event.get("action") or ""), after)
    historical_amount = _snapshot_amount(after)
    if historical_amount == "Not recorded":
        historical_amount = _snapshot_amount(before)
    historical_reference = _snapshot_reference(after)
    if historical_reference == "Not recorded":
        historical_reference = _snapshot_reference(before)
    snapshots_missing = not isinstance(before, dict) and not isinstance(after, dict)
    if isinstance(before, dict) and isinstance(after, dict) and not before and not after:
        snapshots_missing = True
    if before in (None, "") and after in (None, ""):
        snapshots_missing = True
    party = "Not recorded"
    amount_display = historical_amount
    reference = historical_reference
    project = "Not recorded"
    status = "Not recorded"
    currency = "Not recorded"
    related = "Not recorded"
    reversal = "Not recorded"
    if current:
        if current.get("party"):
            party = f"{current['party']} (current record)"
        if historical_amount == "Not recorded" and current.get("amount") not in (None, ""):
            amount_display = f"{gbp_text(current.get('amount'))} (current record)"
        if historical_reference == "Not recorded" and current.get("reference"):
            reference = f"{current['reference']} (current record)"
        if current.get("project"):
            project = f"{current['project']} (current record)"
        if current.get("status"):
            status = f"{current['status']} (current record)"
        if current.get("currency"):
            currency = str(current["currency"])
        if current.get("related"):
            related = f"{current['related']} (current record)"
        if current.get("reversal"):
            reversal = f"{current['reversal']} (current record)"
    return {
        "category": category,
        "operation": operation,
        "raw_action": str(event.get("action") or "Not recorded"),
        "recorded_uk": format_uk_timestamp(event.get("created_at")),
        "actor_label": event.get("actor_label") or "Not recorded",
        "party_display": party,
        "amount_display": amount_display,
        "reference_display": reference,
        "project_display": project,
        "status_display": status,
        "currency_display": currency,
        "related_display": related,
        "reversal_display": reversal,
        "historical_amount": historical_amount,
        "historical_reference": historical_reference,
        "reason": event.get("reason") or "Not recorded",
        "evidence_note": "Historical before/after values were not recorded." if snapshots_missing else "Values stored on the event are shown as recorded. Current linked-record values are labelled separately.",
        "counts_as_payment": False,
        "before_json": before,
        "after_json": after,
    }


_COMPANY = "company_id = :company_id"

LOOKUP_SQL: dict[str, str] = {
    "supplier_payment": f"""
        SELECT payment.id AS entity_id, payment.amount AS amount, payment.status AS status,
               payment.currency_code AS currency, payment.external_reference AS reference,
               counterparty.name AS party
        FROM finance_supplier_payments payment
        LEFT JOIN finance_counterparties counterparty
          ON counterparty.id = payment.counterparty_id AND counterparty.company_id = payment.company_id
        WHERE payment.{_COMPANY} AND payment.id IN :ids
    """,
    "supplier_payment_allocation": f"""
        SELECT allocation.id AS entity_id, allocation.amount AS amount, allocation.status AS status,
               payment.currency_code AS currency,
               document.external_reference AS reference,
               counterparty.name AS party,
               payment.external_reference AS related,
               CASE WHEN reversal.id IS NULL THEN NULL ELSE 'Posted reversal linked' END AS reversal
        FROM finance_supplier_payment_allocations allocation
        JOIN finance_supplier_payments payment
          ON payment.id = allocation.payment_id AND payment.company_id = allocation.company_id
        JOIN finance_cost_documents document
          ON document.id = allocation.cost_document_id AND document.company_id = allocation.company_id
        LEFT JOIN finance_counterparties counterparty
          ON counterparty.id = COALESCE(payment.counterparty_id, document.counterparty_id)
         AND counterparty.company_id = allocation.company_id
        LEFT JOIN finance_supplier_payment_allocation_reversals reversal
          ON reversal.allocation_id = allocation.id AND reversal.company_id = allocation.company_id
         AND reversal.status = 'posted'
        WHERE allocation.{_COMPANY} AND allocation.id IN :ids
    """,
    "supplier_payment_allocation_reversal": f"""
        SELECT reversal.id AS entity_id, reversal.amount AS amount, reversal.status AS status,
               'GBP' AS currency, document.external_reference AS reference,
               counterparty.name AS party, payment.external_reference AS related,
               'This event is the reversal of the linked allocation' AS reversal
        FROM finance_supplier_payment_allocation_reversals reversal
        JOIN finance_supplier_payment_allocations allocation
          ON allocation.id = reversal.allocation_id AND allocation.company_id = reversal.company_id
        JOIN finance_supplier_payments payment
          ON payment.id = allocation.payment_id AND payment.company_id = allocation.company_id
        JOIN finance_cost_documents document
          ON document.id = allocation.cost_document_id AND document.company_id = allocation.company_id
        LEFT JOIN finance_counterparties counterparty
          ON counterparty.id = COALESCE(payment.counterparty_id, document.counterparty_id)
         AND counterparty.company_id = reversal.company_id
        WHERE reversal.{_COMPANY} AND reversal.id IN :ids
    """,
    "supplier_payment_reversal": f"""
        SELECT reversal.id AS entity_id, reversal.amount AS amount, reversal.status AS status,
               payment.currency_code AS currency, payment.external_reference AS reference,
               counterparty.name AS party, payment.external_reference AS related,
               'This event is the reversal of the linked payment' AS reversal
        FROM finance_supplier_payment_reversals reversal
        JOIN finance_supplier_payments payment
          ON payment.id = reversal.payment_id AND payment.company_id = reversal.company_id
        LEFT JOIN finance_counterparties counterparty
          ON counterparty.id = payment.counterparty_id AND counterparty.company_id = payment.company_id
        WHERE reversal.{_COMPANY} AND reversal.id IN :ids
    """,
    "finance_cost_document": f"""
        SELECT document.id AS entity_id, document.gross_amount AS amount, document.status AS status,
               document.currency_code AS currency, document.external_reference AS reference,
               counterparty.name AS party,
               CASE WHEN (
                   SELECT COUNT(DISTINCT allocation.project_id)
                   FROM finance_cost_lines line
                   JOIN finance_cost_allocations allocation
                     ON allocation.line_id = line.id AND allocation.company_id = line.company_id
                   WHERE line.document_id = document.id AND line.company_id = document.company_id
               ) = 1 THEN (
                   SELECT project.name
                   FROM finance_cost_lines line
                   JOIN finance_cost_allocations allocation
                     ON allocation.line_id = line.id AND allocation.company_id = line.company_id
                   JOIN finance_projects project
                     ON project.id = allocation.project_id AND project.company_id = allocation.company_id
                   WHERE line.document_id = document.id AND line.company_id = document.company_id
                   LIMIT 1
               ) ELSE NULL END AS project
        FROM finance_cost_documents document
        LEFT JOIN finance_counterparties counterparty
          ON counterparty.id = document.counterparty_id AND counterparty.company_id = document.company_id
        WHERE document.{_COMPANY} AND document.id IN :ids
    """,
    "finance_customer_receipt": f"""
        SELECT receipt.id AS entity_id, receipt.amount AS amount, receipt.status AS status,
               receipt.currency_code AS currency, receipt.external_reference AS reference,
               counterparty.name AS party
        FROM finance_customer_receipts receipt
        LEFT JOIN finance_counterparties counterparty
          ON counterparty.id = receipt.counterparty_id AND counterparty.company_id = receipt.company_id
        WHERE receipt.{_COMPANY} AND receipt.id IN :ids
    """,
    "finance_customer_invoice": f"""
        SELECT invoice.id AS entity_id, invoice.gross_amount AS amount, invoice.status AS status,
               invoice.currency_code AS currency, invoice.external_reference AS reference,
               counterparty.name AS party, project.name AS project
        FROM finance_customer_invoices invoice
        LEFT JOIN finance_counterparties counterparty
          ON counterparty.id = invoice.counterparty_id AND counterparty.company_id = invoice.company_id
        LEFT JOIN finance_projects project
          ON project.id = invoice.project_id AND project.company_id = invoice.company_id
        WHERE invoice.{_COMPANY} AND invoice.id IN :ids
    """,
    "finance_worker_payment": f"""
        SELECT payment.id AS entity_id, payment.amount AS amount, payment.status AS status,
               payment.currency_code AS currency, payment.external_reference AS reference,
               worker.email AS party
        FROM finance_worker_payments payment
        LEFT JOIN users worker
          ON worker.id = payment.source_user_id AND worker.company_id = payment.company_id
        WHERE payment.{_COMPANY} AND payment.id IN :ids
    """,
    "retention_release": f"""
        SELECT release.id AS entity_id, release.amount AS amount, release.status AS status,
               'GBP' AS currency, certificate.certificate_reference AS reference,
               project.name AS project
        FROM finance_retention_releases release
        LEFT JOIN finance_payment_certificates certificate
          ON certificate.id = release.certificate_id AND certificate.company_id = release.company_id
        LEFT JOIN finance_payment_applications application
          ON application.id = certificate.application_id AND application.company_id = certificate.company_id
        LEFT JOIN finance_projects project
          ON project.id = application.project_id AND project.company_id = application.company_id
        WHERE release.{_COMPANY} AND release.id IN :ids
    """,
    "finance_retention_release": f"""
        SELECT release.id AS entity_id, release.amount AS amount, release.status AS status,
               'GBP' AS currency, certificate.certificate_reference AS reference,
               project.name AS project
        FROM finance_retention_releases release
        LEFT JOIN finance_payment_certificates certificate
          ON certificate.id = release.certificate_id AND certificate.company_id = release.company_id
        LEFT JOIN finance_payment_applications application
          ON application.id = certificate.application_id AND application.company_id = certificate.company_id
        LEFT JOIN finance_projects project
          ON project.id = application.project_id AND project.company_id = application.company_id
        WHERE release.{_COMPANY} AND release.id IN :ids
    """,
}


def enrich_audit_rows(db_session: Session, company_id: uuid.UUID, rows: list[dict[str, object]]) -> list[dict[str, object]]:
    grouped: dict[str, list[uuid.UUID]] = {}
    for row in rows:
        entity_type = str(row.get("entity_type") or "")
        if entity_type not in LOOKUP_SQL or not row.get("entity_id"):
            continue
        try:
            grouped.setdefault(entity_type, []).append(uuid.UUID(str(row["entity_id"])))
        except ValueError:
            continue
    found: dict[tuple[str, str], dict[str, object]] = {}
    for entity_type, ids in grouped.items():
        statement = text(LOOKUP_SQL[entity_type]).bindparams(bindparam("ids", expanding=True))
        for item in db_session.execute(statement, {"company_id": company_id, "ids": ids}).mappings():
            found[(entity_type, str(item["entity_id"]))] = dict(item)
    for row in rows:
        current = found.get((str(row.get("entity_type") or ""), str(row.get("entity_id") or "")))
        row.update(present_audit_row(row, current))
    return rows
