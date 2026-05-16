"""Multi-section RAMS print HTML (A4-friendly; no storage paths; TimIQ layout — not a legal certificate)."""

from __future__ import annotations

import html
from datetime import datetime, timezone

from app.modules.rams.schemas import RamsAssessmentDetailResponse


def _esc(s: str | None) -> str:
    return html.escape(s or "—")


def _glove_lines(detail: RamsAssessmentDetailResponse) -> list[str]:
    return list(detail.glove_requirements or [])


def _risk_css(band: str) -> str:
    b = (band or "").lower()
    if b == "low":
        return "rams-band-low"
    if b == "medium":
        return "rams-band-medium"
    if b == "high":
        return "rams-band-high"
    if b == "critical":
        return "rams-band-critical"
    return "rams-band-medium"


def _json_lines(label: str, items: list[str] | None) -> str:
    if not items:
        return f"<p class='rams-muted'><strong>{_esc(label)}:</strong> —</p>"
    lis = "".join(f"<li>{_esc(x)}</li>" for x in items)
    return f"<h3>{_esc(label)}</h3><ul>{lis}</ul>"


def _json_steps(title: str, steps: list[dict[str, object]] | None) -> str:
    if not steps:
        return f"<p class='rams-muted'><strong>{_esc(title)}:</strong> —</p>"
    rows = []
    for s in steps:
        n = s.get("step", "")
        txt = s.get("text", "")
        rows.append(f"<tr><td>{_esc(str(n))}</td><td>{_esc(str(txt))}</td></tr>")
    body = "".join(rows)
    return (
        f"<h3>{_esc(title)}</h3><table class='rams-table'><thead><tr><th>Step</th><th>Detail</th></tr></thead>"
        f"<tbody>{body}</tbody></table>"
    )


def _method_sections(sections: list[dict[str, object]] | None) -> str:
    if not sections:
        return "<p class='rams-muted'>No method statement sections recorded.</p>"
    parts = []
    for sec in sections:
        t = str(sec.get("title", "Section"))
        b = str(sec.get("body", ""))
        parts.append(f"<section class='rams-subsec'><h4>{_esc(t)}</h4><div class='rams-block'>{_esc(b).replace(chr(10), '<br/>')}</div></section>")
    return "".join(parts)


def _photo_slot(section_key: str, att_href: str | None, caption: str | None) -> str:
    if att_href:
        cap = _esc(caption) if caption else "Attachment"
        return (
            f"<figure class='rams-photo'><img src='{_esc(att_href)}' alt='{_esc(cap)}'/>"
            f"<figcaption class='rams-muted'>{_esc(caption or '')}</figcaption></figure>"
        )
    return (
        f"<div class='rams-photo-slot'><span>Photo slot — {_esc(section_key)}</span>"
        "<span class='rams-slot-hint'>Upload an image in TimIQ RAMS → Photos</span></div>"
    )


def _first_attachment_href(detail: RamsAssessmentDetailResponse, key: str) -> str | None:
    for a in detail.attachments:
        if a.section_key == key:
            return a.download_href
    return None


