"""Read-only Finance search, audit listing and project workbook rows."""

from __future__ import annotations

import csv
import uuid
from datetime import datetime, timezone
from io import StringIO

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.modules.finance.commercial_router import FINANCE_REGISTER_STATEMENTS
from app.modules.finance.commercial_service import list_table, project_cvr
from app.modules.finance.register_query import (
    EXPORT_ROW_LIMIT,
    audit_category,
    csv_cell,
    effective_amount,
    filter_rows,
    page_rows,
    sanitize_audit_payload,
)
from app.modules.finance.xlsx_export import build_xlsx
from app.modules.finance.project_report_links import (
    document_projects,
    load_report_links,
    project_audit_rows,
    project_cost_rows,
    project_credit_rows,
    project_receipt_rows,
    project_retention_rows,
    project_supplier_cash,
    sum_amount,
)

CIS_PAYMENTS_SQL = """
SELECT payment.id, payment.source_user_id, payment.payment_date, payment.external_reference,
       payment.amount, payment.status, payment.created_at,
       COALESCE(users.email, '') AS worker_label,
       EXISTS (
           SELECT 1 FROM finance_worker_payment_reversals reversal_row
           WHERE reversal_row.payment_id = payment.id
             AND reversal_row.company_id = payment.company_id
             AND reversal_row.status = 'posted'
       ) AS payment_reversed,
       (
           SELECT MIN(snapshot.week_start::text)
           FROM finance_worker_payment_allocations allocation
           JOIN finance_cis_payroll_snapshots snapshot
             ON snapshot.id = allocation.cis_snapshot_id
            AND snapshot.company_id = allocation.company_id
           WHERE allocation.payment_id = payment.id
             AND allocation.company_id = payment.company_id
             AND allocation.status = 'posted'
             AND allocation.cis_snapshot_id IS NOT NULL
       ) AS payroll_week
FROM finance_worker_payments payment
LEFT JOIN users ON users.id = payment.source_user_id AND users.company_id = payment.company_id
WHERE payment.company_id = :company_id
"""

AUDIT_SQL = """
SELECT event.id, event.created_at, event.actor_user_id, COALESCE(actor.email, '') AS actor_label,
       event.entity_type, event.entity_id, event.action, event.reason,
       event.before_json, event.after_json
FROM finance_audit_events event
LEFT JOIN users actor ON actor.id = event.actor_user_id
  AND (actor.company_id = event.company_id OR actor.company_id IS NULL)
WHERE event.company_id = :company_id
"""

REPORT_SHEETS = [
    ("01 Executive Summary", "summary"),
    ("02 Contract Variations Dayworks", "commercial"),
    ("03 Customer Invoices", "invoices"),
    ("04 Credit Notes", "credits"),
    ("05 Customer Receipts", "receipts"),
    ("06 Supplier Invoices", "supplier-invoices"),
    ("07 Supplier Payments", "supplier-payments"),
    ("08 CIS Labour Payments", "worker-payments"),
    ("09 PAYE Labour", "paye-note"),
    ("10 Budget And Cost Codes", "budget-note"),
    ("11 Commitments", "commitments"),
    ("12 Cost To Complete CVR", "cvr"),
    ("13 VAT Review", "vat-note"),
    ("14 Retentions", "retention"),
    ("15 Loans And Advances", "funding"),
    ("16 Audit Trail", "audit"),
    ("17 Reconciliation", "reconciliation"),
]


def _blank(value: object) -> str:
    if value is None or value == "":
        return "Not recorded"
    return str(value)


def load_register_rows(db_session: Session, company_id: uuid.UUID, register: str) -> list[dict[str, object]]:
    if register == "worker-payments":
        return [dict(row) for row in db_session.execute(text(CIS_PAYMENTS_SQL), {"company_id": company_id}).mappings()]
    if register == "audit":
        rows = []
        for row in db_session.execute(text(AUDIT_SQL), {"company_id": company_id}).mappings():
            item = dict(row)
            item["category"] = audit_category(str(item.get("entity_type") or ""), str(item.get("action") or ""))
            item["actor_label"] = item.get("actor_label") or "Not recorded"
            item["before_json"] = sanitize_audit_payload(item.get("before_json"))
            item["after_json"] = sanitize_audit_payload(item.get("after_json"))
            if not item.get("reason"):
                item["reason"] = "Not recorded"
            from app.modules.finance.audit_presentation import present_audit_row

            item.update(present_audit_row(item, None))
            rows.append(item)
        return rows
    statement = FINANCE_REGISTER_STATEMENTS.get(register)
    if statement is None:
        raise KeyError(register)
    return list_table(db_session, company_id=company_id, statement=statement)


