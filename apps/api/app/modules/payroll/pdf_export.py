"""ReportLab PDF for company/week payroll reports (no storage paths)."""

from __future__ import annotations

import html
from datetime import date, datetime, timezone
from decimal import Decimal
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

# A4 portrait printable geometry (shared by layout math + footer).
_PAGE_WIDTH, _PAGE_HEIGHT = A4
_MARGIN_X = 7 * mm
_MARGIN_TOP = 9 * mm
_MARGIN_BOTTOM = 12 * mm
_PRINTABLE_WIDTH = _PAGE_WIDTH - (2 * _MARGIN_X)

# Column proportions sum to 100% of printable width.
_COL_FRACS = (0.16, 0.12, 0.15, 0.07, 0.06, 0.09, 0.08, 0.09, 0.09, 0.09)
_COL_WIDTHS = [round(_PRINTABLE_WIDTH * frac, 4) for frac in _COL_FRACS]
# Absorb rounding drift into the Employee column so widths sum exactly.
_COL_WIDTHS[0] = _PRINTABLE_WIDTH - sum(_COL_WIDTHS[1:])

_STATUS_STYLES: dict[str, tuple[str, str, str]] = {
    "completed": ("#166534", "#dcfce7", "#86efac"),
    "pending": ("#9a3412", "#ffedd5", "#fdba74"),
    "paid": ("#166534", "#dcfce7", "#86efac"),
}


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(text or "—").replace("\n", "<br/>"), style)


def _money(value: Decimal | float | None) -> str:
    if value is None:
        return "—"
    return f"£{Decimal(value):,.2f}"


def _hours(seconds: int) -> str:
    return f"{seconds / 3600:,.2f}"


def _status_key(raw: str) -> str:
    return str(raw or "").strip().lower()


