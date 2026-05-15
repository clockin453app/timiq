"""ReportLab PDF for company/week payroll reports (no storage paths)."""

from __future__ import annotations

import html
from datetime import date, datetime, timezone
from decimal import Decimal
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(text or "—").replace("\n", "<br/>"), style)


def _money(value: Decimal | float | None) -> str:
    if value is None:
        return "—"
    return f"{Decimal(value):.2f}"


def _hours(seconds: int) -> str:
    return f"{seconds / 3600:.2f}"


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
) -> bytes:
    styles = getSampleStyleSheet()
    title_s = ParagraphStyle("T", parent=styles["Heading1"], fontSize=14, spaceAfter=8)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=10, spaceAfter=4)
    body = ParagraphStyle("B", parent=styles["Normal"], fontSize=9, leading=12)
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        rightMargin=1.2 * cm,
        leftMargin=1.2 * cm,
        topMargin=1.2 * cm,
        bottomMargin=1.2 * cm,
    )
    story: list[Any] = []
    story.append(_p("TimIQ Payroll Report", title_s))
    story.append(_p(f"Company: {company_name}", body))
    story.append(
        _p(
            f"Payroll week: {week_start.isoformat()} to {week_end.isoformat()} · {timezone_name or '—'}",
            body,
        ),
    )
    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    story.append(_p(f"Generated: {gen}", body))
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
            r["employee"],
            r["role"],
            r["hours"],
            r["ot_hours"],
            r["gross"],
            r["cis_tax"],
            r["net"],
            r["other_deductions"],
            r["status"],
        ]
        for r in rows
    ]
    if not data_rows:
        data_rows = [["—", "—", "—", "—", "—", "—", "—", "—", "No rows"]]

    col_widths = [4.2 * cm, 2.8 * cm, 1.6 * cm, 1.4 * cm, 2 * cm, 2 * cm, 2 * cm, 2 * cm, 2.2 * cm]
    table = Table(hdr + data_rows, colWidths=col_widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 7.5),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d1d5db")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ],
        ),
    )
    story.append(table)
    story.append(Spacer(1, 0.35 * cm))
    story.append(_p("Summary", h2))
    story.append(_p(f"Total hours: {_hours(total_hours_seconds)}", body))
    story.append(_p(f"Gross pay: {_money(total_gross)}", body))
    story.append(_p(f"CIS tax: {_money(total_cis_tax)}", body))
    story.append(_p(f"Net pay: {_money(total_net)}", body))
    doc.build(story)
    return buf.getvalue()
