"""ReportLab PDF for work progress review reports (private images, no storage paths)."""

from __future__ import annotations

import html
from datetime import date, datetime, timezone
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _p(text: object, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(str(text or "—")).replace("\n", "<br/>"), style)


def _date_label(value: date | None) -> str:
    return value.isoformat() if value else "All dates"


def _image_flowable(image_bytes: bytes, max_width: float = 13.5 * cm, max_height: float = 9 * cm) -> Image | Paragraph:
    try:
        img = Image(BytesIO(image_bytes))
        scale = min(max_width / float(img.imageWidth), max_height / float(img.imageHeight), 1.0)
        img.drawWidth = float(img.imageWidth) * scale
        img.drawHeight = float(img.imageHeight) * scale
        return img
    except Exception:
        styles = getSampleStyleSheet()
        return _p("Image unavailable", styles["Normal"])


def build_work_progress_report_pdf(
    *,
    company_name: str,
    date_from: date | None,
    date_to: date | None,
    filters: dict[str, str],
    summary: dict[str, int],
    entries: list[dict[str, Any]],
) -> bytes:
    styles = getSampleStyleSheet()
    title_s = ParagraphStyle("TimIQTitle", parent=styles["Heading1"], fontSize=15, spaceAfter=8)
    h2 = ParagraphStyle("TimIQH2", parent=styles["Heading2"], fontSize=10, spaceAfter=5)
    h3 = ParagraphStyle("TimIQH3", parent=styles["Heading3"], fontSize=9, spaceAfter=4)
    body = ParagraphStyle("TimIQBody", parent=styles["Normal"], fontSize=8.5, leading=11)
    small = ParagraphStyle("TimIQSmall", parent=styles["Normal"], fontSize=7.5, leading=10, textColor=colors.HexColor("#4b5563"))

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=1.2 * cm,
        leftMargin=1.2 * cm,
        topMargin=1.2 * cm,
        bottomMargin=1.2 * cm,
    )
    story: list[Any] = []
    story.append(_p("TimIQ Work Progress Report", title_s))
    story.append(_p(f"Company: {company_name}", body))
    story.append(_p(f"Date range: {_date_label(date_from)} to {_date_label(date_to)}", body))
    story.append(_p(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", body))
    story.append(Spacer(1, 0.2 * cm))

    filter_rows = [["Filter", "Value"]] + [[k.replace("_", " ").title(), v] for k, v in filters.items()]
    filter_table = Table(filter_rows, colWidths=[4 * cm, 11 * cm])
    filter_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.append(filter_table)
    story.append(Spacer(1, 0.2 * cm))

    story.append(_p("Summary", h2))
    story.append(
        _p(
            "Total submissions: {total_submissions} · Total pictures: {total_attachments} · Submitted: {submitted_count} · Reviewed: {reviewed_count}".format(
                **summary,
            ),
            body,
        )
    )
    story.append(Spacer(1, 0.25 * cm))

    if not entries:
        story.append(_p("No submissions matched the current filters.", body))
    for entry in entries:
        block: list[Any] = []
        block.append(_p(str(entry.get("title") or "Untitled"), h2))
        block.append(
            _p(
                f"Employee: {entry.get('employee') or '—'} · Site: {entry.get('site') or '—'} · Date: {entry.get('work_date') or '—'}",
                body,
            )
        )
        block.append(
            _p(
                f"Progress: {entry.get('progress_status') or '—'} · Review: {entry.get('status') or '—'} · Percent: {entry.get('percent_complete') if entry.get('percent_complete') is not None else '—'}",
                body,
            )
        )
        if entry.get("notes"):
            block.append(_p(f"Notes: {entry.get('notes')}", small))
        if entry.get("review_note"):
            block.append(_p(f"Review notes: {entry.get('review_note')}", small))

        attachments = entry.get("attachments") or []
        if not attachments:
            block.append(_p("No pictures submitted.", small))
        for att in attachments:
            block.append(Spacer(1, 0.12 * cm))
            block.append(_p(att.get("filename") or "Picture", h3))
            if att.get("image_bytes"):
                block.append(_image_flowable(att["image_bytes"]))
            else:
                block.append(_p("Image unavailable", small))
        story.append(KeepTogether(block))
        story.append(Spacer(1, 0.35 * cm))

    doc.build(story)
    return buf.getvalue()
