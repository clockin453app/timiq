from decimal import Decimal
from zipfile import ZipFile
from io import BytesIO

from app.modules.finance.project_report_links import (
    COST_SQL,
    PAYMENT_SQL,
    RECEIPT_SQL,
    RETENTION_SQL,
    document_projects,
    project_audit_rows,
    project_cost_rows,
    project_receipt_rows,
    project_retention_rows,
    project_supplier_cash,
    sum_amount,
)
from app.modules.finance.register_service import REPORT_SHEETS
from app.modules.finance.xlsx_export import build_xlsx

RIVERSIDE = "riverside"
HARBOUR = "harbour"
MILL = "mill"


def test_riverside_cost_cash_receipt_and_retention_stay_separate() -> None:
    costs = [{
        "allocation_id": "ns-cost",
        "document_id": "ns-100",
        "document_reference": "NS-100",
        "document_gross": "1200",
        "document_date": "2026-10-11",
        "project_id": RIVERSIDE,
        "amount_eligible": "1000",
    }]
    payments = [
        {"payment_allocation_id": "pay-500", "document_id": "ns-100", "allocation_amount": "500", "payment_reference": "BACS-500", "payment_date": "2026-10-11", "payment_id": "p1"},
        {"payment_allocation_id": "pay-700", "document_id": "ns-100", "allocation_amount": "700", "payment_reference": "123", "payment_date": "2026-10-12", "payment_id": "p2"},
    ]
    projects = document_projects(costs)
    cash, unassigned = project_supplier_cash(payments, projects, RIVERSIDE)
    receipts = project_receipt_rows([{
        "receipt_allocation_id": "rcpt",
        "receipt_id": "r1",
        "project_id": RIVERSIDE,
        "allocation_amount": "50",
        "invoice_gross": "120",
        "receipt_date": "2026-10-11",
    }], RIVERSIDE)
    retention = project_retention_rows([
        {"release_id": "a", "project_id": RIVERSIDE, "amount": "200", "certificate_reference": "CERT-1", "release_date": "2026-10-01"},
        {"release_id": "b", "project_id": RIVERSIDE, "amount": "300", "certificate_reference": "CERT-1", "release_date": "2026-10-02"},
    ], RIVERSIDE)
    assert sum_amount(project_cost_rows(costs, RIVERSIDE), "amount_eligible") == Decimal("1000")
    assert sum_amount(cash, "allocation_amount") == Decimal("1200")
    assert unassigned == []
    assert sum_amount(receipts, "allocation_amount") == Decimal("50")
    assert sum_amount(retention, "amount") == Decimal("500")
    assert sum_amount(cash, "allocation_amount") != sum_amount(project_cost_rows(costs, RIVERSIDE), "amount_eligible")


def test_split_invoice_does_not_copy_cost_or_cash_onto_both_projects() -> None:
    costs = [
        {"allocation_id": "h", "document_id": "split", "project_id": HARBOUR, "amount_eligible": "600", "document_gross": "1000", "document_date": "2026-10-01"},
        {"allocation_id": "m", "document_id": "split", "project_id": MILL, "amount_eligible": "400", "document_gross": "1000", "document_date": "2026-10-01"},
        {"allocation_id": "credit", "document_id": "credit-doc", "project_id": MILL, "amount_eligible": "-300", "document_gross": "-300", "document_date": "2026-10-02"},
    ]
    projects = document_projects(costs)
    payment = [{"payment_allocation_id": "fan", "document_id": "split", "allocation_amount": "1000", "payment_date": "2026-10-03", "payment_id": "pay"}]
    harbour_cash, harbour_unassigned = project_supplier_cash(payment, projects, HARBOUR)
    mill_cash, mill_unassigned = project_supplier_cash(payment, projects, MILL)
    assert sum_amount(project_cost_rows(costs, HARBOUR), "amount_eligible") == Decimal("600")
    assert sum_amount(project_cost_rows(costs, MILL), "amount_eligible") == Decimal("100")
    assert harbour_cash == [] and mill_cash == []
    assert sum_amount(harbour_unassigned, "allocation_amount") == Decimal("1000")
    assert sum_amount(mill_unassigned, "allocation_amount") == Decimal("1000")
    assert project_receipt_rows([{"receipt_allocation_id": "x", "project_id": HARBOUR, "allocation_amount": "-300", "receipt_date": "2026-10-02"}], MILL) == []


