"""Focused layout checks for TimIQ portrait Payroll Report PDF + print HTML."""

from __future__ import annotations

import inspect
from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader

from app.modules.payroll import pdf_export
from app.modules.payroll import service as payroll_service
from app.modules.payroll.pdf_export import (
    _COL_WIDTHS,
    _MARGIN_X,
    _PRINTABLE_WIDTH,
    build_payroll_report_pdf,
)


def _sample_row(i: int, *, employee: str | None = None, status: str | None = None) -> dict[str, str]:
    return {
        "employee": employee or f"Employee {i:02d} Long Name",
        "role": "Supervisor/Foreman" if i % 5 == 0 else "Site operative",
        "period": "2025-01-06 to 2025-01-12",
        "hours": "40.00",
        "ot_hours": "2.00",
        "gross": "500.00",
        "cis_tax": "100.00",
        "net": "400.00",
        "other_deductions": "0.00",
        "status": status
        or ("Completed" if i % 3 == 0 else "Pending" if i % 3 == 1 else "Paid"),
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


def test_pdf_source_uses_a4_portrait_not_landscape() -> None:
    source = inspect.getsource(pdf_export.build_payroll_report_pdf)
    module = inspect.getsource(pdf_export)
    assert "pagesize=A4" in source
    assert "landscape(A4)" not in source
    assert "landscape" not in source.lower()
    assert "_MARGIN_X = 7 * mm" in module
    assert "repeatRows=1" in source
    assert "KeepTogether([notes_line" in source
    assert "KeepTogether([table" not in source
    assert "page-break-before" not in source.lower()


def test_pdf_column_widths_fill_printable_portrait_width() -> None:
    assert abs(sum(_COL_WIDTHS) - _PRINTABLE_WIDTH) < 0.05
    assert 6 * 2.834645669 <= _MARGIN_X <= 8 * 2.834645669
    fracs = [w / _PRINTABLE_WIDTH for w in _COL_WIDTHS]
    assert abs(fracs[0] - 0.16) < 0.02
    assert abs(fracs[3] - 0.07) < 0.02
    assert abs(sum(fracs) - 1.0) < 0.001


def test_pdf_source_alignments_and_status_colours() -> None:
    source = inspect.getsource(pdf_export.build_payroll_report_pdf)
    module = inspect.getsource(pdf_export)
    assert 'ALIGN", (0, 0), (2, -1), "LEFT"' in source
    assert 'ALIGN", (3, 0), (8, -1), "RIGHT"' in source
    assert 'ALIGN", (9, 0), (9, -1), "CENTER"' in source
    assert "166534" in module
    assert "dcfce7" in module
    assert "9a3412" in module
    assert "ffedd5" in module
    assert "fontSize=7.9" in source
    assert "Notes:" in source
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


def test_print_html_source_portrait_rules() -> None:
    source = inspect.getsource(payroll_service.export_print_html)
    assert "size: A4 portrait" in source
    assert "landscape" not in source
    assert "max-width: 1100px" not in source
    assert "width: 100%" in source
    assert "Notes:" in source
    assert "status-completed" in source
    assert "status-pending" in source
    assert "status-paid" in source
    assert 'th class="num"' in source
    assert 'th class="status-col"' in source
    assert "thead {{ display: table-header-group; }}" in source
    assert "break-inside: avoid" in source
    assert "Email</th>" not in source


def test_build_one_row_portrait_pdf() -> None:
    body = _build([_sample_row(1)])
    reader = PdfReader(BytesIO(body))
    assert len(reader.pages) == 1
    page = reader.pages[0]
    width = float(page.mediabox.width)
    height = float(page.mediabox.height)
    assert height > width
    assert abs(width - 595.28) < 2.0
    assert abs(height - 841.89) < 2.0
    text = page.extract_text() or ""
    assert "TimIQ Payroll Report" in text
    assert "Summary" in text
    assert "Notes:" in text
    assert "Payroll rows" in text
    assert "Employee 01" in text


def test_build_eight_row_portrait_pdf() -> None:
    body = _build([_sample_row(i) for i in range(1, 9)])
    reader = PdfReader(BytesIO(body))
    assert 1 <= len(reader.pages) <= 2
    first = reader.pages[0].extract_text() or ""
    assert "Summary" in first
    assert "Stored pay totals" in first


def test_build_eighteen_twentyfive_forty_portrait_pagination() -> None:
    counts: dict[int, int] = {}
    for n in (18, 25, 40):
        body = _build([_sample_row(i) for i in range(1, n + 1)])
        reader = PdfReader(BytesIO(body))
        counts[n] = len(reader.pages)
        all_text = "\n".join((page.extract_text() or "") for page in reader.pages)
        assert f"Employee {n:02d}" in all_text
        assert "Page 1 of" in all_text
        if len(reader.pages) > 1:
            assert "Employee" in (reader.pages[1].extract_text() or "")
    assert counts[40] >= counts[25] >= 1
    assert counts[40] >= 2


def test_status_values_preserved_in_pdf_text() -> None:
    rows = [
        _sample_row(1, status="Completed"),
        _sample_row(2, status="Pending"),
        _sample_row(3, status="Paid"),
    ]
    body = _build(rows)
    text = "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(body)).pages)
    assert "Completed" in text
    assert "Pending" in text
    assert "Paid" in text


def test_money_formatting_helpers_unchanged() -> None:
    assert pdf_export._money(Decimal("1234.5")) == "£1,234.50"
    assert pdf_export._money(None) == "—"
    assert pdf_export._hours(7380) == "2.05"


def test_pdf_module_path_is_api_side() -> None:
    path = Path(pdf_export.__file__).resolve()
    assert path.name == "pdf_export.py"