def query_register(db_session: Session, company_id: uuid.UUID, register: str, **filters: object) -> dict[str, object]:
    allowed = {"query", "date_field", "date_from", "date_to", "party_id", "project_id", "status", "sort", "descending"}
    clean = {key: value for key, value in filters.items() if key in allowed}
    rows, unsupported = filter_rows(register, load_register_rows(db_session, company_id, register), **clean)  # type: ignore[arg-type]
    paged = page_rows(rows, limit=int(filters.get("limit") or 50), offset=int(filters.get("offset") or 0))
    amount_key = "amount" if register in {"worker-payments", "supplier-payments", "receipts"} else None
    reversal_key = "payment_reversed" if register in {"worker-payments", "supplier-payments"} else "receipt_reversed" if register == "receipts" else None
    effective = effective_amount(rows, amount_key, reversal_key) if amount_key else None
    paged["unsupported_filters"] = unsupported
    paged["effective_amount"] = None if effective is None else str(effective)
    paged["effective_amount_note"] = "Reversed rows stay in the list when status is All, and are excluded from effective cash."
    paged["payroll_paid_is_bank_evidence"] = False
    return paged


class ExportTooLarge(Exception):
    def __init__(self, row_count: int) -> None:
        self.row_count = row_count
        super().__init__(
            f"This export has {row_count} matching rows, which is above {EXPORT_ROW_LIMIT}. "
            "No file was created. Narrow the date range or status and export again."
        )


def export_csv(db_session: Session, company_id: uuid.UUID, register: str, **filters: object) -> str:
    allowed = {"query", "date_field", "date_from", "date_to", "party_id", "project_id", "status", "sort", "descending"}
    clean = {key: value for key, value in filters.items() if key in allowed}
    rows, unsupported = filter_rows(register, load_register_rows(db_session, company_id, register), **clean)  # type: ignore[arg-type]
    if len(rows) > EXPORT_ROW_LIMIT:
        raise ExportTooLarge(len(rows))
    if register == "audit":
        from app.modules.finance.audit_presentation import enrich_audit_rows

        rows = enrich_audit_rows(db_session, company_id, rows)
    buffer = StringIO()
    writer = csv.writer(buffer)
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    writer.writerow(["company_id", str(company_id), "register", register, "generated", generated, "row_count", str(len(rows)), "complete", "true", "unsupported", ",".join(unsupported)])
    if rows:
        headers = list(rows[0].keys())
        writer.writerow(headers)
        for row in rows:
            writer.writerow([csv_cell(row.get(header)) for header in headers])
    return buffer.getvalue()


def _project_rows(rows: list[dict[str, object]], project_id: uuid.UUID) -> tuple[list[dict[str, object]], str | None]:
    if rows and "project_id" not in rows[0]:
        return [], "Incomplete — this source has no project link, so it is not attributed to the project."
    selected = [row for row in rows if str(row.get("project_id") or "") == str(project_id)]
    return selected, None


def _table(rows: list[dict[str, object]], note: str | None = None) -> list[list[object]]:
    body: list[list[object]] = []
    if note:
        body.append(["note", note])
    if len(rows) > EXPORT_ROW_LIMIT:
        body.append(["note", f"Incomplete — {len(rows)} matching rows exceed {EXPORT_ROW_LIMIT}. This worksheet does not contain a partial extract. Narrow the activity dates."])
        return body
    if not rows:
        if not note:
            body.append(["note", "No rows in this section for the selected project and dates."])
        return body
    headers = list(rows[0].keys())
    body.append(headers)
    body.extend([[row.get(header) for header in headers] for row in rows])
    return body


