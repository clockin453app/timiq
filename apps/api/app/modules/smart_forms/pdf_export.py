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
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


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

    story.append(_p("Responses", h2))
    any_section = False
    for sec in schema_json.get("sections", []):
        if not isinstance(sec, dict):
            continue
        any_section = True
        st = str(sec.get("title") or sec.get("id") or "Section")
        story.append(_p(f"<b>{html.escape(st)}</b>", body))
        for field in sec.get("fields", []):
            if not isinstance(field, dict):
                continue
            fid = str(field.get("id", ""))
            label = str(field.get("label", fid))
            val = answers_json.get(fid)
            if isinstance(val, (list, dict)):
                disp = str(val)
            else:
                disp = str(val) if val is not None else "—"
            story.append(_p(f"{html.escape(label)}: {html.escape(disp[:8000])}", body))
        story.append(Spacer(1, 0.15 * cm))
    if not any_section:
        story.append(_p("—", body))

    story.append(Spacer(1, 0.35 * cm))

    story.append(_p("Signature", h2))
    sig_line = "Signature captured (drawn)" if has_signature else "No drawn signature on file"
    story.append(_p(f"<b>{sig_line}</b>", body))
    if signature_name:
        story.append(_p(f"<b>Printed name:</b> {html.escape(signature_name)}", body))
    if review_notes:
        story.append(Spacer(1, 0.3 * cm))
        story.append(_p("Review notes", h2))
        story.append(_p(review_notes[:8000], body))

    story.append(Spacer(1, 0.8 * cm))
    gen = datetime.now(timezone.utc).isoformat(timespec="seconds")
    story.append(_p(f"<i>Generated {html.escape(gen)} (TimIQ)</i>", body))
    doc.build(story)
    return buf.getvalue()
