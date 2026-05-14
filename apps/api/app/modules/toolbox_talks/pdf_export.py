"""ReportLab PDF for toolbox talk records (document-style; no storage paths)."""

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
    presenter_display: str | None,
    talk_body: str,
    key_points: list[str],
    do_list: list[str],
    dont_list: list[str],
    ppe_reminders: list[str],
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
    story.append(_p(f"<b>Presenter:</b> {html.escape(presenter_display or '—')}", body))
    story.append(_p(f"<b>Status:</b> {html.escape(talk_status)}", body))
    story.append(Spacer(1, 0.4 * cm))

    story.append(_p("Talk content", h2))
    story.append(_p(talk_body[:20000], body))
    story.append(Spacer(1, 0.35 * cm))

    if key_points:
        story.append(_p("Key points", h2))
        for kp in key_points:
            story.append(_p(f"• {html.escape(kp)}", body))
        story.append(Spacer(1, 0.25 * cm))
    if do_list:
        story.append(_p("Do", h2))
        for d in do_list:
            story.append(_p(f"✓ {html.escape(d)}", body))
        story.append(Spacer(1, 0.2 * cm))
    if dont_list:
        story.append(_p("Do not", h2))
        for d in dont_list:
            story.append(_p(f"✗ {html.escape(d)}", body))
        story.append(Spacer(1, 0.2 * cm))
    if ppe_reminders:
        story.append(_p("PPE reminders", h2))
        for p in ppe_reminders:
            story.append(_p(f"• {html.escape(p)}", body))
        story.append(Spacer(1, 0.35 * cm))

    story.append(_p("Attendee sign-off register", h2))
    hdr = [["Employee", "Status", "Signed at", "Printed name", "Signature captured", "Declined reason"]]
    t = Table(hdr + attendees_rows, colWidths=[3.6 * cm, 2 * cm, 2.8 * cm, 3 * cm, 2.6 * cm, 3.2 * cm])
    t.setStyle(
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
    story.append(t)
    gen = datetime.now(timezone.utc).isoformat(timespec="seconds")
    story.append(Spacer(1, 0.6 * cm))
    story.append(_p(f"<i>Generated {html.escape(gen)} (TimIQ)</i>", body))
    doc.build(story)
    return buf.getvalue()
