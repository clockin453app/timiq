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
    employee_identity_lines,
    format_short_day,
    format_week_label,
    is_single_week_report,
    money_display,
    status_badge_kind,
    status_display,
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
    assert "EMPLOYEE" in text
    assert "Petre Rotaru" in text
    assert "Foreman" in text
    assert "u1@ex.com" in text
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


def test_pdf_source_is_portrait_adaptive_pages() -> None:
    source = inspect.getsource(pdf_export.build_hierarchical_payroll_pdf)
    module = inspect.getsource(pdf_export)
    assert "pagesize=A4" in source
    assert "PageBreak" in source
    assert "is_single_week_report" in source
    assert "landscape" not in module.lower()
    assert "EMPLOYEE" in module
    assert "fontSize=7.9" not in module
    assert "Employee period total" not in source


def test_print_html_compact_employee_pages() -> None:
    source = inspect.getsource(print_html_mod.render_hierarchical_payroll_print_html)
    assert "size: A4 portrait" in source
    assert "landscape" not in source
    assert "EMPLOYEE" in source
    assert "emp-kicker" in source
    assert "status-badge" in source
    assert "report-single-week" in source
    assert "report-multi-week" in source
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
    assert 'class="emp-kicker">EMPLOYEE</p>' in html
    assert "Petre Rotaru" in html
    assert "u1@ex.com" in html
    assert "Foreman" in html
    assert "Mon 27 Jul" in html
    assert "Sat 1 Aug" in html
    assert "employee-summary" in html
    assert "week-foot" in html
    assert "£760.00" in html
    assert "report-single-week" in html
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
    emp_pages = [p for p in reader.pages if "Petre Rotaru" in (p.extract_text() or "") and "EMPLOYEE" in (p.extract_text() or "")]
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
    emp_pages = [p for p in reader.pages if "Petre Rotaru" in (p.extract_text() or "") and "EMPLOYEE" in (p.extract_text() or "")]
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


def test_is_single_week_detection_including_cross_month() -> None:
    # Cross-month week 27 Jul–2 Aug is still one payroll week.
    shifts = [
        _shift("Petre Rotaru", "2026-07-27", "Kennington", "8.50"),
        _shift("Petre Rotaru", "2026-08-01", "Kennington", "6.00"),
    ]
    doc = _build_report(shifts, [_pay("Petre Rotaru")])
    assert is_single_week_report(doc) is True

    multi_shifts, multi_pays = _four_week_employee(weeks=4, days_per_week=3)
    multi = _build_report(multi_shifts, multi_pays, totals_heading="Employee month total")
    assert is_single_week_report(multi) is False


def _single_week_employees(count: int, *, days: int = 5, long_sites: bool = False):
    shifts, pays = [], []
    hours = ["8.50", "8.50", "8.50", "6.50", "6.00", "7.00", "4.00"]
    ws = date(2026, 8, 3)  # Mon 3 Aug week
    for i in range(count):
        name = f"Worker {i:02d}"
        uid = f"u{i}"
        for j, d in enumerate(_week_days(ws, days)):
            site = (
                "Battersea Power Station Loading Bay North"
                if long_sites and j % 2
                else "Kennington"
            )
            shifts.append(
                _shift(name, d.isoformat(), site, hours[j % len(hours)], user_id=uid, week_start=ws.isoformat()),
            )
        pays.append(
            _pay(
                name,
                user_id=uid,
                period=_period(ws),
                hours=f"{sum(Decimal(hours[j % len(hours)]) for j in range(days)):.2f}",
            ),
        )
    return shifts, pays


def test_single_week_three_employees_share_page() -> None:
    shifts, pays = _single_week_employees(3, days=5)
    doc = _build_report(shifts, pays, period_label="W32 · 3–9 Aug 2026")
    assert is_single_week_report(doc) is True
    body = build_hierarchical_payroll_pdf(doc)
    reader = PdfReader(BytesIO(body))
    # No forced page-per-employee: normally 1–2 pages, not 3+.
    assert 1 <= len(reader.pages) <= 2
    per_page = [(page.extract_text() or "").count("EMPLOYEE") for page in reader.pages]
    assert max(per_page) >= 2
    assert sum(per_page) == 3
    html = print_html_mod.render_hierarchical_payroll_print_html(doc)
    assert 'class="report-canvas report-single-week"' in html