class _NumberedCanvas(pdf_canvas.Canvas):
    """Footer: TimIQ Payroll Report + Page X of Y."""

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
        self.setFont("Helvetica", 7.5)
        self.setFillColor(colors.HexColor("#6b7280"))
        y = 6 * mm
        self.drawString(_MARGIN_X, y, "TimIQ Payroll Report")
        self.drawRightString(_PAGE_WIDTH - _MARGIN_X, y, f"Page {self._pageNumber} of {page_count}")
        self.restoreState()


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
    styles = getSampleStyleSheet()
    title_s = ParagraphStyle(
        "PayrollReportTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=13.5,
        leading=16,
        spaceAfter=3,
        textColor=colors.HexColor("#111827"),
    )
    label_s = ParagraphStyle(
        "PayrollReportLabel",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7,
        leading=9,
        textColor=colors.HexColor("#4b5563"),
    )
    value_s = ParagraphStyle(
        "PayrollReportValue",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#111827"),
    )
    body = ParagraphStyle(
        "PayrollReportBody",
        parent=styles["Normal"],
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#1f2937"),
    )
    small = ParagraphStyle("PayrollReportSmall", parent=body, fontSize=7.9, leading=9.5)
    right_small = ParagraphStyle("PayrollReportRightSmall", parent=small, alignment=TA_RIGHT)
    center_hdr = ParagraphStyle(
        "PayrollReportCenterHdr",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=9.5,
        textColor=colors.white,
        alignment=TA_CENTER,
    )
    left_hdr = ParagraphStyle(
        "PayrollReportLeftHdr",
        parent=center_hdr,
        alignment=TA_LEFT,
    )
    right_hdr = ParagraphStyle(
        "PayrollReportRightHdr",
        parent=center_hdr,
        alignment=TA_RIGHT,
    )
    metric_label = ParagraphStyle(
        "PayrollReportMetricLabel",
        parent=label_s,
        fontSize=6.5,
        leading=8,
        alignment=TA_LEFT,
    )
    metric_value = ParagraphStyle(
        "PayrollReportMetricValue",
        parent=value_s,
        fontSize=9,
        leading=11,
        alignment=TA_LEFT,
    )
    notes_s = ParagraphStyle(
        "PayrollReportNotes",
        parent=body,
        fontSize=7.5,
        leading=9,
        textColor=colors.HexColor("#374151"),
    )
    section_s = ParagraphStyle(
        "PayrollReportSection",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=11,
        spaceBefore=0,
        spaceAfter=2,
        textColor=colors.HexColor("#111827"),
    )

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=_MARGIN_X,
        rightMargin=_MARGIN_X,
        topMargin=_MARGIN_TOP,
        bottomMargin=_MARGIN_BOTTOM,
        pageCompression=0,
    )
    usable_width = _PRINTABLE_WIDTH
    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    report_period = period_label or f"Payroll week: {week_start.isoformat()} to {week_end.isoformat()}"
    filter_text = employee_filter_label or "All employees"

    story: list[Any] = [_p("TimIQ Payroll Report", title_s)]

    # Compact details grid: Company | Filter / Period full / Timezone | Generated
    label_w = usable_width * 0.14
    value_w = usable_width * 0.36
    details = Table(
        [
            [
                _p("Company", label_s),
                _p(company_name, value_s),
                _p("Employee filter", label_s),
                _p(filter_text, value_s),
            ],
            [_p("Period", label_s), _p(report_period, value_s), "", ""],
            [
                _p("Timezone", label_s),
                _p(timezone_name or "—", value_s),
                _p("Generated", label_s),
                _p(gen, value_s),
            ],
        ],
        colWidths=[label_w, value_w, label_w, value_w],
    )
    details.setStyle(
        TableStyle(
            [
                ("SPAN", (1, 1), (3, 1)),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 1.2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.2),
                ("LINEBELOW", (0, -1), (-1, -1), 0.4, colors.HexColor("#e5e7eb")),
            ],
        ),
    )
    story.append(details)
    story.append(Spacer(1, 2.5 * mm))

    # Compact metric strip (2 rows) — not a floating mid-page table.
    metric_cell_w = usable_width / 3
    metrics_top = Table(
        [
            [
                [_p("Total hours", metric_label), _p(_hours(total_hours_seconds), metric_value)],
                [
                    _p("Employees", metric_label),
                    _p(str(employee_count) if employee_count is not None else "—", metric_value),
                ],
                [_p("Gross pay", metric_label), _p(_money(total_gross), metric_value)],
            ],
        ],
        colWidths=[metric_cell_w, metric_cell_w, metric_cell_w],
    )
    metrics_top.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fafafa")),
                ("LINEAFTER", (0, 0), (1, 0), 0.35, colors.HexColor("#e5e7eb")),
            ],
        ),
    )
    metrics_bottom = Table(
        [
            [
                [_p("CIS tax", metric_label), _p(_money(total_cis_tax), metric_value)],
                [_p("Net pay", metric_label), _p(_money(total_net), metric_value)],
                "",
            ],
        ],
        colWidths=[metric_cell_w, metric_cell_w, metric_cell_w],
    )
    metrics_bottom.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("BACKGROUND", (0, 0), (1, 0), colors.HexColor("#fafafa")),
                ("LINEAFTER", (0, 0), (0, 0), 0.35, colors.HexColor("#e5e7eb")),
                ("LINEABOVE", (0, 0), (1, 0), 0.35, colors.HexColor("#e5e7eb")),
            ],
        ),
    )
    story.append(_p("Summary", label_s))
    story.append(metrics_top)
    story.append(metrics_bottom)
    story.append(Spacer(1, 1.8 * mm))

    note_body = " · ".join(alert_lines) if alert_lines else "No additional notes for this report."
    notes_line = _p(f"Notes: {note_body}", notes_s)
    story.append(KeepTogether([notes_line, Spacer(1, 1.2 * mm), _p("Payroll rows", section_s)]))

    hdr = [
        [
            _p("Employee", left_hdr),
            _p("Role", left_hdr),
            _p("Period / date", left_hdr),
            _p("Hours", right_hdr),
            _p("OT h", right_hdr),
            _p("Gross", right_hdr),
            _p("CIS tax", right_hdr),
            _p("Net", right_hdr),
            _p("Other ded.", right_hdr),
            _p("Status", center_hdr),
        ],
    ]

    def _status_cell(raw: str) -> Any:
        label = str(raw or "—")
        text_c, bg_c, border_c = _STATUS_STYLES.get(
            _status_key(label),
            ("#111827", "#f3f4f6", "#9ca3af"),
        )
        status_style = ParagraphStyle(
            f"PayrollStatus_{_status_key(label) or 'default'}",
            parent=small,
            fontName="Helvetica-Bold",
            fontSize=7.5,
            leading=9,
            textColor=colors.HexColor(text_c),
            alignment=TA_CENTER,
        )
        badge = Table([[_p(label, status_style)]], colWidths=[_COL_WIDTHS[9] - 2])
        badge.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg_c)),
                    ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor(border_c)),
                    ("LEFTPADDING", (0, 0), (-1, -1), 2),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                    ("TOPPADDING", (0, 0), (-1, -1), 1),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ],
            ),
        )
        return badge

    data_rows = [
        [
            _p(str(r["employee"]), small),
            _p(str(r["role"]), small),
            _p(str(r.get("period", "—")), small),
            _p(str(r["hours"]), right_small),
            _p(str(r["ot_hours"]), right_small),
            _p(str(r["gross"]), right_small),
            _p(str(r["cis_tax"]), right_small),
            _p(str(r["net"]), right_small),
            _p(str(r["other_deductions"]), right_small),
            _status_cell(str(r["status"])),
        ]
        for r in rows
    ]
    if not data_rows:
        data_rows = [[_p("No payable payroll rows for this selected range.", body), "", "", "", "", "", "", "", "", ""]]

    assert abs(sum(_COL_WIDTHS) - usable_width) < 0.05
    table = Table(hdr + data_rows, colWidths=_COL_WIDTHS, repeatRows=1)
    style_cmds: list[tuple[Any, ...]] = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("FONTSIZE", (0, 1), (-1, -1), 7.9),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#e5e7eb")),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#9ca3af")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (2, -1), "LEFT"),
        ("ALIGN", (3, 0), (8, -1), "RIGHT"),
        ("ALIGN", (9, 0), (9, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 2.8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.8),
    ]
    for i in range(1, len(data_rows) + 1):
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#f9fafb")))
        if i > 1:
            prev_emp = str(rows[i - 2]["employee"])
            curr_emp = str(rows[i - 1]["employee"])
            if prev_emp != curr_emp:
                style_cmds.append(("LINEABOVE", (0, i), (-1, i), 0.7, colors.HexColor("#9ca3af")))
    table.setStyle(TableStyle(style_cmds))
    if not rows:
        table.setStyle(TableStyle([("SPAN", (0, 1), (-1, 1)), ("ALIGN", (0, 1), (-1, 1), "CENTER")]))
    # Do not KeepTogether the full table — allow natural page fragmentation.
    story.append(table)
    doc.build(story, canvasmaker=_NumberedCanvas)
    return buf.getvalue()


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
