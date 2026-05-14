"""ReportLab PDF export for smart form submissions (no external system deps)."""

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

from app.modules.smart_forms.schema_validate import iter_field_defs


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    safe = html.escape(text or "—").replace("\n", "<br/>")
    return Paragraph(safe, style)


def build_smart_form_submission_pdf(
    *,
    company_name: str,
    template_name: str,
    template_category: str,
    submitter_email: str,
    submitter_display: str | None,
    location_name: str | None,
    submission_status: str,
    answers_json: dict[str, Any],
    schema_json: dict[str, Any],
    signature_name: str | None,
    has_signature: bool,
    review_notes: str | None,
    submitted_at: datetime | None,
    reviewed_at: datetime | None,
) -> bytes:
    styles = getSampleStyleSheet()
    title = ParagraphStyle("T", parent=styles["Heading1"], fontSize=16, spaceAfter=12)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12, spaceAfter=6, textColor=colors.HexColor("#111827"))
    body = ParagraphStyle("B", parent=styles["Normal"], fontSize=10, leading=14)
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=2 * cm,
        leftMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )
    story: list[Any] = []
    story.append(_p("Smart form submission", title))
    story.append(_p(f"<b>Company:</b> {html.escape(company_name)}", body))
    story.append(_p(f"<b>Template:</b> {html.escape(template_name)}", body))
    story.append(_p(f"<b>Category:</b> {html.escape(template_category)}", body))
    story.append(_p(f"<b>Employee:</b> {html.escape(submitter_display or submitter_email or '—')}", body))
    if location_name:
        story.append(_p(f"<b>Location:</b> {html.escape(location_name)}", body))
    story.append(_p(f"<b>Status:</b> {html.escape(submission_status)}", body))
    if submitted_at:
        story.append(_p(f"<b>Submitted:</b> {html.escape(submitted_at.isoformat())}", body))
    if reviewed_at:
        story.append(_p(f"<b>Reviewed:</b> {html.escape(reviewed_at.isoformat())}", body))
    story.append(Spacer(1, 0.4 * cm))

    story.append(_p("Answers", h2))
    field_index: dict[str, dict[str, Any]] = {}
    for f in iter_field_defs(schema_json):
        field_index[str(f["id"])] = f

    rows: list[list[str]] = [["Field", "Answer"]]
    for key, val in (answers_json or {}).items():
        fd = field_index.get(str(key), {})
        label = str(fd.get("label", key))
        if isinstance(val, (list, dict)):
            ans = str(val)
        else:
            ans = str(val) if val is not None else ""
        rows.append([label[:500], ans[:4000]])

    if len(rows) == 1:
        rows.append(["—", "No answers recorded."])

    t = Table(rows, colWidths=[6 * cm, 10 * cm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ],
        ),
    )
    story.append(t)
    story.append(Spacer(1, 0.5 * cm))

    story.append(_p("Signature", h2))
    sig_line = "Signature captured (drawn)" if has_signature else "No drawn signature on file"
    story.append(_p(f"<b>{sig_line}</b>", body))
    if signature_name:
        story.append(_p(f"<b>Name on record:</b> {html.escape(signature_name)}", body))
    if review_notes:
        story.append(Spacer(1, 0.3 * cm))
        story.append(_p("Review notes", h2))
        story.append(_p(review_notes[:8000], body))

    story.append(Spacer(1, 0.8 * cm))
    gen = datetime.now(timezone.utc).isoformat(timespec="seconds")
    story.append(_p(f"<i>Generated {html.escape(gen)} (TimIQ)</i>", body))
    doc.build(story)
    return buf.getvalue()
