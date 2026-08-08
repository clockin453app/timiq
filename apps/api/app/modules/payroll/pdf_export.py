"""ReportLab A4-portrait payroll report — employee → week → days → weekly pay."""

from __future__ import annotations

import html
from datetime import date, datetime, timezone
from decimal import Decimal
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.modules.payroll.hierarchical_report import (
    PayrollHierarchicalReport,
    hours_display,
    money_display,
)

_PAGE_WIDTH, _PAGE_HEIGHT = A4
_MARGIN_X = 12 * mm
_MARGIN_TOP = 12 * mm
_MARGIN_BOTTOM = 14 * mm
_PRINTABLE_WIDTH = _PAGE_WIDTH - (2 * _MARGIN_X)

# Day | Site | Hours | OT  (~22 / 48 / 15 / 15)
_DAY_COL_FRACS = (0.22, 0.48, 0.15, 0.15)
_DAY_COL_WIDTHS = [round(_PRINTABLE_WIDTH * f, 4) for f in _DAY_COL_FRACS]
_DAY_COL_WIDTHS[1] = _PRINTABLE_WIDTH - _DAY_COL_WIDTHS[0] - _DAY_COL_WIDTHS[2] - _DAY_COL_WIDTHS[3]

_STATUS_STYLES: dict[str, tuple[str, str]] = {
    "completed": ("#166534", "#dcfce7"),
    "pending": ("#9a3412", "#ffedd5"),
    "paid": ("#166534", "#dcfce7"),
}


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(text or "—").replace("\n", "<br/>"), style)


class _NumberedCanvas(pdf_canvas.Canvas):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict[str, Any]] = []

    def showPage(self) -> None:  # noqa: N802
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        page_count = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_page_footer(page_count)
            super().showPage()
        super().save()

    def _draw_page_footer(self, page_count: int) -> None:
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#6b7280"))
        y = 7 * mm
        self.drawString(_MARGIN_X, y, "TimIQ Payroll Report")
        self.drawRightString(_PAGE_WIDTH - _MARGIN_X, y, f"Page {self._pageNumber} of {page_count}")
        self.restoreState()