def build_professional_rams_print_html(detail: RamsAssessmentDetailResponse) -> str:
    title = _esc(detail.title)
    gen = html.escape(datetime.now(timezone.utc).isoformat())
    risk_cls = _risk_css(detail.risk_level)

    pre = detail.pre_start_checklist or []
    plant = detail.plant_tools or []
    train = detail.training_requirements or []
    coshh = detail.coshh_items or []
    glove_req = _glove_lines(detail)

    seq = detail.sequence_of_works
    mss = detail.method_statement_sections

    cover = f"""
<section class='rams-page'>
  <div class='rams-cover-head'>
    <p class='rams-cover-label'>Risk assessment &amp; method statement pack</p>
    <h1>{title}</h1>
    <p class='rams-meta'><span class='rams-risk-pill {risk_cls}'>Overall: {_esc(detail.risk_level)}</span></p>
  </div>
  <table class='rams-table'>
    <tr><th>Reference</th><td>{_esc(detail.reference)}</td></tr>
    <tr><th>Revision</th><td>{_esc(detail.revision)}</td></tr>
    <tr><th>Project</th><td>{_esc(detail.project_name)}</td></tr>
    <tr><th>Client</th><td>{_esc(detail.client_name)}</td></tr>
    <tr><th>Principal contractor</th><td>{_esc(detail.principal_contractor)}</td></tr>
    <tr><th>Subcontractor</th><td>{_esc(detail.subcontractor_name)}</td></tr>
    <tr><th>Site address</th><td>{_esc(detail.site_address)}</td></tr>
    <tr><th>Review due</th><td>{_esc(str(detail.review_due_date) if detail.review_due_date else None)}</td></tr>
  </table>
  <div class='rams-brand-note'>Branding / company logo can be added later per company — not embedded in this template.</div>
</section>"""

    revision = f"""
<section class='rams-page'>
  <h2>Revision control &amp; approvals</h2>
  <table class='rams-table'>
    <tr><th>Reason for issue</th><td>{_esc(detail.reason_for_issue)}</td></tr>
    <tr><th>Produced by</th><td>{_esc(detail.produced_by_name)}</td></tr>
    <tr><th>Checked by</th><td>{_esc(detail.checked_by_name)}</td></tr>
    <tr><th>Approved by</th><td>{_esc(detail.approved_by_name)}</td></tr>
    <tr><th>Status</th><td>{_esc(detail.status)}</td></tr>
  </table>
</section>"""

    intro = f"""
<section class='rams-page'>
  <h2>Introduction</h2>
  <p class='rams-block'><strong>Work activity:</strong><br/>{_esc(detail.work_activity).replace(chr(10), '<br/>')}</p>
  <p class='rams-block'><strong>Description:</strong><br/>{_esc(detail.description).replace(chr(10), '<br/>')}</p>
</section>"""

    emergency = f"""
<section class='rams-page'>
  <h2>Emergency procedures</h2>
  <table class='rams-table'>
    <tr><th>Emergency contact</th><td>{_esc(detail.emergency_contact)}</td></tr>
    <tr><th>Site manager</th><td>{_esc(detail.site_manager)}</td></tr>
    <tr><th>First aider</th><td>{_esc(detail.first_aider)}</td></tr>
    <tr><th>Fire marshal</th><td>{_esc(detail.fire_marshal)}</td></tr>
    <tr><th>Muster point</th><td>{_esc(detail.muster_point)}</td></tr>
    <tr><th>Nearest hospital</th><td>{_esc(detail.nearest_hospital)}</td></tr>
  </table>
  <h3>Arrangements</h3>
  <div class='rams-block'>{_esc(detail.emergency_arrangements).replace(chr(10), '<br/>')}</div>
  {_photo_slot("emergency_plan", _first_attachment_href(detail, "emergency_plan"), None)}
</section>"""

    site_ctrl = f"""
<section class='rams-page'>
  <h2>Site security, welfare &amp; public protection</h2>
  <h3>Site security</h3><div class='rams-block'>{_esc(detail.site_security).replace(chr(10), '<br/>')}</div>
  <h3>Welfare</h3><div class='rams-block'>{_esc(detail.welfare_arrangements).replace(chr(10), '<br/>')}</div>
  <h3>Public protection</h3><div class='rams-block'>{_esc(detail.public_protection).replace(chr(10), '<br/>')}</div>
  {_photo_slot("site_layout", _first_attachment_href(detail, "site_layout"), None)}
</section>"""

    deliveries = f"""
<section class='rams-page'>
  <h2>Deliveries, storage &amp; logistics</h2>
  <div class='rams-block'>{_esc(detail.deliveries_storage).replace(chr(10), '<br/>')}</div>
  {_photo_slot("delivery_area", _first_attachment_href(detail, "delivery_area"), None)}
  {_photo_slot("storage_area", _first_attachment_href(detail, "storage_area"), None)}
</section>"""

    ppe_sec = f"""
<section class='rams-page'>
  <h2>PPE requirements</h2>
  <ul>{"".join(f"<li>{_esc(p)}</li>" for p in detail.ppe_json) or "<li>—</li>"}</ul>
  <p class='rams-muted'>No special PPE flag: {"yes" if detail.no_special_ppe else "no"}</p>
  {_photo_slot("ppe_image", _first_attachment_href(detail, "ppe_image"), None)}
</section>"""

    glove_sec = f"""
<section class='rams-page'>
  <h2>Mandatory gloves / task PPE</h2>
  {_json_lines("Glove requirements", glove_req)}
  {_photo_slot("glove_image", _first_attachment_href(detail, "glove_image"), None)}
</section>"""

    checklist = f"""
<section class='rams-page'>
  <h2>Pre-start checklist</h2>
  {_json_lines("Items", pre)}
</section>"""

    scope = f"""
<section class='rams-page'>
  <h2>Scope of works</h2>
  <div class='rams-block'>{_esc(detail.scope_of_works).replace(chr(10), '<br/>')}</div>
</section>"""

    method = f"""
<section class='rams-page'>
  <h2>Method statement / sequence of works</h2>
  {_json_steps("Sequence", seq)}
  {_method_sections(mss)}
  {_photo_slot("method_step", _first_attachment_href(detail, "method_step"), None)}
</section>"""

    plant_sec = f"""
<section class='rams-page'>
  <h2>Plant, tools &amp; training</h2>
  {_json_lines("Plant &amp; tools", plant)}
  {_json_lines("Training requirements", train)}
</section>"""

    coshh_sec = f"""
<section class='rams-page'>
  <h2>COSHH / environmental controls</h2>
  {_json_lines("COSHH items", coshh)}
  {_photo_slot("coshh", _first_attachment_href(detail, "coshh"), None)}
</section>"""

    matrix = """
<section class='rams-page'>
  <h2>Risk matrix (5×5)</h2>
  <p>Likelihood × severity (1–25). Bands: low (green), medium (amber), high (orange), critical (red).</p>
  <table class='rams-table'><thead><tr><th>Score</th><th>Band</th></tr></thead><tbody>
  <tr><td>1–5</td><td><span class='rams-band-low'>Low</span></td></tr>
  <tr><td>6–10</td><td><span class='rams-band-medium'>Medium</span></td></tr>
  <tr><td>11–15</td><td><span class='rams-band-high'>High</span></td></tr>
  <tr><td>16–25</td><td><span class='rams-band-critical'>Critical</span></td></tr>
  </tbody></table>
</section>"""

    haz_rows = []
    for h in detail.hazards:
        warn = " ⚠ residual higher" if h.residual_higher_than_initial else ""
        img_href = None
        for a in detail.attachments:
            if a.section_key == "hazard_image" and a.hazard_id == h.id:
                img_href = a.download_href
                break
        slot = _photo_slot("hazard_image", img_href, None)
        haz_rows.append(
            "<tr>"
            f"<td>{_esc(h.hazard)}<div class='rams-hazard-photo'>{slot}</div></td>"
            f"<td>{_esc(h.who_might_be_harmed)}</td>"
            f"<td><span class='{_risk_css(h.initial_risk_band)}'>{h.initial_risk_score} ({_esc(h.initial_risk_band)})</span></td>"
            f"<td>{_esc(h.control_measures).replace(chr(10), '<br/>')}</td>"
            f"<td><span class='{_risk_css(h.residual_risk_band)}'>{h.residual_risk_score} ({_esc(h.residual_risk_band)})</span>{_esc(warn)}</td>"
            "</tr>",
        )
    hazards_sec = f"""
<section class='rams-page'>
  <h2>Hazard assessment</h2>
  <table class='rams-table rams-hazards'><thead><tr>
  <th>Hazard</th><th>Who might be harmed</th><th>Initial</th><th>Controls</th><th>Residual</th>
  </tr></thead><tbody>{"".join(haz_rows)}</tbody></table>
</section>"""

    appendix = """
<section class='rams-page'>
  <h2>Appendix placeholders</h2>
  <p>HAVS assessment, manual handling assessment, and detailed COSHH assessment can be attached as site-specific documents.</p>
  <p class='rams-muted'>Operational placeholders only — not pre-filled medical or exposure data.</p>
</section>"""

    ack_hdr = "<tr><th>Person</th><th>Status</th><th>Signed at</th><th>Printed name</th><th>Signature</th><th>Notes</th></tr>"
    ack_rows = []
    for a in detail.acknowledgements:
        if a.signature_method == "app_signature" or a.has_signature:
            sig = "Signed in app"
        elif a.signature_method == "manual_paper" or a.status == "acknowledged":
            sig = "Manual/paper signed"
        else:
            sig = "Not signed"
        ack_rows.append(
            "<tr>"
            f"<td>{_esc(a.display_name or '—')}</td>"
            f"<td>{_esc(a.status)}</td>"
            f"<td>{_esc(a.acknowledged_at.isoformat() if a.acknowledged_at else None)}</td>"
            f"<td>{_esc(a.acknowledgement_name)}</td>"
            f"<td>{_esc(sig)}</td>"
            f"<td>{_esc(a.manual_signature_note or a.declined_reason)}</td>"
            "</tr>",
        )
    for _ in range(4):
        ack_rows.append("<tr><td colspan='6' style='height:24px'>&nbsp;</td></tr>")
    ack_sec = f"""
<section class='rams-page'>
  <h2>Employee acknowledgement / signature register</h2>
  <table class='rams-table'><thead>{ack_hdr}</thead><tbody>{"".join(ack_rows)}</tbody></table>
  <p class='rams-note'>Signature images are stored privately. This record shows only safe signature status and notes.</p>
</section>"""

    footer = f"""
<section class='rams-page rams-page-last'>
  <p class='rams-footer'>TimIQ RAMS pack · Generated {gen} · ID {html.escape(str(detail.id))}</p>
</section>"""

    css = """
body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #111827; background: #fff; }
.rams-pack { max-width: 900px; margin: 0 auto; }
.rams-page { page-break-after: always; padding: 28px 32px; }
.rams-page-last { page-break-after: auto; }
h1 { font-size: 24px; margin: 0 0 12px; }
h2 { font-size: 17px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-top: 0; }
h3 { font-size: 14px; }
.rams-meta { font-size: 13px; color: #374151; margin: 6px 0; }
.rams-block { font-size: 13px; line-height: 1.5; margin: 8px 0 12px; }
.rams-table { border-collapse: collapse; width: 100%; margin-top: 10px; font-size: 12px; }
.rams-table th, .rams-table td { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; text-align: left; }
.rams-table th { background: #f3f4f6; font-weight: 600; }
.rams-note { font-size: 11px; color: #6b7280; margin-top: 12px; }
.rams-footer { font-size: 11px; color: #6b7280; text-align: center; margin-top: 20px; }
.rams-muted { color: #6b7280; font-size: 12px; }
.rams-cover-label { text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; color: #6b7280; margin: 0; }
.rams-brand-note { margin-top: 16px; font-size: 11px; color: #9ca3af; border-top: 1px dashed #e5e7eb; padding-top: 10px; }
.rams-risk-pill { display: inline-block; padding: 4px 10px; border-radius: 999px; font-weight: 600; font-size: 12px; }
.rams-band-low { background: #dcfce7; color: #166534; }
.rams-band-medium { background: #fef3c7; color: #92400e; }
.rams-band-high { background: #ffedd5; color: #c2410c; }
.rams-band-critical { background: #fee2e2; color: #991b1b; }
.rams-photo-slot { border: 2px dashed #cbd5e1; min-height: 140px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #64748b; font-size: 12px; margin: 10px 0; padding: 12px; }
.rams-slot-hint { font-size: 11px; margin-top: 6px; }
.rams-photo img { max-width: 100%; max-height: 220px; object-fit: contain; }
.rams-hazard-photo { margin-top: 8px; }
.rams-subsec { margin-bottom: 12px; }
@media print { .rams-page { padding: 16px 18px; } }
"""
    pack = (
        cover
        + revision
        + intro
        + emergency
        + site_ctrl
        + deliveries
        + ppe_sec
        + glove_sec
        + checklist
        + scope
        + method
        + plant_sec
        + coshh_sec
        + matrix
        + hazards_sec
        + appendix
        + ack_sec
        + footer
    )
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>RAMS — {title}</title>
<style>{css}</style></head><body><div class="rams-pack">{pack}</div></body></html>"""