def test_single_week_five_employees_pack_without_forced_breaks() -> None:
    shifts, pays = _single_week_employees(5, days=4)
    doc = _build_report(shifts, pays, period_label="W32 · 3–9 Aug 2026")
    assert is_single_week_report(doc) is True
    source = inspect.getsource(pdf_export.build_hierarchical_payroll_pdf)
    # Forced break only in multi-week branch.
    assert "elif single_week:" in source
    body = build_hierarchical_payroll_pdf(doc)
    reader = PdfReader(BytesIO(body))
    # Pack as many as fit; 5 short blocks should be 1–2 pages, not 5+.
    assert 1 <= len(reader.pages) <= 2
    names_seen = 0
    for page in reader.pages:
        names_seen += (page.extract_text() or "").count("EMPLOYEE")
    assert names_seen == 5


def test_single_week_source_does_not_unconditionally_pagebreak() -> None:
    source = inspect.getsource(pdf_export.build_hierarchical_payroll_pdf)
    assert "if not report.employees:" in source
    assert "elif single_week:" in source
    assert "story.append(PageBreak())" in source
    # PageBreak only inside multi-week else branch, not before every employee blindly.
    multi_branch = source.split("else:", 1)[-1]
    assert "PageBreak()" in multi_branch
    single_branch = source.split("elif single_week:", 1)[1].split("else:", 1)[0]
    assert "PageBreak()" not in single_branch


def test_monthly_four_employees_still_one_per_page() -> None:
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
    assert is_single_week_report(doc) is False
    body = build_hierarchical_payroll_pdf(doc)
    reader = PdfReader(BytesIO(body))
    assert 5 <= len(reader.pages) <= 6
    html = print_html_mod.render_hierarchical_payroll_print_html(doc)
    assert "report-multi-week" in html


def _payroll_data_snapshot(doc):
    return {
        "company": doc.company_name,
        "period": doc.period_label,
        "employee_count": doc.employee_count,
        "total_hours_seconds": doc.total_hours_seconds,
        "total_gross": None if doc.total_gross is None else str(doc.total_gross),
        "total_cis": None if doc.total_cis_tax is None else str(doc.total_cis_tax),
        "total_net": None if doc.total_net is None else str(doc.total_net),
        "employees": [
            {
                "user_key": emp.user_key,
                "employee_name": emp.employee_name,
                "employee_email": emp.employee_email,
                "role": emp.role,
                "days_worked": emp.days_worked,
                "weeks_worked": emp.weeks_worked,
                "hours": str(emp.hours),
                "ot_hours": str(emp.ot_hours),
                "gross": None if emp.gross is None else str(emp.gross),
                "cis_tax": None if emp.cis_tax is None else str(emp.cis_tax),
                "other_deductions": None if emp.other_deductions is None else str(emp.other_deductions),
                "net": None if emp.net is None else str(emp.net),
                "weeks": [
                    {
                        "week_start": week.week_start.isoformat(),
                        "week_end": week.week_end.isoformat(),
                        "week_label": week.week_label,
                        "hours": str(week.hours),
                        "ot_hours": str(week.ot_hours),
                        "gross": None if week.gross is None else str(week.gross),
                        "cis_tax": None if week.cis_tax is None else str(week.cis_tax),
                        "other_deductions": None if week.other_deductions is None else str(week.other_deductions),
                        "net": None if week.net is None else str(week.net),
                        "status": week.status,
                        "days": [
                            {
                                "work_date": day.work_date.isoformat(),
                                "day_label": day.day_label,
                                "site": day.site,
                                "hours": str(day.hours),
                                "ot_hours": None if day.ot_hours is None else str(day.ot_hours),
                                "role": day.role,
                            }
                            for day in week.days
                        ],
                    }
                    for week in emp.weeks
                ],
            }
            for emp in doc.employees
        ],
    }


def test_employee_identity_name_and_email_hierarchy() -> None:
    doc = _build_report(
        [_shift("Marius Mrotaru", "2026-08-10", "Kennington", "8.00", week_start="2026-08-10")],
        [_pay("Marius Mrotaru", period="2026-08-10 to 2026-08-16")],
    )
    emp = doc.employees[0]
    primary, email_line = employee_identity_lines(emp)
    assert primary == "Marius Mrotaru"
    assert email_line == "u1@ex.com"
    html = print_html_mod.render_hierarchical_payroll_print_html(doc)
    assert 'class="emp-kicker">EMPLOYEE</p>' in html
    assert 'class="emp-name">Marius Mrotaru</h2>' in html
    assert 'class="emp-email">u1@ex.com</p>' in html
    assert 'class="emp-role">Foreman</p>' in html
    text = "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(build_hierarchical_payroll_pdf(doc))).pages)
    assert "EMPLOYEE" in text
    assert "Marius Mrotaru" in text
    assert "u1@ex.com" in text
    assert "Foreman" in text


