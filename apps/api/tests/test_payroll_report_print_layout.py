"""A4 portrait hierarchical payroll report — print HTML + PDF layout checks."""

from __future__ import annotations

import inspect
from datetime import date
from decimal import Decimal
from io import BytesIO

from pypdf import PdfReader

from app.modules.payroll import pdf_export
from app.modules.payroll import print_html as print_html_mod
from app.modules.payroll import service as payroll_service
from app.modules.payroll.hierarchical_report import (
    build_hierarchical_payroll_report,
    format_short_day,
    format_week_label,
)
from app.modules.payroll.pdf_export import (
    _COL_WIDTHS,
    _MARGIN_X,
    _PRINTABLE_WIDTH,
    build_hierarchical_payroll_pdf,
)


def _shift(employee: str, day: str, site: str, hours: str, *, role: str = "Foreman", user_id: str = "u1", week_start: str = "2026-07-27"):
    return {
        "row_type": "shift",
        "user_id": user_id,
        "employee": employee,
        "employee_email": f"{user_id}@ex.com",
        "role": role,
        "period": week_start,
        "shift_date": day,
        "location": site,
        "hours": hours,
        "ot_hours": "",
        "status": "completed",
    }


def _pay(
    employee: str,
    *,
    hours: str = "38.00",
    ot: str = "0.00",
    gross: str = "760.00",
    cis: str = "152.00",
    net: str = "608.00",
    status: str = "paid",
    user_id: str = "u1",
    period: str = "2026-07-27 to 2026-08-02",
    role: str = "Foreman",
):
    return {
        "row_type": "payroll_week_total",
        "user_id": user_id,
        "employee": employee,
        "employee_email": f"{user_id}@ex.com",
        "role": role,
        "period": period,
        "hours": hours,
        "ot_hours": ot,
        "gross": gross,
        "cis_tax": cis,
        "net": net,
        "other_deductions": "0.00",
        "status": status,
    }


def _build_report(shifts, pays, *, totals_heading: str = "Employee period total"):
    user_ids = {p["user_id"] for p in pays} or {"u1"}
    n = len(user_ids)
    return build_hierarchical_payroll_report(
        company_name="Acme Construction Ltd",
        period_label="W31 · 27 Jul–2 Aug 2026",
        timezone_name="Europe/London",
        employee_filter_label="All employees",
        generated_label="08 Aug 2026, 15:39 UTC",
        alert_lines=["Stored pay totals are shown only for complete payroll weeks fully inside this range."],
        shift_rows=shifts,
        payroll_rows=pays,
        total_hours_seconds=int(38 * 3600 * n),
        total_gross=Decimal("760.00") * n,
        total_cis_tax=Decimal("152.00") * n,
        total_net=Decimal("608.00") * n,
        totals_heading=totals_heading,
    )


def test_short_date_and_week_labels() -> None:
    assert format_short_day(date(2026, 8, 3)) == "Mon 3 Aug"
    label = format_week_label(date(2026, 7, 27), date(2026, 8, 2))
    assert label.startswith("W")
    assert "Jul" in label and "Aug" in label
    assert "2026-07-27" not in label


def test_hierarchy_omits_zero_hour_shifts_and_repeats_identity_once() -> None:
    shifts = [
        _shift("Petre Rotaru", "2026-07-27", "Kennington", "8.50"),
        _shift("Petre Rotaru", "2026-07-28", "Kennington", "0.00"),
        _shift("Petre Rotaru", "2026-07-29", "Kennington", "8.50"),
    ]
    pays = [_pay("Petre Rotaru")]
    doc = _build_report(shifts, pays)
    assert len(doc.employees) == 1
    emp = doc.employees[0]
    assert emp.employee_name == "Petre Rotaru"
    assert len(emp.weeks) == 1
    assert len(emp.weeks[0].days) == 2
    assert all(d.hours > 0 for d in emp.weeks[0].days)
    assert all(d.role is None for d in emp.weeks[0].days)


def test_hierarchy_annotates_role_only_when_week_has_multiple_roles() -> None:
    shifts = [
        _shift("Petre Rotaru", "2026-07-27", "Kennington", "8.50", role="Foreman"),
        _shift("Petre Rotaru", "2026-07-28", "Kennington", "8.50", role="Site Supervisor"),
    ]
    doc = _build_report(shifts, [_pay("Petre Rotaru")])
    days = doc.employees[0].weeks[0].days
    assert {d.role for d in days} == {"Foreman", "Site Supervisor"}


