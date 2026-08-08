"""A4 portrait hierarchical payroll report — compact employee-page layout checks."""

from __future__ import annotations

import inspect
from datetime import date, timedelta
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
    _BODY_PT,
    _COL_WIDTHS,
    _MARGIN_X,
    _MIN_BODY_PT,
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
    other: str = "0.00",
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
        "other_deductions": other,
        "status": status,
    }


def _build_report(shifts, pays, *, totals_heading: str = "Employee period total", period_label: str = "W31 · 27 Jul–2 Aug 2026"):
    user_ids = {p["user_id"] for p in pays} or {"u1"}
    n = len(user_ids)
    return build_hierarchical_payroll_report(
        company_name="Acme Construction Ltd",
        period_label=period_label,
        timezone_name="Europe/London",
        employee_filter_label="All employees",
        generated_label="08 Aug 2026, 15:39 UTC",
        alert_lines=["Stored pay totals are shown only for complete payroll weeks fully inside this range."],
        shift_rows=shifts,
        payroll_rows=pays,
        total_hours_seconds=int(sum(Decimal(p["hours"]) for p in pays) * 3600) if pays else int(38 * 3600 * n),
        total_gross=sum((Decimal(p["gross"]) for p in pays), Decimal("0")),
        total_cis_tax=sum((Decimal(p["cis_tax"]) for p in pays), Decimal("0")),
        total_net=sum((Decimal(p["net"]) for p in pays), Decimal("0")),
        totals_heading=totals_heading,
    )


def _week_days(start: date, n: int = 5) -> list[date]:
    out: list[date] = []
    d = start
    while len(out) < n:
        if d.weekday() != 6:
            out.append(d)
        d += timedelta(days=1)
    return out


def _period(ws: date) -> str:
    return f"{ws.isoformat()} to {(ws + timedelta(days=6)).isoformat()}"


def _four_week_employee(*, long_sites: bool = False, weeks: int = 4, days_per_week: int = 5):
    name = "Petre Rotaru"
    hours = ["8.50", "8.50", "8.50", "6.50", "6.00"]
    shifts = []
    pays = []
    for i in range(weeks):
        ws = date(2026, 7, 27) + timedelta(weeks=i)
        for j, d in enumerate(_week_days(ws, days_per_week)):
            site = (
                "Kennington Site South Extension Phase Two"
                if long_sites and j % 2
                else "Kennington"
            )
            shifts.append(_shift(name, d.isoformat(), site, hours[j % len(hours)], week_start=ws.isoformat()))
        pays.append(_pay(name, period=_period(ws), status="pending" if i == weeks - 1 else "paid"))
    return shifts, pays


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


def test_pdf_a4_portrait_and_compact_content() -> None:
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
    page = reader.pages[-1]
    width = float(page.mediabox.width)
    height = float(page.mediabox.height)
    assert height > width
    assert abs(width - 595.28) < 2.0
    text = "\n".join((p.extract_text() or "") for p in reader.pages)
    assert "EMPLOYEE: Petre Rotaru" in text
    assert "ROLE: Foreman" in text
    assert "Kennington" in text
    assert "760.00" in text
    assert "Paid" in text or "PAID" in text.upper()
    assert "Days" in text and "Weeks" in text
    assert "Gross" in text and "CIS" in text and "Net" in text
    assert "Employee period total" not in text
    assert "Weekly payroll" not in text
    assert "Period / date" not in text


def test_pdf_column_widths_fit_printable_area() -> None:
    assert abs(sum(_COL_WIDTHS) - _PRINTABLE_WIDTH) < 0.05
    assert _MARGIN_X >= 10 * 2.834645669
    assert _BODY_PT >= _MIN_BODY_PT


def test_pdf_source_is_portrait_employee_pages() -> None:
    source = inspect.getsource(pdf_export.build_hierarchical_payroll_pdf)
    module = inspect.getsource(pdf_export)
    assert "pagesize=A4" in source
    assert "PageBreak" in source
    assert "landscape" not in module.lower()
    assert "EMPLOYEE:" in module
    assert "fontSize=7.9" not in module
    assert "Employee period total" not in source


