"""ReportLab PDF for toolbox talk records (compact; embeds drawn signatures; no storage paths)."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from io import BytesIO
from typing import Any
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# Signature cell box (~34 mm × 12 mm) — image uses contain (aspect preserved).
_SIG_BOX_W = 34 * mm
_SIG_BOX_H = 12 * mm

_MARGIN = 13 * mm

_SECTION_HEADING_RE = re.compile(
    r"^(Purpose|Introduction/discussion|Introduction|Discussion|Key hazards|Control measures|"
    r"Do not|Do|PPE reminders|PPE|Discussion questions|Sign-off declaration|Additional notes|"
    r"Key points|Notes)\s*$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ToolboxTalkAttendeePdfRow:
    """One attendee register row for PDF/print (never includes storage paths)."""

    employee: str
    status: str
    signed_date: str
    printed_name: str
    signature_image: bytes | None = None
    signature_text: str | None = None
    note: str | None = None


def format_display_date(value: date | datetime | None) -> str:
    """Compact human-readable date: ``1 Aug 2026``."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        value = value.date()
    return f"{value.day} {value.strftime('%b')} {value.year}"


def format_signed_date_in_timezone(signed_at: datetime | None, timezone_name: str) -> str:
    """Signed date only, in company/Toolbox Talk timezone (not browser-local)."""
    if signed_at is None:
        return "—"
    try:
        tz = ZoneInfo(timezone_name)
    except Exception:
        tz = ZoneInfo("UTC")
    dt = signed_at
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.astimezone(tz)
    return format_display_date(local.date())


def resolve_company_timezone_name(timezone_name: str | None) -> str:
    name = (timezone_name or "").strip() or "Europe/London"
    try:
        ZoneInfo(name)
        return name
    except Exception:
        return "Europe/London"


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(text or "—").replace("\n", "<br/>"), style)


def _signature_flowable(row: ToolboxTalkAttendeePdfRow, cell_style: ParagraphStyle) -> Any:
    if row.signature_image:
        try:
            reader = ImageReader(BytesIO(row.signature_image))
            iw, ih = reader.getSize()
            if iw > 0 and ih > 0:
                scale = min(_SIG_BOX_W / float(iw), _SIG_BOX_H / float(ih))
                img = Image(BytesIO(row.signature_image), width=iw * scale, height=ih * scale)
                img.hAlign = "CENTER"
                # Centre vertically inside a fixed-height wrapper table cell via VALIGN.
                return img
        except Exception:
            return _p("Signature unavailable", cell_style)
        return _p("Signature unavailable", cell_style)
    label = (row.signature_text or "—").strip() or "—"
    return _p(label, cell_style)


