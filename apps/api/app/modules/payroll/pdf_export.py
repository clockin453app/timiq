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
    title_s = ParagraphStyle("PayslipTitle", parent=styles["Heading1"], fontSize=17, leading=21, spaceAfter=8, textColor=colors.HexColor("#111827"))
    h2 = ParagraphStyle("PayslipH2", parent=styles["Heading2"], fontSize=10.5, leading=13, spaceAfter=5, textColor=colors.HexColor("#111827"))
    body = ParagraphStyle("PayslipBody", parent=styles["Normal"], fontSize=8.8, leading=11.5, textColor=colors.HexColor("#1f2937"))
    small = ParagraphStyle("PayslipSmall", parent=body, fontSize=7.6, leading=9.6)
    right = ParagraphStyle("PayslipRight", parent=body, alignment=TA_RIGHT)

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=1.15 * cm,
        leftMargin=1.15 * cm,
        topMargin=1.1 * cm,
        bottomMargin=1.1 * cm,
        pageCompression=0,
    )
    story: list[Any] = []
    story.append(_p("TimIQ Payslip", title_s))

    period = f"{week_start.isoformat()} to {week_end.isoformat()} ({timezone_name or 'UTC'})"
    meta_rows = [
        [_p("Company", small), _p(company_name, body), _p("Generated", small), _p(generated_at, body)],
        [_p("Employee", small), _p(employee_name, body), _p("Email", small), _p(employee_email or "—", body)],
        [_p("National Insurance", small), _p(national_insurance_number or "Not provided", body), _p("UTR", small), _p(utr_number or "Not provided", body)],
        [_p("Pay period", small), _p(period, body), _p("Payment", small), _p(paid_or_approved_label or "—", body)],
        [_p("Payment type", small), _p(payment_mode_label, body), _p("", small), _p("", body)],
    ]
    meta = Table(meta_rows, colWidths=[3.4 * cm, 6.3 * cm, 3.2 * cm, 6.1 * cm])
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

    deductions = (cis_tax_amount or Decimal(0)) + other_deductions_amount
    summary_rows = [
        [_p("Gross pay", small), _p(_money(gross_amount), right)],
        [_p("CIS / tax", small), _p(_money(cis_tax_amount), right)],
        [_p("Other deductions", small), _p(_money(other_deductions_amount), right)],
        [_p("Additions", small), _p(_money(additions_amount), right)],
        [_p("Total deductions", small), _p(_money(deductions), right)],
        [_p("Net pay", small), _p(_money(net_amount), right)],
    ]
    summary = Table(summary_rows, colWidths=[5.1 * cm, 4.1 * cm])
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
    story.append(_p("Pay Summary", h2))
    story.append(summary)
    story.append(Spacer(1, 0.25 * cm))

    detail_rows = [
        ["Description", "Value"],
        ["Hours worked (rounded total)", f"{total_hours:.2f} h"],
        ["Regular / overtime hours", f"{regular_hours:.2f} / {overtime_hours:.2f} h"],
        ["YTD taxable pay", _money(ytd_taxable_pay)],
        ["YTD CIS deducted", _money(ytd_cis_deducted)],
    ]
    detail = Table(detail_rows, colWidths=[10.5 * cm, 8.0 * cm])
    detail.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d1d5db")),
                ("ALIGN", (1, 1), (1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ],
        ),
    )
    story.append(_p("Details", h2))
    story.append(detail)
    doc.build(story, onFirstPage=_page_number, onLaterPages=_page_number)
    return buf.getvalue()
