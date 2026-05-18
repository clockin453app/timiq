from __future__ import annotations

import html
from datetime import date, datetime, timezone
from decimal import Decimal
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(text or "-").replace("\n", "<br/>"), style)


def _money(value: Decimal | float | None) -> str:
    if value is None:
        return "-"
    return f"GBP {Decimal(value):,.2f}"


def _footer(canvas, doc) -> None:  # type: ignore[no-untyped-def]
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#64748b"))
    canvas.drawString(doc.leftMargin, 0.65 * cm, "PAYE payslip. Please keep this for your records.")
    canvas.drawRightString(doc.pagesize[0] - doc.rightMargin, 0.65 * cm, f"Page {doc.page}")
    canvas.restoreState()


def build_monthly_paye_payslip_pdf(
    *,
    company_name: str,
    employee_name: str,
    employee_email: str | None,
    national_insurance_number: str | None,
    tax_code: str | None,
    ni_category: str | None,
    pay_period: str,
    pay_date: date,
    generated_at: str | None,
    status_label: str,
    values: dict[str, Decimal | None],
) -> bytes:
    styles = getSampleStyleSheet()
    text = colors.HexColor("#111827")
    muted = colors.HexColor("#64748b")
    border = colors.HexColor("#d9e0ea")
    accent = colors.HexColor("#2f6f9e")
    h1 = ParagraphStyle("PayeH1", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=text)
    h2 = ParagraphStyle("PayeH2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=accent)
    label = ParagraphStyle("PayeLabel", parent=styles["Normal"], fontSize=8.5, leading=11, textColor=muted)
    body = ParagraphStyle("PayeBody", parent=styles["Normal"], fontSize=9, leading=12, textColor=text)
    bold = ParagraphStyle("PayeBold", parent=body, fontName="Helvetica-Bold")
    right = ParagraphStyle("PayeRight", parent=bold, alignment=TA_RIGHT)

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
    generated = generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    header = Table(
        [
            [_p(company_name.upper(), h1), _p("Monthly PAYE Payslip", h1)],
            [_p(employee_name, bold), _p(f"Pay date: {pay_date.isoformat()}", right)],
            [_p(employee_email or "", body), _p(f"Generated: {generated}", right)],
        ],
        colWidths=[doc.width * 0.55, doc.width * 0.45],
    )
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(header)
    story.append(Spacer(1, 0.35 * cm))

    meta = Table(
        [
            [_p("National Insurance number", label), _p(national_insurance_number or "Not provided", body), _p("Status", label), _p(status_label, body)],
            [_p("Tax code", label), _p(tax_code or "Not provided", body), _p("NI category", label), _p(ni_category or "Not provided", body)],
            [_p("Pay period", label), _p(pay_period, body), _p("Pay date", label), _p(pay_date.isoformat(), body)],
        ],
        colWidths=[4.2 * cm, 5.2 * cm, 3.0 * cm, 5.2 * cm],
    )
    meta.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, border), ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#e5e7eb")), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f9fafb")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story.append(meta)
    story.append(Spacer(1, 0.35 * cm))

    def section(title: str, rows: list[tuple[str, str]]) -> None:
        story.append(_p(title, h2))
        table = Table([[_p(k, body), _p(v, right)] for k, v in rows], colWidths=[doc.width * 0.65, doc.width * 0.35])
        table.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, border), ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#e5e7eb")), ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
        story.append(table)
        story.append(Spacer(1, 0.28 * cm))

    pay_rows = [
        ("Gross pay", _money(values["gross_pay"])),
        ("Bonus pay", _money(values["bonus_pay"])),
        ("Commission pay", _money(values["commission_pay"])),
        ("Total additional pay", _money(values["component_pay"])),
        ("Taxable pay", _money(values["taxable_pay"])),
        ("PAYE tax", _money(values["paye_tax"])),
        ("Employee NI", _money(values["employee_ni"])),
        ("Employee pension contribution", _money(values["employee_pension"])),
        ("Student loan deduction", _money(values["student_loan"])),
        ("Postgraduate loan deduction", _money(values["postgraduate_loan"])),
        ("Other deductions", _money(values["other_deductions"])),
        ("Net pay", _money(values["net_pay"])),
    ]
    if values.get("gross_hourly_pay"):
        hourly_rate = Decimal(values.get("hourly_rate") or 0)
        regular_hours = Decimal(values.get("regular_hours") or 0)
        overtime_hours = Decimal(values.get("overtime_hours") or 0)
        regular_pay = Decimal(values.get("regular_pay") or 0)
        overtime_pay = Decimal(values.get("overtime_pay") or 0)
        overtime_rate = hourly_rate
        if overtime_hours > 0 and hourly_rate > 0:
            overtime_rate = hourly_rate * (overtime_pay / (overtime_hours * hourly_rate))
        pay_rows[1:1] = [
            ("Regular hours x hourly rate", f"{regular_hours} x {_money(hourly_rate)} = {_money(regular_pay)}"),
            ("Overtime hours x overtime rate", f"{overtime_hours} x {_money(overtime_rate)} = {_money(overtime_pay)}"),
        ]
    section("Pay and deductions", pay_rows)
    section("Year to date", [
        ("YTD gross pay", _money(values["ytd_gross_pay"])),
        ("YTD taxable pay", _money(values["ytd_taxable_pay"])),
        ("YTD PAYE tax", _money(values["ytd_paye_tax"])),
        ("YTD employee NI", _money(values["ytd_employee_ni"])),
        ("YTD employee pension", _money(values["ytd_employee_pension"])),
        ("YTD student/postgraduate loan", _money((values["ytd_student_loan"] or Decimal(0)) + (values["ytd_postgraduate_loan"] or Decimal(0)))),
        ("YTD net pay", _money(values["ytd_net_pay"])),
    ])
    section("Employer information (not deducted from net pay)", [
        ("Employer pension contribution", _money(values["employer_pension"])),
        ("Employer NI", _money(values["employer_ni"])),
    ])

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