def _parse_body_sections(talk_body: str) -> list[tuple[str | None, str]]:
    """Split talk body into (optional heading, content) pairs for compact rendering."""
    text = (talk_body or "").strip()
    if not text:
        return []
    blocks = re.split(r"\n\s*\n", text)
    sections: list[tuple[str | None, str]] = []
    for block in blocks:
        non_empty = [ln for ln in block.strip().splitlines()]
        if not non_empty:
            continue
        first = non_empty[0].strip()
        rest = "\n".join(non_empty[1:]).strip()
        if _SECTION_HEADING_RE.match(first) or (rest and len(first) <= 48 and not first.endswith(".")):
            sections.append((first, rest or "—"))
        else:
            sections.append((None, block.strip()))
    return sections


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
    key_points: list[str] | None = None,
    do_list: list[str] | None = None,
    dont_list: list[str] | None = None,
    ppe_reminders: list[str] | None = None,
    attendees_rows: list[ToolboxTalkAttendeePdfRow] | list[list[str]] | None = None,
    published_display: str | None = None,
    record_ref: str | None = None,
    generated_display: str | None = None,
    timezone_name: str = "Europe/London",
) -> bytes:
    """
    Build a compact A4 portrait Toolbox Talk PDF.

    ``attendees_rows`` accepts structured :class:`ToolboxTalkAttendeePdfRow` values.
    Legacy ``list[list[str]]`` rows (Employee, Status, Signed, Printed, Signature[, Notes])
    remain supported for older call sites/tests.
    """
    del timezone_name  # dates are pre-formatted by the caller for display
    key_points = list(key_points or [])
    do_list = list(do_list or [])
    dont_list = list(dont_list or [])
    ppe_reminders = list(ppe_reminders or [])
    attendees = _normalize_attendee_rows(attendees_rows or [])

    styles = getSampleStyleSheet()
    company_s = ParagraphStyle(
        "TTCompany",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=15,
        leading=18,
        spaceAfter=2,
        textColor=colors.HexColor("#111827"),
    )
    doc_title_s = ParagraphStyle(
        "TTDocTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        spaceAfter=6,
        textColor=colors.HexColor("#111827"),
    )
    meta_s = ParagraphStyle(
        "TTMeta",
        parent=styles["Normal"],
        fontSize=9,
        leading=11,
        spaceBefore=0,
        spaceAfter=1,
        textColor=colors.HexColor("#1f2937"),
    )
    meta_small_s = ParagraphStyle(
        "TTMetaSmall",
        parent=styles["Normal"],
        fontSize=7.5,
        leading=9,
        spaceBefore=2,
        spaceAfter=0,
        textColor=colors.HexColor("#6b7280"),
    )
    h_sec = ParagraphStyle(
        "TTSec",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9.5,
        leading=11,
        spaceBefore=5,
        spaceAfter=1,
        textColor=colors.HexColor("#111827"),
    )
    body_s = ParagraphStyle(
        "TTBody",
        parent=styles["Normal"],
        fontSize=9,
        leading=11,
        spaceBefore=0,
        spaceAfter=1,
        textColor=colors.HexColor("#111827"),
    )
    cell_s = ParagraphStyle(
        "TTCell",
        parent=styles["Normal"],
        fontSize=8,
        leading=9.5,
        textColor=colors.HexColor("#111827"),
    )
    footer_s = ParagraphStyle(
        "TTFooter",
        parent=styles["Normal"],
        fontSize=7.5,
        leading=9,
        alignment=1,
        textColor=colors.HexColor("#6b7280"),
    )

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=_MARGIN,
        leftMargin=_MARGIN,
        topMargin=_MARGIN,
        bottomMargin=_MARGIN,
        title=f"Toolbox Talk — {title}",
        author=company_name or "TimIQ",
        pageCompression=0,
    )
    story: list[Any] = []

    # Header: company name is the main document header (no large standalone TimIQ).
    story.append(_p(company_name, company_s))
    story.append(_p("Toolbox Talk Record", doc_title_s))

    site_label = (location_name or "").strip() or "No specific site"
    presenter_label = (presenter_display or "").strip() or "Not specified"
    scheduled_label = (scheduled or "").strip() or "Not scheduled"
    status_label = (talk_status or "—").strip()
    if status_label and status_label[0].islower():
        status_label = status_label[:1].upper() + status_label[1:]

    meta_lines = [
        f"<b>Title:</b> {html.escape(title or '—')}",
        f"<b>Topic:</b> {html.escape(topic_display or '—')}",
        f"<b>Site:</b> {html.escape(site_label)}",
        f"<b>Presenter:</b> {html.escape(presenter_label)}",
        f"<b>Scheduled:</b> {html.escape(scheduled_label)}",
        f"<b>Status:</b> {html.escape(status_label)}",
    ]
    if published_display:
        meta_lines.append(f"<b>Published:</b> {html.escape(published_display)}")
    story.append(Paragraph("<br/>".join(meta_lines), meta_s))
    if record_ref:
        story.append(_p(f"Record reference: {record_ref}", meta_small_s))
    story.append(Spacer(1, 3 * mm))

    # Compact talk content (body sections + optional template supplements when body empty).
    body_sections = _parse_body_sections(talk_body[:20000] if talk_body else "")
    content_bits: list[Any] = []
    if body_sections:
        for heading, content in body_sections:
            block: list[Any] = []
            if heading:
                block.append(_p(heading, h_sec))
            for line in content.splitlines() or ["—"]:
                stripped = line.strip()
                if not stripped:
                    continue
                if stripped.startswith(("-", "•", "*")):
                    block.append(_p(f"• {stripped.lstrip('-•* ').strip()}", body_s))
                else:
                    block.append(_p(stripped, body_s))
            content_bits.append(KeepTogether(block))
    else:
        content_bits.append(_p((talk_body or "—")[:20000], body_s))

    include_template_extras = not body_sections or len((talk_body or "").strip()) < 40
    if include_template_extras:
        for heading, items in (
            ("Key points", key_points),
            ("Do", do_list),
            ("Do not", dont_list),
            ("PPE reminders", ppe_reminders),
        ):
            if not items:
                continue
            block = [_p(heading, h_sec)]
            for item in items:
                block.append(_p(f"• {item}", body_s))
            content_bits.append(KeepTogether(block))

    story.extend(content_bits)
    story.append(Spacer(1, 3 * mm))

    # Attendee register
    story.append(_p("Attendee sign-off register", h_sec))
    include_notes = any((r.note or "").strip() for r in attendees)
    headers = ["Employee", "Status", "Signed date", "Printed name", "Signature"]
    if include_notes:
        headers.append("Notes")

    header_row = [_p(h, cell_s) for h in headers]
    data_rows: list[list[Any]] = [header_row]
    for row in attendees:
        cells: list[Any] = [
            _p(row.employee, cell_s),
            _p(row.status, cell_s),
            _p(row.signed_date, cell_s),
            _p(row.printed_name or "—", cell_s),
            _signature_flowable(row, cell_s),
        ]
        if include_notes:
            cells.append(_p(row.note or "—", cell_s))
        data_rows.append(cells)

    if include_notes:
        col_widths = [42 * mm, 18 * mm, 22 * mm, 28 * mm, _SIG_BOX_W + 2 * mm, 32 * mm]
    else:
        # Usable width ≈ 210 − 26 = 184 mm
        col_widths = [50 * mm, 20 * mm, 24 * mm, 32 * mm, _SIG_BOX_W + 4 * mm]

    table = Table(data_rows, colWidths=col_widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("ALIGN", (4, 1), (4, -1), "CENTER"),
            ],
        ),
    )
    story.append(table)

    gen = generated_display or format_display_date(datetime.now(timezone.utc))
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph(html.escape(f"Generated {gen} \u00b7 TimIQ"), footer_s))

    doc.build(story)
    return buf.getvalue()


