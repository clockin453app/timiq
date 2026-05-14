"""ReportLab PDF for toolbox talk records."""

from __future__ import annotations

import html
from datetime import datetime, timezone
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(text or "—").replace("\n", "<br/>"), style)


def build_toolbox_talk_pdf(
    *,
    company_name: str,
    title: str,
    topic_display: str,
    location_name: str | None,
    scheduled: str | None,
    talk_status: str,
    talk_body: str,
    attendees_rows: list[list[str]],
) -> bytes:
    styles = getSampleStyleSheet()
    title_s = ParagraphStyle("T", parent=styles["Heading1"], fontSize=15, spaceAfter=10)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=11, spaceAfter=6)
    body = ParagraphStyle("B", parent=styles["Normal"], fontSize=10, leading=14)
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=2 * cm, leftMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm)
    story: list[Any] = []
    story.append(_p("Toolbox talk record", title_s))
    story.append(_p(f"<b>Company:</b> {html.escape(company_name)}", body))
    story.append(_p(f"<b>Title:</b> {html.escape(title)}", body))
    story.append(_p(f"<b>Topic:</b> {html.escape(topic_display)}", body))
    story.append(_p(f"<b>Location:</b> {html.escape(location_name or '—')}", body))
    story.append(_p(f"<b>Scheduled:</b> {html.escape(scheduled or '—')}", body))
    story.append(_p(f"<b>Status:</b> {html.escape(talk_status)}", body))
    story.append(Spacer(1, 0.4 * cm))
    story.append(_p("Talk content", h2))
    story.append(_p(talk_body[:20000], body))
    story.append(Spacer(1, 0.5 * cm))
    story.append(_p("Attendees", h2))
    hdr = [["Employee", "Status", "Signed at", "Name", "Declined"]]
    t = Table(hdr + attendees_rows, colWidths=[4.2 * cm, 2.2 * cm, 3.2 * cm, 3.2 * cm, 3.2 * cm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d1d5db")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ],
        ),
    )
    story.append(t)
    gen = datetime.now(timezone.utc).isoformat(timespec="seconds")
    story.append(Spacer(1, 0.6 * cm))
    story.append(_p(f"<i>Generated {html.escape(gen)} (TimIQ)</i>", body))
    doc.build(story)
    return buf.getvalue()
