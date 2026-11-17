"""Read-only register search. Company scope stays in the SQL that loaded the rows."""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")
PAGE_LIMIT_DEFAULT = 50
PAGE_LIMIT_MAX = 200
EXPORT_ROW_LIMIT = 5000

REGISTER_FIELDS: dict[str, dict[str, object]] = {
    "supplier-invoices": {
        "date_fields": {"expense": "document_date", "due": "due_date", "posting": "created_at"},
        "default_date_field": "expense",
        "search": ["external_reference", "document_type", "project_names", "payment_references"],
        "party": "counterparty_id",
        "project": "project_id",
        "status": "status",
        "reversal": None,
    },
    "supplier-payments": {
        "date_fields": {"payment": "payment_date"},
        "default_date_field": "payment",
        "search": ["external_reference"],
        "party": None,
        "project": None,
        "status": "status",
        "reversal": "payment_reversed",
    },
    "invoices": {
        "date_fields": {"issue": "document_date", "due": "due_date"},
        "default_date_field": "issue",
        "search": ["external_reference", "receipt_references", "document_kind"],
        "party": "counterparty_id",
        "project": "project_id",
        "status": "status",
        "reversal": None,
    },
    "receipts": {
        "date_fields": {"receipt": "receipt_date"},
        "default_date_field": "receipt",
        "search": ["external_reference"],
        "party": "counterparty_id",
        "project": None,
        "status": "status",
        "reversal": "receipt_reversed",
    },
    "retention": {
        "date_fields": {"release": "release_date"},
        "default_date_field": "release",
        "search": [],
        "party": None,
        "project": None,
        "status": "status",
        "reversal": None,
    },
    "dayworks": {
        "date_fields": {"work": "work_date"},
        "default_date_field": "work",
        "search": ["reference_code", "description", "approval_status"],
        "party": None,
        "project": "project_id",
        "status": "approval_status",
        "reversal": None,
    },
    "funding": {
        "date_fields": {"entry": "entry_date"},
        "default_date_field": "entry",
        "search": ["entry_kind", "external_reference"],
        "party": None,
        "project": None,
        "status": "status",
        "reversal": None,
    },
    "commitments": {
        "date_fields": {},
        "default_date_field": None,
        "search": ["reference_code", "commitment_status"],
        "party": "counterparty_id",
        "project": "project_id",
        "status": "status",
        "reversal": None,
    },
    "variations": {
        "date_fields": {},
        "default_date_field": None,
        "search": ["reference_code", "description", "approval_status"],
        "party": None,
        "project": "project_id",
        "status": "approval_status",
        "reversal": None,
    },
    "worker-payments": {
        "date_fields": {"payment": "payment_date"},
        "default_date_field": "payment",
        "search": ["external_reference", "worker_label", "payroll_week"],
        "party": "source_user_id",
        "project": None,
        "status": "status",
        "reversal": "payment_reversed",
    },
    "audit": {
        "date_fields": {"recorded": "created_at"},
        "default_date_field": "recorded",
        "search": ["action", "entity_type", "reason", "actor_label", "category", "operation"],
        "party": None,
        "project": None,
        "status": "action",
        "reversal": None,
    },
}

AUDIT_CATEGORIES: dict[str, str] = {
    "finance_worker_payment": "CIS worker payments",
    "finance_cis_payroll_snapshot": "CIS/HMRC",
    "finance_paye_payroll_snapshot": "PAYE employee payments",
    "finance_supplier_payment": "Supplier payments",
    "supplier_payment": "Supplier payments",
    "supplier_payment_reversal": "Reversals",
    "finance_customer_invoice": "Customer invoices and credits",
    "finance_customer_receipt": "Customer receipts",
    "finance_cost_document": "Project expenses",
    "finance_budget_version": "Budgets and commitments",
    "finance_commitment": "Budgets and commitments",
    "finance_contract_value": "Contracts, variations and dayworks",
    "finance_variation": "Contracts, variations and dayworks",
    "finance_daywork": "Contracts, variations and dayworks",
    "finance_retention_release": "Retentions",
    "finance_funding_entry": "Loans and advances",
    "finance_opening_balance": "Other evidenced financial actions",
    "finance_hmrc_payment": "CIS/HMRC",
}


def audit_category(entity_type: str, action: str) -> str:
    from app.modules.finance.audit_presentation import describe_audit

    return describe_audit(entity_type, action)[0]


def parse_day(value: str | None) -> date | None:
    if value is None or str(value).strip() == "":
        return None
    return date.fromisoformat(str(value)[:10])


def london_day(value: object) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        aware = value if value.tzinfo is not None else value.replace(tzinfo=LONDON)
        return aware.astimezone(LONDON).date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    if len(text) >= 19 and ("T" in text[:11] or text[10] == " "):
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=LONDON)
        return parsed.astimezone(LONDON).date()
    return date.fromisoformat(text[:10])