def count_pdf_pages(pdf_bytes: bytes) -> int:
    """Count page objects in a ReportLab PDF (smoke helper for tests)."""
    return len(re.findall(rb"/Type\s*/Page(?![s\w])", pdf_bytes))


def pdf_embedded_image_count(pdf_bytes: bytes) -> int:
    """Count Image XObjects (drawn signatures embed as PDF images)."""
    return len(re.findall(rb"/Subtype\s*/Image\b", pdf_bytes))


def pdf_text_haystack(pdf_bytes: bytes) -> bytes:
    """Best-effort decompress of PDF content streams for text smoke assertions."""
    import zlib

    chunks: list[bytes] = [pdf_bytes]
    for m in re.finditer(rb"stream\r?\n(.*?)endstream", pdf_bytes, re.S):
        data = m.group(1)
        if data.endswith(b"\r\n"):
            data = data[:-2]
        elif data.endswith(b"\n"):
            data = data[:-1]
        try:
            chunks.append(zlib.decompress(data))
        except Exception:
            chunks.append(data)
    return b"\n".join(chunks)

def _normalize_attendee_rows(
    rows: list[ToolboxTalkAttendeePdfRow] | list[list[str]],
) -> list[ToolboxTalkAttendeePdfRow]:
    out: list[ToolboxTalkAttendeePdfRow] = []
    for row in rows:
        if isinstance(row, ToolboxTalkAttendeePdfRow):
            out.append(row)
            continue
        # Legacy string rows
        cells = list(row) + [""] * 6
        note = cells[5].strip() if len(row) > 5 else ""
        if note in ("—", "-", ""):
            note = ""
        out.append(
            ToolboxTalkAttendeePdfRow(
                employee=cells[0] or "—",
                status=cells[1] or "—",
                signed_date=cells[2] or "—",
                printed_name=cells[3] or "—",
                signature_image=None,
                signature_text=cells[4] or "—",
                note=note or None,
            ),
        )
    return out