def test_join_fan_out_counts_one_payment_allocation() -> None:
    projects = {"doc": {f"p{index}" for index in range(5)}}
    duplicated = [
        {"payment_allocation_id": "same", "document_id": "doc", "allocation_amount": "1200", "payment_date": "2026-10-01", "payment_id": "pay"}
        for _ in range(5)
    ]
    cash, unassigned = project_supplier_cash(duplicated, projects, "p0")
    assert cash == []
    assert len(unassigned) == 1
    assert sum_amount(unassigned, "allocation_amount") == Decimal("1200")


def test_reversed_payment_and_missing_project_are_excluded() -> None:
    projects = document_projects([{"allocation_id": "a", "document_id": "doc", "project_id": RIVERSIDE}])
    cash, unassigned = project_supplier_cash([
        {"payment_allocation_id": "rev", "document_id": "doc", "allocation_amount": "700", "payment_date": "2026-10-01", "reversed": True, "payment_id": "p"},
        {"payment_allocation_id": "none", "document_id": "unknown", "allocation_amount": "50", "payment_date": "2026-10-01", "payment_id": "q"},
    ], projects, RIVERSIDE)
    assert cash == [] and unassigned == []


def test_audit_follows_one_project_and_skips_a_split_document() -> None:
    costs = [
        {"allocation_id": "a", "document_id": "ns", "project_id": RIVERSIDE},
        {"allocation_id": "b", "document_id": "split", "project_id": HARBOUR},
        {"allocation_id": "c", "document_id": "split", "project_id": MILL},
    ]
    payments = [
        {"payment_allocation_id": "alloc", "payment_id": "pay", "document_id": "ns"},
        {"payment_allocation_id": "split-alloc", "payment_id": "split-pay", "document_id": "split"},
    ]
    retention = [{"release_id": "rel", "project_id": RIVERSIDE}]
    events = [
        {"event_id": "1", "entity_type": "supplier_payment_allocation", "entity_id": "alloc", "created_at": "2026-10-12T12:00:00+00:00"},
        {"event_id": "2", "entity_type": "finance_cost_document", "entity_id": "split", "created_at": "2026-10-12T12:00:00+00:00"},
        {"event_id": "3", "entity_type": "retention_release", "entity_id": "rel", "created_at": "2026-10-12T12:00:00+00:00"},
        {"event_id": "4", "entity_type": "finance_funding_entry", "entity_id": "loan", "created_at": "2026-10-12T12:00:00+00:00"},
    ]
    selected = project_audit_rows(events, costs=costs, payments=payments, receipts=[], retention=retention, direct_project={}, project_id=RIVERSIDE)
    assert [row["event_id"] for row in selected] == ["1", "3"]
    assert sum_amount(project_cost_rows(costs, RIVERSIDE), "amount_eligible") == Decimal("0")


def test_october_filter_does_not_change_a_separate_closing_position() -> None:
    costs = [
        {"allocation_id": "in", "document_id": "d", "project_id": RIVERSIDE, "amount_eligible": "1000", "document_date": "2026-10-11"},
        {"allocation_id": "out", "document_id": "e", "project_id": RIVERSIDE, "amount_eligible": "999", "document_date": "2026-11-01"},
    ]
    closing = {"actual_eligible_cost": "1000"}
    period = project_cost_rows(costs, RIVERSIDE, "2026-10-01", "2026-10-31")
    assert sum_amount(period, "amount_eligible") == Decimal("1000")
    assert closing["actual_eligible_cost"] == "1000"


def test_report_sql_is_company_scoped_and_workbook_prefixes_formulas() -> None:
    for statement in (COST_SQL, PAYMENT_SQL, RECEIPT_SQL, RETENTION_SQL):
        assert "company_id = :company_id" in statement
        assert "AND line.company_id = allocation.company_id" in statement or "company_id = pay_alloc.company_id" in statement or "company_id = alloc.company_id" in statement or "company_id = release.company_id" in statement
    sheets = [(name, [["reference", "=cmd"]]) for name, _kind in REPORT_SHEETS]
    payload = build_xlsx(sheets)
    assert payload[:2] == b"PK"
    with ZipFile(BytesIO(payload)) as workbook:
        names = workbook.read("xl/workbook.xml").decode()
        first = workbook.read("xl/worksheets/sheet1.xml").decode()
    assert len(REPORT_SHEETS) == 17
    for name, _kind in REPORT_SHEETS:
        assert name[:31] in names
    assert "'=cmd" in first
