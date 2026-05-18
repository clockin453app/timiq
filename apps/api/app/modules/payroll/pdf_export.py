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
    paid_or_approved_label: str,
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
    border = colors.HexColor("#d7dde5")
    soft_border = colors.HexColor("#e5e7eb")
    card_bg = colors.HexColor("#f8fafc")
    label_bg = colors.HexColor("#f3f6f9")
    company_title = ParagraphStyle(
        "PayslipCompanyTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=text,
    )
    statement_title = ParagraphStyle(
        "PayslipStatementTitle",
        parent=company_title,
        fontSize=14,
        leading=18,
        alignment=TA_RIGHT,
    )
    card_title = ParagraphStyle(
        "PayslipCardTitle",
        parent=styles["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=8.4,
        leading=10.5,
        textColor=text,
    )
    label = ParagraphStyle(
        "PayslipLabel",
        parent=styles["Normal"],
        fontSize=8.8,
        leading=11.4,
        textColor=muted,
    )
    value = ParagraphStyle(
        "PayslipValue",
        parent=label,
        fontName="Helvetica-Bold",
        fontSize=9.4,
        leading=12.2,
        textColor=text,
    )
    value_normal = ParagraphStyle("PayslipValueNormal", parent=value, fontName="Helvetica")
    right = ParagraphStyle("PayslipRight", parent=value, alignment=TA_RIGHT)
    small = ParagraphStyle("PayslipSmall", parent=label, fontSize=7.8, leading=10.0)
    money = ParagraphStyle(
        "PayslipMoney",
        parent=value,
        fontSize=12.0,
        leading=15.0,
    )

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
    deductions = (cis_tax_amount or Decimal(0)) + other_deductions_amount
    period = f"{week_start.isoformat()} to {week_end.isoformat()} ({timezone_name or 'UTC'})"
    full_width = doc.width
    statement_heading = "CIS pay statement" if cis_tax_amount is not None and cis_tax_amount != 0 else "Payslip"

    def _footer(canvas, doc_obj) -> None:  # type: ignore[no-untyped-def]
        canvas.saveState()
        canvas.setFont("Helvetica", 7.4)
        canvas.setFillColor(muted)
        y = 0.62 * cm
        canvas.drawString(doc_obj.leftMargin, y, "Please keep this for your records.")
        canvas.drawRightString(doc_obj.pagesize[0] - doc_obj.rightMargin, y, f"Page {doc_obj.page}")
        canvas.restoreState()

    header = Table(
        [[_p(company_name, company_title), _p(statement_heading, statement_title)]],
        colWidths=[full_width * 0.58, full_width * 0.42],
    )
    header.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("LINEBELOW", (0, 0), (-1, -1), 0.6, soft_border),
            ],
        ),
    )
    story.append(header)
    story.append(Spacer(1, 0.36 * cm))

    def _info_card(title: str, rows: list[tuple[str, str]]) -> Table:
        data: list[list[Any]] = [[_p(title.upper(), card_title)]]
        for left, right_value in rows:
            data.append([_p(f"{left}: {right_value}", value_normal)])
        table = Table(data, colWidths=[card_w])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), card_bg),
                    ("BOX", (0, 0), (-1, -1), 0.7, border),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 9),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ],
            ),
        )
        return table

    card_gap = 0.35 * cm
    card_w = (full_width - (2 * card_gap)) / 3
    info_row = Table(
        [
            [
                _info_card(
                    "Employee",
                    [
                        ("Name", employee_name),
                        ("Email", employee_email or "Not provided"),
                        ("National Insurance", national_insurance_number or "Not provided"),
                        ("UTR", utr_number or "Not provided"),
                    ],
                ),
                "",
                _info_card(
                    "Pay period",
                    [
                        ("Period", period),
                        ("Status", paid_or_approved_label or "Not provided"),
                        ("Generated", generated_at),
                    ],
                ),
                "",
                _info_card(
                    "Payment",
                    [
                        ("Payment type", payment_mode_label),
                        ("Company", company_name),
                        ("Period ending", week_end.strftime("%d %b %Y")),
                    ],
                ),
            ],
        ],
        colWidths=[card_w, card_gap, card_w, card_gap, card_w],
    )
    info_row.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ],
        ),
    )
    story.append(info_row)
    story.append(Spacer(1, 0.34 * cm))

    summary_gap = 0.25 * cm
    summary_w = (full_width - (3 * summary_gap)) / 4
    def _summary_card(title: str, amount: str) -> Table:
        table = Table([[_p(title, small)], [_p(amount, money)]], colWidths=[summary_w])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), card_bg),
                    ("BOX", (0, 0), (-1, -1), 0.7, border),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ],
            ),
        )
        return table

    summary = Table(
        [
            [
                _summary_card("Gross pay", _money(gross_amount)),
                "",
                _summary_card("CIS / tax", _money(cis_tax_amount)),
                "",
                _summary_card("Deductions", _money(deductions)),
                "",
                _summary_card("Net pay", _money(net_amount)),
            ],
        ],
        colWidths=[summary_w, summary_gap, summary_w, summary_gap, summary_w, summary_gap, summary_w],
    )
    summary.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ],
        ),
    )
    story.append(summary)
    story.append(Spacer(1, 0.36 * cm))

    details_rows = [
        ("Hours worked (rounded total)", f"{total_hours:.2f} h"),
        ("Regular / overtime hours", f"{regular_hours:.2f} / {overtime_hours:.2f} h"),
        ("Gross pay", _money(gross_amount)),
        ("CIS tax", _money(cis_tax_amount)),
        ("Additions", _money(additions_amount)),
        ("Total net pay", _money(net_amount)),
        (f"YTD taxable pay ({week_start.year})", _money(ytd_taxable_pay)),
        (f"YTD CIS deducted ({week_start.year})", _money(ytd_cis_deducted)),
    ]
    details = Table(
        [[_p(left, value), _p(right_value, right)] for left, right_value in details_rows],
        colWidths=[full_width * 0.54, full_width * 0.46],
        repeatRows=0,
    )
    details.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.55, border),
                ("BACKGROUND", (0, 0), (0, -1), label_bg),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ],
        ),
    )
    story.append(details)
    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
