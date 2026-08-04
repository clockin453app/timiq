"""Focused layout checks for TimIQ Payroll Report PDF + print HTML."""

from __future__ import annotations

import inspect
from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader

from app.modules.payroll import pdf_export
from app.modules.payroll import service as payroll_service
from app.modules.payroll.pdf_export import build_payroll_report_pdf


def _sample_row(i: int) -> dict[str, str]:
    return {
        "employee": f"Employee {i:02d} Long Name",
        "role": "Site operative",
        "period": "2025-01-06 to 2025-01-12",
        "hours": "40.00",
        "ot_hours": "2.00",
        "gross": "500.00",
        "cis_tax": "100.00",
        "net": "400.00",
        "other_deductions": "0.00",
        "status": "Completed" if i % 2 == 0 else "Pending",
    }


def _build(rows: list[dict[str, str]], *, alerts: list[str] | None = None) -> bytes:
    return build_payroll_report_pdf(
        company_name="Acme Construction Ltd",
        week_start=date(2025, 1, 6),
        week_end=date(2025, 1, 12),
        timezone_name="Europe/London",
        rows=rows,
        total_hours_seconds=sum(int(float(r["hours"]) * 3600) for r in rows) if rows else 0,
        total_gross=Decimal("4000.00") if rows else None,
        total_cis_tax=Decimal("800.00") if rows else None,
        total_net=Decimal("3200.00") if rows else None,
        alert_lines=alerts
        or ["Stored pay totals are shown only for complete payroll weeks fully inside this range."],
        period_label="Payroll week: 2025-01-06 to 2025-01-12",
        employee_filter_label="All employees",
        employee_count=len({r["employee"] for r in rows}) if rows else 0,
    )


def test_pdf_source_uses_a4_landscape_and_compact_margins() -> None:
    source = inspect.getsource(pdf_export.build_payroll_report_pdf)
    assert "landscape(A4)" in source
    assert "11 * mm" in source or "11*mm" in source
    assert "colWidths=[4.0 * cm, 3.0 * cm]" not in source
    assert "eef2ff" not in source
    assert "c7d2fe" not in source
    assert "repeatRows=1" in source
    assert "KeepTogether" in source
    assert "page-break-before" not in source.lower()
    assert "minHeight" not in source and "min_height" not in source


def test_pdf_source_header_is_two_column_not_floating_summary() -> None:
    source = inspect.getsource(pdf_export.build_payroll_report_pdf)
    assert "details_w = usable_width * 0.62" in source
    assert "summary_w = usable_width * 0.38" in source
    assert '[[details, summary]]' in source or "[[details, summary]]" in source.replace(" ", "")
    assert "_p(\"Summary\"" in source or '_p("Summary"' in source


def test_pdf_source_notes_strip_and_columns() -> None:
    source = inspect.getsource(pdf_export.build_payroll_report_pdf)
    assert '_p("Notes"' in source or "_p(\"Notes\"" in source
    for col in (
        "Employee",
        "Role",
        "Period / date",
        "Hours",
        "OT h",
        "Gross",
        "CIS tax",
        "Net",
        "Other ded.",
        "Status",
    ):
        assert col in source
    assert '(3, 1), (8, -1), "RIGHT"' in source


def test_pdf_source_footer_page_x_of_y() -> None:
    source = inspect.getsource(pdf_export)
    assert "TimIQ Payroll Report" in source
    assert "Page {self._pageNumber} of {page_count}" in source
    assert "canvasmaker=_NumberedCanvas" in source


def test_print_html_source_compact_layout_rules() -> None:
    source = inspect.getsource(payroll_service.export_print_html)
    assert "size: A4 landscape" in source
    assert "report-header" in source
    assert "grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr)" in source
    assert "thead { display: table-header-group; }" in source or "thead {{ display: table-header-group; }}" in source
    assert "break-inside: avoid" in source
    assert "page-break-before" not in source
    assert "min-height:" not in source
    assert "Email</th>" not in source
    assert "Period / date" in source
    assert 'class="num"' in source
    assert 'class="text"' in source
    assert "report-canvas" in source
    assert "Notes" in source
    assert "Payroll rows" in source


def test_build_one_row_pdf_is_compact_single_page() -> None:
    body = _build([_sample_row(1)])
    reader = PdfReader(BytesIO(body))
    assert len(reader.pages) == 1
    text = reader.pages[0].extract_text() or ""
    assert "TimIQ Payroll Report" in text
    assert "Summary" in text
    assert "Notes" in text
    assert "Payroll rows" in text
    assert "Employee 01" in text
    assert "Gross pay" in text
    assert "£4,000.00" in text or "4000.00" in text or "4,000.00" in text


def test_build_eight_row_pdf_stays_efficient() -> None:
    body = _build([_sample_row(i) for i in range(1, 9)])
    reader = PdfReader(BytesIO(body))
    assert 1 <= len(reader.pages) <= 2
    first = reader.pages[0].extract_text() or ""
    assert "Summary" in first
    assert "Stored pay totals" in first
    assert "Employee 01" in first


def test_build_twenty_row_pdf_paginates_with_continuous_table() -> None:
    body = _build([_sample_row(i) for i in range(1, 21)])
    reader = PdfReader(BytesIO(body))
    assert len(reader.pages) >= 1
    all_text = "\n".join((page.extract_text() or "") for page in reader.pages)
    assert "Employee 01" in all_text
    assert "Employee 20" in all_text
    assert "Page 1 of" in all_text
    if len(reader.pages) > 1:
        assert f"Page 2 of {len(reader.pages)}" in all_text


def test_build_forty_row_pdf_multi_page_stable() -> None:
    body = _build([_sample_row(i) for i in range(1, 41)])
    reader = PdfReader(BytesIO(body))
    assert len(reader.pages) >= 2
    all_text = "\n".join((page.extract_text() or "") for page in reader.pages)
    assert "Employee 01" in all_text
    assert "Employee 40" in all_text
    assert f"Page {len(reader.pages)} of {len(reader.pages)}" in all_text
    # Landscape A4 width/height sanity via mediabox
    page0 = reader.pages[0]
    width = float(page0.mediabox.width)
    height = float(page0.mediabox.height)
    assert width > height
    assert abs(width - 841.89) < 2.0
    assert abs(height - 595.28) < 2.0


def test_money_formatting_helpers_unchanged() -> None:
    assert pdf_export._money(Decimal("1234.5")) == "£1,234.50"
    assert pdf_export._money(None) == "—"
    assert pdf_export._hours(7380) == "2.05"


def test_pdf_module_path_is_api_side() -> None:
    path = Path(pdf_export.__file__).resolve()
    assert "modules" in path.parts
    assert path.name == "pdf_export.py"