def in_inclusive_range(value: object, start: date | None, end: date | None) -> bool:
    day = london_day(value)
    if day is None:
        return False
    if start is not None and day < start:
        return False
    if end is not None and day > end:
        return False
    return True


def uk_tax_year_start(today: date) -> date:
    start_year = today.year if (today.month, today.day) >= (4, 6) else today.year - 1
    return date(start_year, 4, 6)


def _reversed(row: dict[str, object], field: str | None) -> bool:
    if not field:
        return False
    value = row.get(field)
    return value is True or value == "true"


def _matches_text(row: dict[str, object], fields: list[str], query: str) -> bool:
    needle = query.strip().casefold()
    if needle == "":
        return True
    haystack = " ".join(str(row.get(field) or "") for field in fields).casefold()
    return needle in haystack


def filter_rows(
    register: str,
    rows: list[dict[str, object]],
    *,
    query: str = "",
    date_field: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    party_id: str | None = None,
    project_id: str | None = None,
    status: str | None = None,
    sort: str | None = None,
    descending: bool = False,
) -> tuple[list[dict[str, object]], list[str]]:
    spec = REGISTER_FIELDS[register]
    unsupported: list[str] = []
    date_fields = spec["date_fields"]
    assert isinstance(date_fields, dict)
    chosen = date_field or spec["default_date_field"]
    column = date_fields.get(str(chosen)) if chosen else None
    if (date_from or date_to) and column is None:
        unsupported.append("date")
    start = parse_day(date_from)
    end = parse_day(date_to)
    party_column = spec["party"]
    project_column = spec["project"]
    if party_id and not party_column:
        unsupported.append("party")
    if project_id and not project_column:
        unsupported.append("project")
    status_column = spec["status"]
    reversal_column = spec["reversal"]
    search_fields = list(spec["search"])  # type: ignore[arg-type]
    selected: list[dict[str, object]] = []
    for row in rows:
        if column is not None and (start or end) and not in_inclusive_range(row.get(str(column)), start, end):
            continue
        if party_id and party_column and str(row.get(str(party_column)) or "") != party_id:
            continue
        if project_id and project_column and str(row.get(str(project_column)) or "") != project_id:
            continue
        if status and status.lower() != "all" and status_column:
            if status.lower() == "reversed":
                if not _reversed(row, str(reversal_column) if reversal_column else None):
                    continue
            elif str(row.get(str(status_column)) or "").casefold() != status.casefold():
                continue
        if not _matches_text(row, search_fields, query):
            continue
        selected.append(row)
    sort_key = sort if sort and any(sort == name or sort in date_fields.values() for name in [*(date_fields.values()), "amount", "created_at", "external_reference"]) else None
    if sort_key:
        selected.sort(key=lambda row: (str(row.get(sort_key) or ""), str(row.get("id") or "")))
    else:
        selected.sort(key=lambda row: (str(row.get("created_at") or row.get("payment_date") or row.get("document_date") or ""), str(row.get("id") or "")))
    if descending or sort_key is None:
        if sort_key is None:
            selected.reverse()
        elif descending:
            selected.reverse()
    return selected, unsupported


def page_rows(rows: list[dict[str, object]], *, limit: int, offset: int) -> dict[str, object]:
    bounded = min(max(limit, 1), PAGE_LIMIT_MAX)
    start = max(offset, 0)
    return {"rows": rows[start : start + bounded], "total": len(rows), "limit": bounded, "offset": start}


def effective_amount(rows: list[dict[str, object]], amount_key: str, reversal_key: str | None) -> Decimal | None:
    total = Decimal("0")
    for row in rows:
        if reversal_key and row.get(reversal_key) is None and reversal_key in REGISTER_FIELDS.get("worker-payments", {}):
            return None
        if _reversed(row, reversal_key):
            continue
        if reversal_key and reversal_key not in row:
            return None
        amount = row.get(amount_key)
        if amount is None:
            return None
        total += Decimal(str(amount))
    return total


_SECRET = re.compile(r"password|token|secret|cookie|hash", re.IGNORECASE)


def sanitize_audit_payload(value: object) -> object:
    if isinstance(value, dict):
        cleaned: dict[str, object] = {}
        for key, item in value.items():
            cleaned[str(key)] = "Not available" if _SECRET.search(str(key)) else sanitize_audit_payload(item)
        return cleaned
    if isinstance(value, list):
        return [sanitize_audit_payload(item) for item in value]
    return value


def csv_cell(value: object) -> str:
    if value is None:
        return ""
    text = str(value)
    if text[:1] in {"=", "+", "-", "@"}:
        text = "'" + text
    return text
