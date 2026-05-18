"""ReportLab PDF for company/week payroll reports (no storage paths)."""

from __future__ import annotations

import html
from datetime import date, datetime, timezone
from decimal import Decimal
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(text or "—").replace("\n", "<br/>"), style)


def _money(value: Decimal | float | None) -> str:
    if value is None:
        return "—"
    return f"£{Decimal(value):,.2f}"


def _hours(seconds: int) -> str:
    return f"{seconds / 3600:,.2f}"


def _page_number(canvas, doc) -> None:  # type: ignore[no-untyped-def]
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#6b7280"))
    canvas.drawRightString(doc.pagesize[0] - doc.rightMargin, 0.65 * cm, f"Page {doc.page}")
    canvas.restoreState()


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
    title_s = ParagraphStyle("T", parent=styles["Heading1"], fontSize=18, leading=22, spaceAfter=8, textColor=colors.HexColor("#111827"))
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=11, leading=14, spaceAfter=6, textColor=colors.HexColor("#111827"))
    body = ParagraphStyle("B", parent=styles["Normal"], fontSize=8.8, leading=11.5, textColor=colors.HexColor("#1f2937"))
    small = ParagraphStyle("S", parent=body, fontSize=7.5, leading=9.5)
    right_small = ParagraphStyle("RS", parent=small, alignment=TA_RIGHT)
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        rightMargin=0.9 * cm,
        leftMargin=0.9 * cm,
        topMargin=0.9 * cm,
        bottomMargin=1.1 * cm,
        pageCompression=0,
    )
    story: list[Any] = []
    story.append(_p("TimIQ Payroll Report", title_s))
    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    report_period = period_label or f"Payroll week: {week_start.isoformat()} to {week_end.isoformat()}"
    meta_rows = [
        [_p("Company", small), _p(company_name, body), _p("Generated", small), _p(gen, body)],
        [_p("Period", small), _p(report_period, body), _p("Timezone", small), _p(timezone_name or "—", body)],
        [_p("Employee filter", small), _p(employee_filter_label or "All employees", body), _p("Rows", small), _p(str(len(rows)), body)],
    ]
    meta = Table(meta_rows, colWidths=[2.6 * cm, 10.7 * cm, 2.6 * cm, 10.7 * cm])
    meta.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f9fafb")),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#d1d5db")),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#e5e7eb")),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ],
        ),
    )
    story.append(meta)
    story.append(Spacer(1, 0.25 * cm))

    summary_rows = [
        [_p("Total hours", small), _p(_hours(total_hours_seconds), right_small)],
        [_p("Employees", small), _p(str(employee_count) if employee_count is not None else "—", right_small)],
        [_p("Gross pay", small), _p(_money(total_gross), right_small)],
        [_p("CIS tax", small), _p(_money(total_cis_tax), right_small)],
        [_p("Net pay", small), _p(_money(total_net), right_small)],
    ]
    summary = Table(summary_rows, colWidths=[4.0 * cm, 3.0 * cm])
    summary.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef2ff")),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#c7d2fe")),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#e0e7ff")),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ],
        ),
    )
    story.append(_p("Summary", h2))
    story.append(summary)
    story.append(Spacer(1, 0.25 * cm))

    if alert_lines:
        story.append(_p("Notes", h2))
        for line in alert_lines:
            story.append(_p(f"• {line}", body))
        story.append(Spacer(1, 0.2 * cm))

    hdr = [
        [
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
        ],
    ]
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
            _p(str(r["status"]), small),
        ]
        for r in rows
    ]
    if not data_rows:
        data_rows = [[_p("No payable payroll rows for this selected range.", body), "", "", "", "", "", "", "", "", ""]]

    story.append(_p("Payroll rows", h2))
    col_widths = [4.2 * cm, 2.4 * cm, 3.0 * cm, 1.55 * cm, 1.35 * cm, 2.05 * cm, 2.0 * cm, 2.0 * cm, 1.9 * cm, 2.1 * cm]
    table = Table(hdr + data_rows, colWidths=col_widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 7.4),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d1d5db")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (3, 1), (8, -1), "RIGHT"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ],
        ),
    )
    if not rows:
        table.setStyle(TableStyle([("SPAN", (0, 1), (-1, 1)), ("ALIGN", (0, 1), (-1, 1), "CENTER")]))
    story.append(table)
    doc.build(story, onFirstPage=_page_number, onLaterPages=_page_number)
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