def project_report_xlsx(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    project_id: uuid.UUID,
    date_from: str | None = None,
    date_to: str | None = None,
) -> bytes:
    filters = {"date_from": date_from, "date_to": date_to, "query": "", "status": "all", "party_id": None, "project_id": None, "sort": None, "descending": False, "date_field": None}
    invoices, _ = filter_rows("invoices", load_register_rows(db_session, company_id, "invoices"), **filters)
    project_invoices, _invoice_note = _project_rows(invoices, project_id)
    sales = [row for row in project_invoices if str(row.get("document_kind")) == "invoice"]
    workers, _ = filter_rows("worker-payments", load_register_rows(db_session, company_id, "worker-payments"), **filters)
    commitments, commitment_note = _project_rows(load_register_rows(db_session, company_id, "commitments"), project_id)
    variations, _ = _project_rows(load_register_rows(db_session, company_id, "variations"), project_id)
    dayworks, _ = _project_rows(load_register_rows(db_session, company_id, "dayworks"), project_id)
    funding = load_register_rows(db_session, company_id, "funding")
    links = load_report_links(db_session, company_id)
    projects = document_projects(links["costs"])
    costs = project_cost_rows(links["costs"], project_id, date_from, date_to)
    cash, unassigned_cash = project_supplier_cash(links["payments"], projects, project_id, date_from, date_to)
    receipts = project_receipt_rows(links["receipts"], project_id, date_from, date_to)
    linked_credits = project_credit_rows(links["credits"], project_id, date_from, date_to)
    register_credits = [row for row in project_invoices if str(row.get("document_kind")) == "credit"]
    retention = project_retention_rows(links["retention"], project_id, date_from, date_to)
    direct = {
        ("finance_customer_invoice", str(row.get("id"))): str(row.get("project_id"))
        for row in invoices if row.get("project_id")
    }
    for entity, rows in (("finance_commitment", commitments), ("finance_variation", variations), ("finance_daywork", dayworks)):
        for row in rows:
            direct[(entity, str(row.get("id")))] = str(project_id)
    audit_rows = project_audit_rows(
        links["audit"],
        costs=links["costs"],
        payments=links["payments"],
        receipts=links["receipts"],
        retention=links["retention"],
        direct_project=direct,
        project_id=project_id,
        date_from=date_from,
        date_to=date_to,
    )
    cvr = project_cvr(db_session, company_id=company_id, project_id=project_id)
    period = f"{date_from or 'all history'} to {date_to or 'all history'}"
    period_note = "These rows follow the activity dates. They do not replace the closing CVR position." if date_from or date_to else "Activity rows are the full history. Closing CVR figures are the stored project position."
    summary = [
        ["company_id", str(company_id)],
        ["project_id", str(project_id)],
        ["activity_period", period],
        ["note", "Date filters limit activity rows. Closing CVR figures are the stored project position, not a sum of the filtered activity."],
        ["forecast_is_not_realised_profit", "yes"],
        ["vat_recoverable_only_when_classified", "yes"],
        ["loan_principal_is_not_trading_income", "yes"],
        ["payroll_mark_paid_is_not_bank_evidence", "yes"],
        ["project_eligible_cost_in_activity", str(sum_amount(costs, "amount_eligible"))],
        ["project_supplier_cash_not_cost", str(sum_amount(cash, "allocation_amount"))],
        ["unassigned_supplier_cash_excluded", str(sum_amount(unassigned_cash, "allocation_amount"))],
        ["customer_cash_received", str(sum_amount(receipts, "allocation_amount"))],
        ["retention_released_not_income", str(sum_amount(retention, "amount"))],
    ]
    cost_body = [[
        "note",
        "Project cost is the stored eligible allocation. Document gross is shown for reference and is not added again. A supplier payment is not extra cost. " + period_note,
    ], ["allocation_id", "document_reference", "document_type", "document_date", "document_gross", "project_eligible_cost"]]
    cost_body.extend([
        [row.get("allocation_id"), row.get("document_reference"), row.get("document_type"), row.get("document_date"), row.get("document_gross"), row.get("amount_eligible")]
        for row in costs
    ])
    cost_body.append(["project_eligible_total", str(sum_amount(costs, "amount_eligible"))])
    payment_body = [[
        "note",
        "Included amounts are bank settlements of a posted invoice whose stored cost allocations are all for this project. They are cash, not a second project cost. A split invoice is not divided by eligible cost. " + period_note,
    ], ["payment_allocation_id", "payment_reference", "payment_date", "allocation_amount", "included_in_project_cash"]]
    payment_body.extend([
        [row.get("payment_allocation_id"), row.get("payment_reference"), row.get("payment_date"), row.get("allocation_amount"), "yes"]
        for row in cash
    ])
    payment_body.append(["project_supplier_cash_total", str(sum_amount(cash, "allocation_amount"))])
    if unassigned_cash:
        payment_body.append(["note", "Excluded from this project total. The invoice is split across projects and no stored rule assigns this bank payment. Do not add this figure on every project."])
        payment_body.extend([
            [row.get("payment_allocation_id"), row.get("payment_reference"), row.get("payment_date"), row.get("allocation_amount"), "no"]
            for row in unassigned_cash
        ])
    receipt_body = [[
        "note",
        "Cash is the posted receipt allocation to this project's invoice. Invoice gross is not cash and is not added again. " + period_note,
    ], ["receipt_allocation_id", "receipt_reference", "receipt_date", "allocated_cash", "invoice_reference", "invoice_gross"]]
    receipt_body.extend([
        [row.get("receipt_allocation_id"), row.get("receipt_reference"), row.get("receipt_date"), row.get("allocation_amount"), row.get("invoice_reference"), row.get("invoice_gross")]
        for row in receipts
    ])
    receipt_body.append(["customer_cash_total", str(sum_amount(receipts, "allocation_amount"))])
    credit_body = [["note", "A customer credit is not a bank receipt. Supplier credits reduce eligible cost on the supplier invoice sheet."]]
    credit_ids = {str(row.get("credit_id")) for row in linked_credits}
    credit_body.append(["credit_id", "reference", "document_date", "gross_amount"])
    credit_body.extend([[row.get("credit_id"), row.get("external_reference"), row.get("document_date"), row.get("gross_amount")] for row in linked_credits])
    for row in register_credits:
        if str(row.get("id")) in credit_ids:
            continue
        credit_body.append([row.get("id"), row.get("external_reference"), row.get("document_date"), row.get("gross_amount")])
    retention_body = [[
        "note",
        "Released through the certificate and application stored for this project. This is not new contract income. A missing historical audit event is not created. " + period_note,
    ], ["release_id", "certificate_reference", "release_date", "amount"]]
    retention_body.extend([[row.get("release_id"), row.get("certificate_reference"), row.get("release_date"), row.get("amount")] for row in retention])
    retention_body.append(["retention_released_total", str(sum_amount(retention, "amount"))])
    audit_body = [[
        "note",
        "Only events with one verified project relationship are listed. An audit event is not an extra payment. Split-invoice events are omitted rather than copied onto every project. Missing historical events are not invented.",
    ], ["event_id", "created_at", "action", "entity_type", "reason"]]
    audit_body.extend([[row.get("event_id"), row.get("created_at"), row.get("action"), row.get("entity_type"), row.get("reason")] for row in audit_rows])
    sheets: list[tuple[str, list[list[object]]]] = []
    for title, kind in REPORT_SHEETS:
        if kind == "summary":
            body = [list(item) for item in summary]
        elif kind == "commercial":
            body = _table([*variations, *dayworks], "Approved variations and dayworks stored on this project. They are contract items, not cash.")
        elif kind == "invoices":
            body = _table(sales, "Customer invoice gross is not cash received. Outstanding is the stored invoice position.")
        elif kind == "credits":
            body = credit_body
        elif kind == "receipts":
            body = receipt_body
        elif kind == "supplier-invoices":
            body = cost_body
        elif kind == "supplier-payments":
            body = payment_body
        elif kind == "worker-payments":
            body = [["note", "Incomplete — CIS bank payments have no verified project split in this report. Payroll Mark Paid is not used as evidence. They are not a second project expense."], ["company_worker_payment_rows_not_attributed", str(len(workers))]]
        elif kind == "paye-note":
            body = [["note", "Incomplete — PAYE net pay is not attributed to a project unless a future allocation stores that link."]]
        elif kind == "budget-note":
            body = [["note", "Budget lines remain on the project CVR. This sheet does not invent a cost-code export beyond the stored CVR."]]
        elif kind == "commitments":
            body = _table(commitments, (commitment_note or "Commitments use the stored project id.") + " A posted draw reduces open commitment on the CVR. It is not additional forecast cost. This list is the stored commitment position, not a date-filtered activity total.")
        elif kind == "cvr":
            body = [[key, _blank(value)] for key, value in cvr.items()]
            body.insert(0, ["note", "Closing project position. A date filter on the activity sheets does not change these figures."])
        elif kind == "vat-note":
            body = [["note", "Incomplete — neither a zero recoverable amount nor a positive recoverable amount is accountant confirmation. Amount-inferred VAT stays provisional until a review note is stored. Eligible cost still uses the stored amounts."]]
        elif kind == "retention":
            body = retention_body
        elif kind == "funding":
            body = [["note", "Incomplete — loan and advance rows have no stored project link. Principal is not trading income."], ["company_funding_rows_not_attributed", str(len(funding))]]
        elif kind == "audit":
            body = audit_body
        else:
            body = [[
                "note",
                "Reconciliation: eligible project cost is not invoice gross; supplier cash is not a second cost; customer cash is not invoice gross; credits are not receipts; retention release is not income; unassigned split-invoice payments are excluded; forecast margin is not realised profit.",
            ]]
        sheets.append((title, body))
    return build_xlsx(sheets)
