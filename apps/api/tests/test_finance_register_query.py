"""Database-free checks for Finance search, dates and exports."""

from datetime import date, datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.modules.finance.register_query import (
    audit_category,
    csv_cell,
    effective_amount,
    filter_rows,
    in_inclusive_range,
    page_rows,
    sanitize_audit_payload,
    uk_tax_year_start,
)
from app.modules.finance.xlsx_export import build_xlsx


def _payment(day: str, worker: str = "worker-1", amount: str = "300.0000", reversed_payment: bool = False, reference: str = "CIS-1", name: str = "John") -> dict:
    return {
        "id": f"{day}-{reference}",
        "payment_date": day,
        "source_user_id": worker,
        "worker_label": name,
        "amount": amount,
        "status": "posted",
        "payment_reversed": reversed_payment,
        "external_reference": reference,
        "payroll_week": "2026-10-05",
        "created_at": f"{day}T12:00:00+00:00",
    }


def test_october_cis_payments_include_the_final_day_and_all_workers() -> None:
    rows = [
        _payment("2026-09-30", reference="BEFORE"),
        _payment("2026-10-01", reference="START"),
        _payment("2026-10-31", worker="worker-2", name="Ana", reference="END"),
        _payment("2026-10-15", reference="REVERSED", reversed_payment=True),
        _payment("2026-11-01", reference="AFTER"),
    ]
    selected, unsupported = filter_rows(
        "worker-payments",
        rows,
        date_field="payment",
        date_from="2026-10-01",
        date_to="2026-10-31",
        status="all",
    )
    assert unsupported == []
    assert {row["external_reference"] for row in selected} == {"START", "END", "REVERSED"}
    one_worker, _ = filter_rows("worker-payments", selected, party_id="worker-2", date_field="payment", date_from="2026-10-01", date_to="2026-10-31")
    assert [row["worker_label"] for row in one_worker] == ["Ana"]
    assert effective_amount(selected, "amount", "payment_reversed") == Decimal("600.0000")


def test_london_timestamp_includes_the_final_evening_and_excludes_the_next_morning() -> None:
    london = ZoneInfo("Europe/London")
    last_evening = datetime(2026, 10, 31, 23, 30, tzinfo=london)
    next_morning = datetime(2026, 11, 1, 0, 30, tzinfo=london)
    assert in_inclusive_range(last_evening, date(2026, 10, 1), date(2026, 10, 31)) is True
    assert in_inclusive_range(next_morning, date(2026, 10, 1), date(2026, 10, 31)) is False
    before_change = datetime(2026, 10, 25, 0, 30, tzinfo=timezone.utc)
    after_change = datetime(2026, 10, 25, 1, 30, tzinfo=timezone.utc)
    assert before_change.astimezone(london).date() == date(2026, 10, 25)
    assert after_change.astimezone(london).date() == date(2026, 10, 25)


def test_tax_year_search_pagination_and_audit_do_not_invent_or_duplicate_cash() -> None:
    assert uk_tax_year_start(date(2026, 4, 5)) == date(2025, 4, 6)
    assert uk_tax_year_start(date(2026, 4, 6)) == date(2026, 4, 6)
    found, _ = filter_rows("invoices", [{"id": "1", "external_reference": "INV-9", "document_date": "2026-10-02", "counterparty_id": "c1", "project_id": "p1", "status": "posted", "receipt_references": "BANK-9", "document_kind": "invoice"}], query="bank-9")
    assert found[0]["id"] == "1"
    paged = page_rows([{"id": str(index)} for index in range(5)], limit=2, offset=2)
    assert paged["total"] == 5
    assert [row["id"] for row in paged["rows"]] == ["2", "3"]
    assert audit_category("finance_worker_payment", "worker_payment_posted") == "CIS worker payments"
    assert audit_category("finance_retention_release", "retention_released") == "Retentions"
    assert sanitize_audit_payload({"password": "hidden", "amount": "10"})["password"] == "Not available"
    assert csv_cell("=SUM(A1)") == "'=SUM(A1)"
    workbook = build_xlsx([("01 Executive Summary", [["note", "Incomplete"]])])
    assert workbook[:2] == b"PK"


def test_project_filter_is_not_applied_when_the_register_has_no_project() -> None:
    rows, unsupported = filter_rows("receipts", [{"id": "r", "receipt_date": "2026-10-02", "status": "posted", "receipt_reversed": False, "external_reference": "R"}], project_id="project-1")
    assert unsupported == ["project"]
    assert rows[0]["id"] == "r"


def test_workbook_names_and_oversized_export_refusal() -> None:
    from io import BytesIO
    from zipfile import ZipFile
    import inspect

    from app.modules.finance.commercial_router import finance_export_register
    from app.modules.finance.register_service import AUDIT_SQL, CIS_PAYMENTS_SQL, EXPORT_ROW_LIMIT, REPORT_SHEETS, ExportTooLarge

    sheets = [(name, [["note", "Incomplete"], ["reference", "=cmd"]]) for name, _kind in REPORT_SHEETS]
    payload = build_xlsx(sheets)
    with ZipFile(BytesIO(payload)) as archive:
        workbook = archive.read("xl/workbook.xml").decode()
        first = archive.read("xl/worksheets/sheet1.xml").decode()
    assert len(REPORT_SHEETS) == 17
    for name, _kind in REPORT_SHEETS:
        assert name[:31] in workbook
    assert "'=cmd" in first
    assert "X-Export-Truncated" not in inspect.getsource(finance_export_register)
    refused = ExportTooLarge(EXPORT_ROW_LIMIT + 1)
    assert "No file was created" in str(refused)
    assert "users.company_id = payment.company_id" in CIS_PAYMENTS_SQL
    assert "actor.company_id = event.company_id" in AUDIT_SQL
    assert "password_hash" not in AUDIT_SQL