def test_employee_email_omitted_when_unavailable() -> None:
    shifts = [_shift("Petre Rotaru", "2026-08-10", "Kennington", "8.00", week_start="2026-08-10")]
    pays = [_pay("Petre Rotaru", period="2026-08-10 to 2026-08-16")]
    for row in (*shifts, *pays):
        row["employee_email"] = ""
    doc = _build_report(shifts, pays)
    primary, email_line = employee_identity_lines(doc.employees[0])
    assert primary == "Petre Rotaru"
    assert email_line is None
    html = print_html_mod.render_hierarchical_payroll_print_html(doc)
    assert 'class="emp-email"' not in html
    assert "Petre Rotaru" in html


def test_employee_email_only_identity_is_primary() -> None:
    shifts = [_shift("only@site.test", "2026-08-10", "Kennington", "8.00", week_start="2026-08-10")]
    pays = [_pay("only@site.test", period="2026-08-10 to 2026-08-16")]
    for row in (*shifts, *pays):
        row["employee"] = "only@site.test"
        row["employee_email"] = "only@site.test"
    doc = _build_report(shifts, pays)
    primary, email_line = employee_identity_lines(doc.employees[0])
    assert primary == "only@site.test"
    assert email_line is None
    html = print_html_mod.render_hierarchical_payroll_print_html(doc)
    assert 'class="emp-name">only@site.test</h2>' in html
    assert 'class="emp-email"' not in html


def test_status_badges_paid_approved_pending_and_neutral() -> None:
    cases = [
        ("paid", "Paid", "status-badge-paid"),
        ("approved", "Approved", "status-badge-approved"),
        ("pending", "Pending", "status-badge-pending"),
        ("completed", "Completed", "status-badge-neutral"),
        ("rejected", "Rejected", "status-badge-danger"),
    ]
    for stored, label, css in cases:
        assert status_display(stored) == label
        assert status_badge_kind(stored) == css.replace("status-badge-", "")
        shifts = [_shift("Petre Rotaru", "2026-08-10", "Kennington", "8.00", week_start="2026-08-10")]
        pays = [_pay("Petre Rotaru", period="2026-08-10 to 2026-08-16", status=stored)]
        doc = _build_report(shifts, pays)
        assert doc.employees[0].weeks[0].status == stored
        html = print_html_mod.render_hierarchical_payroll_print_html(doc)
        assert f'class="status-badge {css}"' in html
        assert f">{label}</span>" in html
        text = "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(build_hierarchical_payroll_pdf(doc))).pages)
        assert label in text


def test_money_visual_hierarchy_and_large_amounts() -> None:
    matrices = [
        {"gross": "1578.50", "cis": "0.00", "other": "0.00", "net": "1578.50"},
        {"gross": "1578.50", "cis": "315.70", "other": "0.00", "net": "1262.80"},
        {"gross": "1578.50", "cis": "315.70", "other": "25.00", "net": "1237.80"},
        {"gross": "0.00", "cis": "0.00", "other": "0.00", "net": "0.00"},
        {"gross": "12345.67", "cis": "2469.13", "other": "10.00", "net": "9866.54"},
    ]
    for money in matrices:
        pays = [
            _pay(
                "Petre Rotaru",
                period="2026-08-10 to 2026-08-16",
                gross=money["gross"],
                cis=money["cis"],
                other=money["other"],
                net=money["net"],
            ),
        ]
        doc = _build_report([_shift("Petre Rotaru", "2026-08-10", "Kennington", "8.00", week_start="2026-08-10")], pays)
        emp = doc.employees[0]
        week = emp.weeks[0]
        assert money_display(week.gross) == f"£{Decimal(money['gross']):,.2f}"
        assert money_display(week.cis_tax) == f"£{Decimal(money['cis']):,.2f}"
        assert money_display(week.other_deductions) == f"£{Decimal(money['other']):,.2f}"
        assert money_display(week.net) == f"£{Decimal(money['net']):,.2f}"
        html = print_html_mod.render_hierarchical_payroll_print_html(doc)
        assert "money-gross" in html and "money-cis" in html and "money-other" in html and "money-net" in html
        assert f"£{Decimal(money['gross']):,.2f}" in html
        assert f"£{Decimal(money['net']):,.2f}" in html
        text = "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(build_hierarchical_payroll_pdf(doc))).pages)
        compact = text.replace(",", "")
        assert money["gross"].split(".")[0] in compact
        assert money["net"].split(".")[0] in compact