def build_hierarchical_payroll_pdf(report: PayrollHierarchicalReport) -> bytes:
    styles = getSampleStyleSheet()
    title_s = ParagraphStyle(
        "PRTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=17,
        spaceAfter=4,
        textColor=colors.HexColor("#111827"),
    )
    emp_s = ParagraphStyle(
        "PREmp",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        spaceBefore=8,
        spaceAfter=1,
        textColor=colors.HexColor("#111827"),
    )
    meta_s = ParagraphStyle(
        "PRMeta",
        parent=styles["Normal"],
        fontSize=10,
        leading=12,
        textColor=colors.HexColor("#374151"),
    )
    week_s = ParagraphStyle(
        "PRWeek",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=13,
        spaceBefore=5,
        spaceAfter=3,
        textColor=colors.HexColor("#111827"),
    )
    cell_s = ParagraphStyle(
        "PRCell",
        parent=styles["Normal"],
        fontSize=10,
        leading=12,
        textColor=colors.HexColor("#111827"),
    )
    cell_right = ParagraphStyle("PRCellR", parent=cell_s, alignment=TA_RIGHT)
    hdr_s = ParagraphStyle(
        "PRHdr",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=11,
        textColor=colors.HexColor("#111827"),
        alignment=TA_LEFT,
    )
    hdr_right = ParagraphStyle("PRHdrR", parent=hdr_s, alignment=TA_RIGHT)
    label_s = ParagraphStyle(
        "PRLabel",
        parent=styles["Normal"],
        fontSize=10,
        leading=12,
        textColor=colors.HexColor("#4b5563"),
    )
    value_s = ParagraphStyle(
        "PRValue",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=12,
        alignment=TA_RIGHT,
        textColor=colors.HexColor("#111827"),
    )
    notes_s = ParagraphStyle(
        "PRNotes",
        parent=styles["Normal"],
        fontSize=9,
        leading=11,
        textColor=colors.HexColor("#374151"),
    )
    small_s = ParagraphStyle(
        "PRSmall",
        parent=styles["Normal"],
        fontSize=9,
        leading=11,
        textColor=colors.HexColor("#6b7280"),
    )

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=_MARGIN_X,
        rightMargin=_MARGIN_X,
        topMargin=_MARGIN_TOP,
        bottomMargin=_MARGIN_BOTTOM,
        title="TimIQ Payroll Report",
        author="TimIQ",
    )
    story: list[Any] = []
    story.append(_p("TimIQ Payroll Report", title_s))
    story.append(_p(f"Company: {report.company_name}", meta_s))
    story.append(_p(f"Period: {report.period_label}", meta_s))
    story.append(_p(f"Filter: {report.employee_filter_label}", meta_s))
    story.append(_p(f"Timezone: {report.timezone_name}", meta_s))
    story.append(_p(f"Generated: {report.generated_label}", small_s))
    story.append(Spacer(1, 3 * mm))

    # Report-level summary strip
    summary_rows = [
        [_p("Total hours", label_s), _p(f"{report.total_hours_seconds / 3600:,.2f}", value_s)],
        [_p("Employees", label_s), _p(str(report.employee_count), value_s)],
        [_p("Gross", label_s), _p(money_display(report.total_gross), value_s)],
        [_p("CIS tax", label_s), _p(money_display(report.total_cis_tax), value_s)],
        [_p("Net", label_s), _p(money_display(report.total_net), value_s)],
    ]
    summary = Table(summary_rows, colWidths=[_PRINTABLE_WIDTH * 0.45, _PRINTABLE_WIDTH * 0.55])
    summary.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#e5e7eb")),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ],
        ),
    )
    story.append(summary)
    note_body = " · ".join(report.alert_lines) if report.alert_lines else "No additional notes for this report."
    story.append(Spacer(1, 2 * mm))
    story.append(_p(f"Notes: {note_body}", notes_s))
    story.append(Spacer(1, 2 * mm))

    if not report.employees:
        story.append(_p("No payable payroll rows for this selected range.", meta_s))
    else:
        for emp in report.employees:
            emp_bits: list[Any] = [
                _p(f"EMPLOYEE: {emp.employee_name}", emp_s),
                _p(f"ROLE: {emp.role or '—'}", meta_s),
                Spacer(1, 1 * mm),
            ]
            story.append(KeepTogether(emp_bits))

            for week in emp.weeks:
                week_bits: list[Any] = [_p(week.week_label, week_s)]
                day_data: list[list[Any]] = [
                    [
                        _p("Day", hdr_s),
                        _p("Site", hdr_s),
                        _p("Hours", hdr_right),
                        _p("OT", hdr_right),
                    ],
                ]
                if week.days:
                    for day in week.days:
                        site = day.site
                        if day.role:
                            site = f"{site}\n({day.role})"
                        day_data.append(
                            [
                                _p(day.day_label, cell_s),
                                _p(site, cell_s),
                                _p(hours_display(day.hours), cell_right),
                                _p(
                                    hours_display(day.ot_hours) if day.ot_hours is not None else "—",
                                    cell_right,
                                ),
                            ],
                        )
                else:
                    day_data.append(
                        [
                            _p("—", cell_s),
                            _p("No worked days with payable hours", cell_s),
                            _p("—", cell_right),
                            _p("—", cell_right),
                        ],
                    )
                days_table = Table(day_data, colWidths=_DAY_COL_WIDTHS, repeatRows=1)
                days_table.setStyle(
                    TableStyle(
                        [
                            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                            ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 4),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                            ("TOPPADDING", (0, 0), (-1, -1), 3),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                            ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
                        ],
                    ),
                )
                week_bits.append(days_table)
                week_bits.append(Spacer(1, 1.5 * mm))
                week_bits.append(_p("Weekly payroll", week_s))
                status_key = (week.status or "").strip().lower()
                status_fg, status_bg = _STATUS_STYLES.get(status_key, ("#111827", "#f3f4f6"))
                pay_rows = [
                    [_p("Hours", label_s), _p(hours_display(week.hours), value_s)],
                    [_p("OT", label_s), _p(hours_display(week.ot_hours), value_s)],
                    [_p("Gross", label_s), _p(money_display(week.gross), value_s)],
                    [_p("CIS tax", label_s), _p(money_display(week.cis_tax), value_s)],
                    [_p("Other deductions", label_s), _p(money_display(week.other_deductions), value_s)],
                    [_p("Net", label_s), _p(money_display(week.net), value_s)],
                    [_p("Status", label_s), _p((week.status or "—").strip().title(), value_s)],
                ]
                pay_table = Table(pay_rows, colWidths=[_PRINTABLE_WIDTH * 0.45, _PRINTABLE_WIDTH * 0.55])
                pay_table.setStyle(
                    TableStyle(
                        [
                            ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#d1d5db")),
                            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
                            ("LEFTPADDING", (0, 0), (-1, -1), 5),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                            ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
                            ("BACKGROUND", (1, -1), (1, -1), colors.HexColor(status_bg)),
                            ("TEXTCOLOR", (1, -1), (1, -1), colors.HexColor(status_fg)),
                        ],
                    ),
                )
                week_bits.append(pay_table)
                story.append(KeepTogether(week_bits))
                story.append(Spacer(1, 2 * mm))

            tot_rows = [
                [_p("Days worked", label_s), _p(str(emp.days_worked), value_s)],
                [_p("Weeks worked", label_s), _p(str(emp.weeks_worked), value_s)],
                [_p("Hours", label_s), _p(hours_display(emp.hours), value_s)],
                [_p("OT", label_s), _p(hours_display(emp.ot_hours), value_s)],
                [_p("Gross", label_s), _p(money_display(emp.gross), value_s)],
                [_p("CIS", label_s), _p(money_display(emp.cis_tax), value_s)],
                [_p("Other deductions", label_s), _p(money_display(emp.other_deductions), value_s)],
                [_p("Net", label_s), _p(money_display(emp.net), value_s)],
            ]
            tot_table = Table(tot_rows, colWidths=[_PRINTABLE_WIDTH * 0.45, _PRINTABLE_WIDTH * 0.55])
            tot_table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
                        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#9ca3af")),
                        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
                        ("LEFTPADDING", (0, 0), (-1, -1), 5),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
                    ],
                ),
            )
            story.append(KeepTogether([_p(report.totals_heading, week_s), tot_table]))
            story.append(Spacer(1, 5 * mm))

    doc.build(story, canvasmaker=_NumberedCanvas)
    return buf.getvalue()