def test_pdf_a4_portrait_and_content() -> None:
    shifts = [
        _shift("Petre Rotaru", "2026-07-27", "Kennington", "8.50"),
        _shift("Petre Rotaru", "2026-07-28", "Kennington", "8.50"),
        _shift("Petre Rotaru", "2026-07-29", "Kennington", "8.50"),
        _shift("Petre Rotaru", "2026-07-30", "Kennington", "6.50"),
        _shift("Petre Rotaru", "2026-08-01", "Kennington", "6.00"),
    ]
    doc = _build_report(shifts, [_pay("Petre Rotaru")])
    body = build_hierarchical_payroll_pdf(doc)
    reader = PdfReader(BytesIO(body))
    page = reader.pages[0]
    width = float(page.mediabox.width)
    height = float(page.mediabox.height)
    assert height > width
    assert abs(width - 595.28) < 2.0
    text = page.extract_text() or ""
    assert "EMPLOYEE: Petre Rotaru" in text
    assert "ROLE: Foreman" in text
    assert "Weekly payroll" in text
    assert "Kennington" in text
    assert "760.00" in text
    assert "Paid" in text
    assert "Period / date" not in text
    assert "Other ded." not in text


def test_pdf_column_widths_fit_printable_area() -> None:
    assert abs(sum(_COL_WIDTHS) - _PRINTABLE_WIDTH) < 0.05
    assert _MARGIN_X >= 11 * 2.834645669


def test_pdf_source_is_portrait_hierarchical() -> None:
    source = inspect.getsource(pdf_export.build_hierarchical_payroll_pdf)
    module = inspect.getsource(pdf_export)
    assert "pagesize=A4" in source
    assert "landscape" not in module.lower()
    assert "EMPLOYEE:" in source
    assert "Weekly payroll" in source
    assert "Day" in source and "Site" in source
    assert "fontSize=7.9" not in source


def test_print_html_hierarchical_rules() -> None:
    source = inspect.getsource(print_html_mod.render_hierarchical_payroll_print_html)
    assert "size: A4 portrait" in source
    assert "landscape" not in source
    assert "EMPLOYEE:" in source
    assert "Weekly payroll" in source
    assert "table.days" in source
    assert "week-block" in source
    assert "break-inside: avoid" in source
    assert "Email</th>" not in source
    assert "Period / date" not in source


def test_print_html_render_sample() -> None:
    shifts = [
        _shift("Petre Rotaru", "2026-07-27", "Kennington", "8.50"),
        _shift("Petre Rotaru", "2026-08-01", "Kennington", "6.00"),
    ]
    doc = _build_report(shifts, [_pay("Petre Rotaru")])
    html = print_html_mod.render_hierarchical_payroll_print_html(doc)
    assert "EMPLOYEE: Petre Rotaru" in html
    assert "Mon 27 Jul" in html
    assert "Sat 1 Aug" in html
    assert "Weekly payroll" in html
    assert "£760.00" in html
    assert html.count("Petre Rotaru") < 8
    assert "2026-07-27 to 2026-08-02" not in html


def test_ten_employees_pdf_builds() -> None:
    shifts = []
    pays = []
    for i in range(10):
        name = f"Worker {i:02d}"
        uid = f"u{i}"
        shifts.append(
            _shift(name, "2026-07-27", "Site Alpha With A Very Long Location Title", "8.00", user_id=uid),
        )
        shifts.append(_shift(name, "2026-07-28", "Site Beta", "8.00", user_id=uid))
        pays.append(_pay(name, user_id=uid, status="pending" if i % 2 else "paid"))
    doc = _build_report(shifts, pays)
    body = build_hierarchical_payroll_pdf(doc)
    reader = PdfReader(BytesIO(body))
    assert len(reader.pages) >= 2
    text0 = reader.pages[0].extract_text() or ""
    assert "TimIQ Payroll Report" in text0


def test_service_export_helpers_reference_hierarchy() -> None:
    src = inspect.getsource(payroll_service.export_print_html)
    assert "render_hierarchical_payroll_print_html" in src
    pdf_src = inspect.getsource(payroll_service.export_pdf_report)
    assert "build_hierarchical_payroll_pdf" in pdf_src
    assert "pdf_rows.extend" not in pdf_src