def test_print_html_compact_employee_pages() -> None:
    source = inspect.getsource(print_html_mod.render_hierarchical_payroll_print_html)
    assert "size: A4 portrait" in source
    assert "landscape" not in source
    assert "EMPLOYEE:" in source
    assert "page-break-before: always" in source
    assert "employee-summary" in source
    assert "week-foot" in source
    assert "Weekly payroll" not in source
    assert "employee-total" not in source
    assert "Email</th>" not in source


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
    assert "employee-summary" in html
    assert "week-foot" in html
    assert "£760.00" in html
    assert "Weekly payroll" not in html
    assert "Employee period total" not in html
    assert "2026-07-27 to 2026-08-02" not in html


def test_four_week_employee_targets_one_page() -> None:
    shifts, pays = _four_week_employee(weeks=4, days_per_week=5)
    doc = _build_report(
        shifts,
        pays,
        totals_heading="Employee month total",
        period_label="27 Jul–23 Aug 2026",
    )
    assert doc.employees[0].days_worked == 20
    assert doc.employees[0].weeks_worked == 4
    body = build_hierarchical_payroll_pdf(doc)
    reader = PdfReader(BytesIO(body))
    # Cover + one employee page expected (2), employee content on last page alone.
    assert len(reader.pages) <= 2
    emp_pages = [p for p in reader.pages if "EMPLOYEE: Petre Rotaru" in (p.extract_text() or "")]
    assert len(emp_pages) == 1


def test_five_week_employee_page_budget() -> None:
    shifts, pays = _four_week_employee(weeks=5, days_per_week=5)
    doc = _build_report(
        shifts,
        pays,
        totals_heading="Employee month total",
        period_label="27 Jul–30 Aug 2026",
    )
    assert doc.employees[0].days_worked == 25
    assert doc.employees[0].weeks_worked == 5
    body = build_hierarchical_payroll_pdf(doc)
    reader = PdfReader(BytesIO(body))
    # Prefer 1 employee page (+ cover); allow 2 employee pages for readability.
    emp_pages = [p for p in reader.pages if "EMPLOYEE: Petre Rotaru" in (p.extract_text() or "")]
    assert 1 <= len(emp_pages) <= 2
    assert len(reader.pages) <= 3


def test_four_employees_each_start_new_page() -> None:
    shifts, pays = [], []
    for i in range(4):
        name = f"Worker {i:02d}"
        uid = f"u{i}"
        s, p = _four_week_employee(weeks=4, days_per_week=4)
        for row in s:
            row["employee"] = name
            row["user_id"] = uid
            row["employee_email"] = f"{uid}@ex.com"
        for row in p:
            row["employee"] = name
            row["user_id"] = uid
            row["employee_email"] = f"{uid}@ex.com"
        shifts.extend(s)
        pays.extend(p)
    doc = _build_report(shifts, pays, totals_heading="Employee month total", period_label="Jul–Aug 2026")
    body = build_hierarchical_payroll_pdf(doc)
    reader = PdfReader(BytesIO(body))
    # Cover + ~4 employee pages (not 8+ fragmented).
    assert 5 <= len(reader.pages) <= 6
    source = inspect.getsource(pdf_export.build_hierarchical_payroll_pdf)
    assert "PageBreak()" in source or "PageBreak()" in inspect.getsource(pdf_export)


def test_payroll_numeric_regression_fixture() -> None:
    shifts, pays = _four_week_employee(weeks=4, days_per_week=5)
    doc = _build_report(shifts, pays, totals_heading="Employee month total")
    emp = doc.employees[0]
    assert emp.hours == Decimal("152.00")  # 4 * 38
    assert emp.ot_hours == Decimal("0.00")
    assert emp.gross == Decimal("3040.00")
    assert emp.cis_tax == Decimal("608.00")
    assert emp.net == Decimal("2432.00")
    assert emp.days_worked == 20
    assert emp.weeks_worked == 4
    assert emp.weeks[-1].status == "pending"


def test_long_site_wrap_builds() -> None:
    shifts, pays = _four_week_employee(weeks=4, days_per_week=5, long_sites=True)
    doc = _build_report(shifts, pays, totals_heading="Employee month total")
    body = build_hierarchical_payroll_pdf(doc)
    text = "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(body)).pages)
    assert "Kennington Site South" in text
    assert "2026-07-27 to" not in text


def test_service_export_helpers_reference_hierarchy() -> None:
    src = inspect.getsource(payroll_service.export_print_html)
    assert "render_hierarchical_payroll_print_html" in src
    pdf_src = inspect.getsource(payroll_service.export_pdf_report)
    assert "build_hierarchical_payroll_pdf" in pdf_src
    assert "pdf_rows.extend" not in pdf_src