# Public geometry constants (tests + layout math).
# Day table columns: Day | Site | Hours | OT
_COL_WIDTHS = _DAY_COL_WIDTHS


def build_payroll_report_pdf(
    *,
    company_name: str,
    week_start: date,
    week_end: date,
    timezone_name: str,
    rows: list[dict[str, Any]],
    total_hours_seconds: int,
    total_gross: Decimal | None,
    total_cis_tax: Decimal | None,
    total_net: Decimal | None,
    alert_lines: list[str],
    period_label: str | None = None,
    employee_filter_label: str | None = None,
    employee_count: int | None = None,
) -> bytes:
    """Build PDF from legacy flat rows by converting to hierarchical structure."""
    from app.modules.payroll.hierarchical_report import build_hierarchical_payroll_report

    del employee_count  # derived from hierarchy
    shift_rows = [r for r in rows if str(r.get("row_type") or "") == "shift" or (
        not str(r.get("gross") or "").strip() or str(r.get("gross")) in {"—", "-"}
    ) and r.get("shift_date")]
    # Heuristic: if no explicit types, treat rows with empty/dash money as shifts when period looks like a day.
    if not any(r.get("row_type") for r in rows):
        shift_rows = []
        payroll_rows = []
        for r in rows:
            period = str(r.get("period") or "")
            if " to " in period or (r.get("gross") not in (None, "", "—", "-") and str(r.get("gross")).strip()):
                payroll_rows.append(
                    {
                        **r,
                        "period": period or f"{week_start.isoformat()} to {week_end.isoformat()}",
                        "row_type": "payroll_week_total",
                    },
                )
            else:
                shift_rows.append(
                    {
                        **r,
                        "shift_date": r.get("period") or r.get("shift_date") or week_start.isoformat(),
                        "period": week_start.isoformat(),
                        "location": r.get("location") or "—",
                        "row_type": "shift",
                    },
                )
    else:
        payroll_rows = [r for r in rows if str(r.get("row_type") or "") == "payroll_week_total"]
        shift_rows = [r for r in rows if str(r.get("row_type") or "") == "shift"]

    report = build_hierarchical_payroll_report(
        company_name=company_name,
        period_label=period_label or f"Payroll week: {week_start.isoformat()} to {week_end.isoformat()}",
        timezone_name=timezone_name,
        employee_filter_label=employee_filter_label or "All employees",
        generated_label=datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC"),
        alert_lines=alert_lines,
        shift_rows=shift_rows,
        payroll_rows=payroll_rows,
        total_hours_seconds=total_hours_seconds,
        total_gross=total_gross,
        total_cis_tax=total_cis_tax,
        total_net=total_net,
    )
    return build_hierarchical_payroll_pdf(report)