def test_print_pdf_visual_parity_for_identity_status_and_money() -> None:
    pays = [_pay("Petre Rotaru", status="approved", gross="1578.50", cis="0.00", other="0.00", net="1578.50")]
    doc = _build_report([_shift("Petre Rotaru", "2026-08-10", "Kennington", "8.50", week_start="2026-08-10")], pays)
    html = print_html_mod.render_hierarchical_payroll_print_html(doc)
    text = "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(build_hierarchical_payroll_pdf(doc))).pages)
    for token in ("EMPLOYEE", "Petre Rotaru", "u1@ex.com", "Foreman", "Approved", "£1,578.50", "Days", "Gross", "CIS", "Net"):
        assert token in html
        assert token in text or token.replace(",", "") in text.replace(",", "")
    assert "status-badge-approved" in html
    assert "money-net" in html


def test_long_name_and_email_do_not_clip_identity() -> None:
    long_name = "Alexandru-Constantin Papadopoulos-Marinescu"
    long_email = "alexandru.constantin.papadopoulos.marinescu@kennington-south.example.co.uk"
    long_role = "Senior Site Supervisor and Safety Coordinator"
    shifts = [_shift(long_name, "2026-08-10", "Kennington", "8.00", role=long_role, week_start="2026-08-10")]
    pays = [_pay(long_name, period="2026-08-10 to 2026-08-16", role=long_role)]
    for row in (*shifts, *pays):
        row["employee_email"] = long_email
    doc = _build_report(shifts, pays)
    primary, email_line = employee_identity_lines(doc.employees[0])
    assert primary == long_name
    assert email_line == long_email
    html = print_html_mod.render_hierarchical_payroll_print_html(doc)
    assert long_name in html and long_email in html and long_role in html
    assert "overflow-wrap: anywhere" in html
    text = "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(build_hierarchical_payroll_pdf(doc))).pages)
    assert "Alexandru-Constantin" in text
    assert "kennington-south.example.co.uk" in text
    assert "Senior Site Supervisor" in text


def test_seven_employee_single_week_stays_three_pages() -> None:
    shifts, pays = _single_week_employees(7, days=5)
    doc = _build_report(shifts, pays, period_label="W33 · 10–16 Aug 2026")
    body = build_hierarchical_payroll_pdf(doc)
    reader = PdfReader(BytesIO(body))
    assert len(reader.pages) == 3
    assert sum((p.extract_text() or "").count("EMPLOYEE") for p in reader.pages) == 7


def test_one_employee_single_week_stays_one_page() -> None:
    shifts, pays = _single_week_employees(1, days=5)
    doc = _build_report(shifts, pays, period_label="W33 · 10–16 Aug 2026")
    reader = PdfReader(BytesIO(build_hierarchical_payroll_pdf(doc)))
    assert len(reader.pages) == 1


def test_visual_changes_do_not_alter_payroll_values() -> None:
    shifts, pays = _four_week_employee(weeks=4, days_per_week=5)
    doc = _build_report(shifts, pays, totals_heading="Employee month total")
    snap = _payroll_data_snapshot(doc)
    emp = snap["employees"][0]
    assert emp["hours"] == "152.00"
    assert Decimal(emp["ot_hours"]) == Decimal("0.00")
    assert emp["gross"] == "3040.00"
    assert emp["cis_tax"] == "608.00"
    assert Decimal(emp["other_deductions"] or "0") == Decimal("0.00")
    assert emp["net"] == "2432.00"
    assert emp["weeks"][-1]["status"] == "pending"
    assert emp["employee_email"] == "u1@ex.com"
    html = print_html_mod.render_hierarchical_payroll_print_html(doc)
    text = "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(build_hierarchical_payroll_pdf(doc))).pages)
    assert "£3,040.00" in html
    assert "3040.00" in text.replace(",", "")
    rebuilt = _payroll_data_snapshot(_build_report(shifts, pays, totals_heading="Employee month total"))
    assert rebuilt == snap


def test_week_footer_separates_status_badge_from_metrics() -> None:
    html = print_html_mod.render_hierarchical_payroll_print_html(
        _build_report(
            [_shift("Petre Rotaru", "2026-08-10", "Kennington", "8.00", week_start="2026-08-10")],
            [_pay("Petre Rotaru", period="2026-08-10 to 2026-08-16", status="paid")],
        ),
    )
    assert "Days 1 · Hours 38.00 · OT 0.00" in html
    assert "· Status " not in html
    assert "status-cell" in html
    assert "status-badge-paid" in html
    source_pdf = inspect.getsource(pdf_export._week_unit_bits)
    assert "_status_badge" in source_pdf
    assert "· Status " not in source_pdf
