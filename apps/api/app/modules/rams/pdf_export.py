"""ReportLab PDF export for RAMS assessment packs (multi-section; no storage paths)."""

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

from app.modules.rams.constants import risk_band, risk_score
from app.modules.rams.schemas import RamsAssessmentDetailResponse


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(text or "—").replace("\n", "<br/>"), style)


def _band_fill(band: str) -> Any:
    b = (band or "").lower()
    if b == "low":
        return colors.HexColor("#dcfce7")
    if b == "medium":
        return colors.HexColor("#fef3c7")
    if b == "high":
        return colors.HexColor("#ffedd5")
    if b == "critical":
        return colors.HexColor("#fee2e2")
    return colors.HexColor("#f3f4f6")


def _section_title(styles: Any, title: str) -> list[Any]:
    h = ParagraphStyle(
        "Sec",
        parent=styles["Heading2"],
        fontSize=12,
        spaceAfter=6,
        textColor=colors.HexColor("#111827"),
    )
    return [_p(title, h)]


def _body_style(styles: Any) -> ParagraphStyle:
    return ParagraphStyle("B", parent=styles["Normal"], fontSize=9, leading=13)


def _kv_table(rows: list[tuple[str, str]], col_w: float = 16 * cm) -> Table:
    data = [[k, v] for k, v in rows]
    t = Table(data, colWidths=[4.2 * cm, col_w - 4.2 * cm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f9fafb")),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ],
        ),
    )
    return t


def _risk_matrix_table(styles: Any) -> Table:
    hdr = [""] + [f"S{s}" for s in range(1, 6)]
    grid: list[list[Any]] = [hdr]
    for L in range(1, 6):
        row: list[Any] = [f"L{L}"]
        for S in range(1, 6):
            sc = risk_score(L, S)
            band = risk_band(sc)
            row.append(str(sc))
        grid.append(row)
    t = Table(grid, colWidths=[1.2 * cm] + [2.5 * cm] * 5)
    ts = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
        ("ALIGN", (1, 1), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]
    for r in range(1, 6):
        for c in range(1, 6):
            L, S = r, c
            sc = risk_score(L, S)
            band = risk_band(sc)
            ts.append(("BACKGROUND", (c, r), (c, r), _band_fill(band)))
    t.setStyle(TableStyle(ts))
    return t