def build_payroll_item_payslip_pdf(
    *,
    company_name: str,
    employee_name: str,
    employee_email: str | None,
    national_insurance_number: str | None,
    utr_number: str | None,
    week_start: date,
    week_end: date,
    timezone_name: str,
    generated_at: str,
    status_label: str,
    pay_date_label: str,
    week_label: str,
    payment_mode_label: str,
    regular_hours: float,
    overtime_hours: float,
    total_hours: float,
    gross_amount: Decimal | None,
    cis_tax_amount: Decimal | None,
    other_deductions_amount: Decimal,
    additions_amount: Decimal,
    net_amount: Decimal | None,
    ytd_taxable_pay: Decimal,
    ytd_cis_deducted: Decimal,
) -> bytes:
    styles = getSampleStyleSheet()
    text = colors.HexColor("#111827")
    muted = colors.HexColor("#64748b")
    accent = colors.HexColor("#2f6f9e")
    border = colors.HexColor("#d9e0ea")
    soft_border = colors.HexColor("#e5e7eb")
    company_title = ParagraphStyle(
        "PayslipCompanyTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=17,
        leading=21,
        textColor=text,
    )
    company_label = ParagraphStyle(
        "PayslipCompanyLabel",
        parent=styles["Normal"],
        fontSize=8.0,
        leading=10.0,
        textColor=muted,
    )
    employee_title = ParagraphStyle(
        "PayslipEmployeeTitle",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=13.5,
        leading=17,
        textColor=text,
    )
    statement_title = ParagraphStyle(
        "PayslipStatementTitle",
        parent=company_title,
        fontSize=17,
        leading=21,
        alignment=TA_RIGHT,
    )
    statement_meta = ParagraphStyle(
        "PayslipStatementMeta",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10.0,
        leading=13.0,
        alignment=TA_RIGHT,
        textColor=colors.HexColor("#334155"),
    )
    generated_style = ParagraphStyle(
        "PayslipGenerated",
        parent=statement_meta,
        fontSize=7.8,
        leading=10.0,
        textColor=muted,
    )
    section_title = ParagraphStyle(
        "PayslipSectionTitle",
        parent=styles["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=8.4,
        leading=10.8,
        textColor=accent,
    )
    label = ParagraphStyle(
        "PayslipLabel",
        parent=styles["Normal"],
        fontSize=9.0,
        leading=12.5,
        textColor=colors.HexColor("#475569"),
    )
    value = ParagraphStyle(
        "PayslipValue",
        parent=label,
        fontName="Helvetica-Bold",
        fontSize=9.2,
        leading=12.5,
        textColor=text,
    )
    right = ParagraphStyle("PayslipRight", parent=value, alignment=TA_RIGHT)

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=1.35 * cm,
        leftMargin=1.35 * cm,
        topMargin=1.25 * cm,
        bottomMargin=1.25 * cm,
        pageCompression=0,
    )
    story: list[Any] = []
    full_width = doc.width
    statement_heading = "CIS Pay Statement" if cis_tax_amount is not None and cis_tax_amount != 0 else "Payslip"

    def _footer(canvas, doc_obj) -> None:  # type: ignore[no-untyped-def]
        canvas.saveState()
        canvas.setFont("Helvetica", 7.4)
        canvas.setFillColor(muted)
        y = 0.62 * cm
        canvas.drawString(doc_obj.leftMargin, y, "Please keep this for your records.")
        canvas.drawRightString(doc_obj.pagesize[0] - doc_obj.rightMargin, y, f"Page {doc_obj.page}")
        canvas.restoreState()

    header_left = Table(
        [
            [_p(company_name.upper(), company_title)],
            [_p("Company", company_label)],
            [_p(employee_name, employee_title)],
            [_p(f"UTR: {utr_number or 'Not provided'}", label)],
            [_p(f"National Insurance: {national_insurance_number or 'Not provided'}", label)],
        ],
        colWidths=[full_width * 0.48],
    )
    header_left.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 2), (0, 2), 8),
            ],
        ),
    )
    header_right = Table(
        [
            [_p(statement_heading, statement_title)],
            [_p(week_label, statement_meta)],
            [_p(f"Generated: {generated_at}", generated_style)],
        ],
        colWidths=[full_width * 0.42],
    )
    header_right.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 2), (0, 2), 8),
            ],
        ),
    )
    header = Table(
        [[header_left, header_right]],
        colWidths=[full_width * 0.52, full_width * 0.48],
    )
    header.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
                ("LINEBELOW", (0, 0), (-1, -1), 0.6, soft_border),
            ],
        ),
    )

    def _rows(rows: list[tuple[str, str]], *, total_index: int | None = None) -> Table:
        table = Table(
            [[_p(label_text, label), _p(value_text, right)] for label_text, value_text in rows],
            colWidths=[full_width * 0.24, full_width * 0.17],
        )
        style: list[tuple[Any, ...]] = [
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]
        if total_index is not None:
            style.append(("LINEABOVE", (0, total_index), (-1, total_index), 0.6, soft_border))
            style.append(("TOPPADDING", (0, total_index), (-1, total_index), 8))
        table.setStyle(TableStyle(style))
        return table

    left_body = Table(
        [
            [_p("PAY SUMMARY", section_title)],
            [
                _rows(
                    [
                        ("Status", status_label),
                        ("Payment type", payment_mode_label),
                        ("Hours worked", f"{total_hours:.2f}"),
                        ("Gross pay", _money(gross_amount)),
                        ("CIS tax", _money(cis_tax_amount)),
                        ("Total net pay", _money(net_amount)),
                    ],
                    total_index=5,
                ),
            ],
        ],
        colWidths=[full_width * 0.41],
    )
    left_body.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ],
        ),
    )

    pay_date_style = ParagraphStyle(
        "PayslipPayDate",
        parent=section_title,
        textColor=colors.HexColor("#334155"),
    )
    right_body = Table(
        [
            [_p(f"PAY DATE: {pay_date_label}", pay_date_style)],
            [_p("YEAR TO DATE", section_title)],
            [_rows([("Taxable Pay", _money(ytd_taxable_pay)), ("CIS deducted YTD", _money(ytd_cis_deducted))])],
        ],
        colWidths=[full_width * 0.41],
    )
    right_body.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 1), (0, 1), 8),
            ],
        ),
    )

    body = Table(
        [[left_body, "", right_body]],
        colWidths=[full_width * 0.43, full_width * 0.10, full_width * 0.47],
    )
    body.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 14),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
            ],
        ),
    )

    accent_bar = Table([[""]], colWidths=[full_width], rowHeights=[0.14 * cm])
    accent_bar.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), accent)]))

    document = Table([[header], [body], [accent_bar]], colWidths=[full_width])
    document.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, border),
                ("LEFTPADDING", (0, 0), (-1, -1), 18),
                ("RIGHTPADDING", (0, 0), (-1, -1), 18),
                ("TOPPADDING", (0, 0), (-1, -1), 16),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
                ("LEFTPADDING", (0, 2), (0, 2), 18),
                ("RIGHTPADDING", (0, 2), (0, 2), 18),
                ("TOPPADDING", (0, 2), (0, 2), 0),
                ("BOTTOMPADDING", (0, 2), (0, 2), 16),
            ],
        ),
    )
    story.append(document)
    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
