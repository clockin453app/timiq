"""ReportLab PDF export for RAMS assessment packs (text-first; TimIQ layout)."""

from __future__ import annotations

import html
from datetime import datetime, timezone
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.modules.rams.schemas import RamsAssessmentDetailResponse


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(text or "—").replace("\n", "<br/>"), style)


def _section(title: str, lines: list[str], styles: Any) -> list[Any]:
    h = ParagraphStyle("H", parent=styles["Heading2"], fontSize=12, spaceAfter=6, textColor=colors.HexColor("#111827"))
    b = ParagraphStyle("B", parent=styles["Normal"], fontSize=9, leading=13)
    out: list[Any] = [_p(title, h)]
    for ln in lines:
        out.append(_p(ln, b))
    out.append(Spacer(1, 0.25 * cm))
    return out


def build_rams_assessment_pdf(detail: RamsAssessmentDetailResponse) -> bytes:
    styles = getSampleStyleSheet()
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=1.8 * cm, leftMargin=1.8 * cm, topMargin=1.8 * cm, bottomMargin=1.8 * cm)
    story: list[Any] = []

    story += _section(
        "Cover",
        [
            f"Title: {detail.title}",
            f"Reference: {detail.reference or '—'}",
            f"Revision: {detail.revision or '01'}",
            f"Risk level: {detail.risk_level}",
            f"Status: {detail.status}",
            f"Review due: {str(detail.review_due_date) if detail.review_due_date else '—'}",
        ],
        styles,
    )
    story.append(PageBreak())
    story += _section(
        "Project details",
        [
            f"Project: {detail.project_name or '—'}",
            f"Client: {detail.client_name or '—'}",
            f"Principal contractor: {detail.principal_contractor or '—'}",
            f"Site address: {(detail.site_address or '—')[:800]}",
        ],
        styles,
    )
    story.append(PageBreak())
    story += _section(
        "Emergency / site",
        [
            f"Emergency contact: {detail.emergency_contact or '—'}",
            f"Muster: {detail.muster_point or '—'}",
            f"Nearest hospital: {detail.nearest_hospital or '—'}",
            (detail.emergency_arrangements or "—")[:2000],
        ],
        styles,
    )
    story.append(PageBreak())
    ppe = ", ".join(detail.ppe_json) if detail.ppe_json else "—"
    story += _section("PPE / COSHH summary", [f"PPE: {ppe}", f"No special PPE flag: {detail.no_special_ppe}"], styles)
    story.append(PageBreak())

    haz_rows: list[list[str]] = [["Hazard", "Initial", "Residual", "Controls"]]
    for h in detail.hazards:
        haz_rows.append(
            [
                (h.hazard or "")[:400],
                f"{h.initial_risk_score} ({h.initial_risk_band})",
                f"{h.residual_risk_score} ({h.residual_risk_band})",
                (h.control_measures or "")[:1200],
            ],
        )
    if len(haz_rows) == 1:
        haz_rows.append(["—", "—", "—", "—"])
    ht = Table(haz_rows, colWidths=[4 * cm, 2.2 * cm, 2.2 * cm, 7.6 * cm])
    ht.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ],
        ),
    )
    story.append(_p("Hazards and controls", ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12)))
    story.append(ht)
    story.append(PageBreak())

    ack_rows: list[list[str]] = [["User", "Status", "Acknowledged at", "Name on record"]]
    for a in detail.acknowledgements:
        ack_rows.append(
            [
                (a.display_name or str(a.user_id))[:120],
                a.status,
                a.acknowledged_at.isoformat() if a.acknowledged_at else "—",
                (a.acknowledgement_name or ("Yes" if a.has_signature else "—"))[:120],
            ],
        )
    at = Table(ack_rows, colWidths=[4.5 * cm, 2.4 * cm, 3.6 * cm, 6.7 * cm])
    at.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
            ],
        ),
    )
    story.append(_p("Acknowledgement register", ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12)))
    story.append(at)
    story.append(Spacer(1, 0.4 * cm))
    story.append(
        _p(
            "Drawn signatures are stored privately in TimIQ; this PDF lists acknowledgement metadata only.",
            ParagraphStyle("F", parent=styles["Normal"], fontSize=8, textColor=colors.grey),
        ),
    )
    gen = datetime.now(timezone.utc).isoformat(timespec="seconds")
    story.append(Spacer(1, 0.3 * cm))
    story.append(_p(f"Generated {html.escape(gen)} (TimIQ)", ParagraphStyle("F2", parent=styles["Normal"], fontSize=8)))
    doc.build(story)
    return buf.getvalue()