def build_rams_assessment_pdf(detail: RamsAssessmentDetailResponse) -> bytes:
    styles = getSampleStyleSheet()
    body = _body_style(styles)
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=1.7 * cm,
        leftMargin=1.7 * cm,
        topMargin=1.6 * cm,
        bottomMargin=1.6 * cm,
    )
    story: list[Any] = []

    gen = datetime.now(timezone.utc).isoformat(timespec="seconds")
    issue = detail.published_at.isoformat() if detail.published_at else "—"
    reviewed = detail.reviewed_at.isoformat() if detail.reviewed_at else "—"

    story += _section_title(styles, "Cover — risk assessment & method statement pack")
    story.append(
        _p(
            f"<b>{html.escape(detail.title)}</b><br/>"
            f"Reference: {html.escape(detail.reference or '—')}<br/>"
            f"Revision: {html.escape(detail.revision or '01')}<br/>"
            f"Status: {html.escape(detail.status)}<br/>"
            f"Overall risk level: {html.escape(detail.risk_level)}<br/>"
            f"Review due: {html.escape(str(detail.review_due_date) if detail.review_due_date else '—')}<br/>"
            f"Issue / publish: {html.escape(issue)}<br/>"
            f"Reviewed: {html.escape(reviewed)}<br/>"
            f"Generated (UTC): {html.escape(gen)}",
            body,
        ),
    )
    story.append(Spacer(1, 0.3 * cm))
    story.append(
        _kv_table(
            [
                ("Project", detail.project_name or "—"),
                ("Client", detail.client_name or "—"),
                ("Principal contractor", detail.principal_contractor or "—"),
                ("Subcontractor", detail.subcontractor_name or "—"),
                ("Site / location address", (detail.site_address or "—")[:900]),
            ],
        ),
    )
    story.append(PageBreak())

    story += _section_title(styles, "Revision control & approvals")
    story.append(
        _kv_table(
            [
                ("Reason for issue", (detail.reason_for_issue or "—")[:1500]),
                ("Produced by", detail.produced_by_name or "—"),
                ("Checked by", detail.checked_by_name or "—"),
                ("Approved by", detail.approved_by_name or "—"),
            ],
        ),
    )
    story.append(PageBreak())

    story += _section_title(styles, "Introduction & safety commitment")
    story.append(
        _p(
            "This document summarises planned work, significant hazards, and controls recorded in TimIQ. "
            "It supports your site safety management system but does not replace competent health and safety advice, "
            "training, supervision, or emergency planning.",
            body,
        ),
    )
    story.append(_p("<b>Work activity</b>", body))
    story.append(_p(detail.work_activity[:4000], body))
    story.append(_p("<b>Description</b>", body))
    story.append(_p((detail.description or "—")[:4000], body))
    story.append(PageBreak())

    story += _section_title(styles, "Emergency procedures")
    story.append(
        _kv_table(
            [
                ("Emergency contact", detail.emergency_contact or "—"),
                ("Site manager", detail.site_manager or "—"),
                ("First aider", detail.first_aider or "—"),
                ("Fire marshal", detail.fire_marshal or "—"),
                ("Muster point", detail.muster_point or "—"),
                ("Nearest hospital / A&E", detail.nearest_hospital or "—"),
            ],
        ),
    )
    story.append(_p("<b>Emergency arrangements</b>", body))
    story.append(_p((detail.emergency_arrangements or "—")[:3500], body))
    story.append(_p("<i>Photo slot: emergency plan diagram (attach in TimIQ RAMS → Photos if available).</i>", body))
    story.append(PageBreak())

    story += _section_title(styles, "Site security, welfare & public protection")
    story.append(_p("<b>Site security</b>", body))
    story.append(_p((detail.site_security or "—")[:2500], body))
    story.append(_p("<b>Welfare</b>", body))
    story.append(_p((detail.welfare_arrangements or "—")[:2500], body))
    story.append(_p("<b>Public protection & visitors</b>", body))
    story.append(_p((detail.public_protection or "—")[:2500], body))
    story.append(_p("<i>Photo slot: site layout / interface (attach in TimIQ if available).</i>", body))
    story.append(PageBreak())

    story += _section_title(styles, "Deliveries, storage & logistics")
    story.append(_p((detail.deliveries_storage or "—")[:4000], body))
    story.append(
        _p(
            "<i>Photo slots: delivery area, storage / COSHH segregation (attach in TimIQ if available).</i>",
            body,
        ),
    )
    story.append(PageBreak())

    story += _section_title(styles, "PPE, gloves & COSHH interfaces")
    ppe = ", ".join(detail.ppe_json) if detail.ppe_json else "—"
    story.append(_p(f"<b>PPE list:</b> {html.escape(ppe)}", body))
    story.append(_p(f"<b>No special PPE flag:</b> {'yes' if detail.no_special_ppe else 'no'}", body))
    gloves = detail.glove_requirements or []
    if gloves:
        story.append(_p("<b>Glove / task PPE requirements</b>", body))
        for g in gloves:
            story.append(_p(f"• {html.escape(g)}", body))
    coshh = detail.coshh_items or []
    if coshh:
        story.append(_p("<b>COSHH / substances interfaces (summary)</b>", body))
        for c in coshh:
            story.append(_p(f"• {html.escape(c)}", body))
    story.append(_p("<i>Photo slot: PPE board / COSHH point (attach in TimIQ if available).</i>", body))
    story.append(PageBreak())

    story += _section_title(styles, "Pre-start checklist")
    pre = detail.pre_start_checklist or []
    if not pre:
        story.append(_p("—", body))
    else:
        for i, item in enumerate(pre, start=1):
            story.append(_p(f"☐ {i}. {html.escape(item)}", body))
    story.append(PageBreak())

    story += _section_title(styles, "Scope of works")
    story.append(_p((detail.scope_of_works or "—")[:5000], body))
    story.append(PageBreak())

    story += _section_title(styles, "Method statement — sequence, plant, training")
    seq = detail.sequence_of_works or []
    if seq:
        rows = [["Step", "Detail"]]
        for s in seq:
            rows.append([str(s.get("step", "")), str(s.get("text", ""))[:1200]])
        st = Table(rows, colWidths=[1.5 * cm, 15.5 * cm])
        st.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ],
            ),
        )
        story.append(st)
    else:
        story.append(_p("—", body))
    plant = detail.plant_tools or []
    train = detail.training_requirements or []
    story.append(Spacer(1, 0.25 * cm))
    story.append(_p("<b>Plant / tools</b>", body))
    story.append(_p(html.escape(", ".join(plant)) if plant else "—", body))
    story.append(_p("<b>Training requirements</b>", body))
    story.append(_p(html.escape(", ".join(train)) if train else "—", body))
    mss = detail.method_statement_sections or []
    if mss:
        story.append(_p("<b>Method sections</b>", body))
        for sec in mss:
            story.append(_p(f"<b>{html.escape(str(sec.get('title', 'Section')))}</b>", body))
            story.append(_p(str(sec.get("body", "—"))[:3000], body))
    story.append(PageBreak())

    story += _section_title(styles, "5×5 risk matrix (likelihood × severity)")
    story.append(
        _p(
            "Scores are likelihood × severity (1–5 each). Bands: low (1–5), medium (6–10), high (11–15), critical (16–25).",
            body,
        ),
    )
    story.append(Spacer(1, 0.2 * cm))
    story.append(_risk_matrix_table(styles))
    story.append(PageBreak())

    story += _section_title(styles, "Hazard assessment")
    haz_rows: list[list[str]] = [
        [
            "Activity / hazard",
            "Who affected",
            "Init L/S",
            "Init score",
            "Controls",
            "Res L/S",
            "Res score",
        ],
    ]
    for h in detail.hazards:
        hi = f"{h.initial_likelihood}×{h.initial_severity}"
        hr = f"{h.residual_likelihood}×{h.residual_severity}"
        warn = " (! residual > initial)" if h.residual_higher_than_initial else ""
        haz_rows.append(
            [
                (h.hazard or "")[:320] + warn,
                (h.who_might_be_harmed or "")[:200],
                hi,
                f"{h.initial_risk_score} ({h.initial_risk_band})",
                (h.control_measures or "")[:900],
                hr,
                f"{h.residual_risk_score} ({h.residual_risk_band})",
            ],
        )
    if len(haz_rows) == 1:
        haz_rows.append(["—", "—", "—", "—", "—", "—", "—"])
    ht = Table(haz_rows, colWidths=[3.2 * cm, 2.4 * cm, 1.5 * cm, 2.2 * cm, 4.8 * cm, 1.5 * cm, 2.2 * cm])
    ht.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 6.5),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ],
        ),
    )
    story.append(ht)
    story.append(PageBreak())

    story += _section_title(styles, "Appendices — HAVS / manual handling / COSHH (placeholders)")
    story.append(
        _p(
            "Record detailed assessments in your company COSHH register, manual handling assessments, "
            "and HAVS programme. TimIQ stores summary fields only.",
            body,
        ),
    )
    story.append(PageBreak())

    story += _section_title(styles, "Employee acknowledgement register")
    ack_rows: list[list[str]] = [
        ["Employee", "Email", "Status", "Acknowledged at", "Printed name", "Signature captured"],
    ]
    for a in detail.acknowledgements:
        ack_rows.append(
            [
                (a.display_name or str(a.user_id))[:80],
                (a.user_email or "")[:120],
                a.status,
                a.acknowledged_at.isoformat() if a.acknowledged_at else "—",
                (a.acknowledgement_name or "—")[:120],
                "Yes" if a.has_signature else "No",
            ],
        )
    for _ in range(max(0, 5 - len(detail.acknowledgements))):
        ack_rows.append(["", "", "", "", "", ""])
    at = Table(ack_rows, colWidths=[3 * cm, 3.6 * cm, 2.2 * cm, 3.2 * cm, 3 * cm, 2.2 * cm])
    at.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
            ],
        ),
    )
    story.append(at)
    story.append(Spacer(1, 0.35 * cm))
    story.append(
        _p(
            "Drawn signatures are stored privately in TimIQ; this PDF lists acknowledgement metadata only (no file paths).",
            ParagraphStyle("F", parent=styles["Normal"], fontSize=8, textColor=colors.grey),
        ),
    )
    story.append(Spacer(1, 0.2 * cm))
    story.append(_p(f"<i>TimIQ RAMS export — assessment id {html.escape(str(detail.id))}</i>", body))

    doc.build(story)
    return buf.getvalue()
