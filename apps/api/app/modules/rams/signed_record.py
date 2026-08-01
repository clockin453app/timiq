"""Build complete signed RAMS records: original PDF pages + acknowledgement register."""

from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from typing import Any

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

_SIG_BOX_W = 34 * mm
_SIG_BOX_H = 12 * mm
_MARGIN = 13 * mm


@dataclass(frozen=True)
class RamsAckPdfRow:
    """One acknowledgement register row (never includes storage paths)."""

    employee: str
    status: str
    signed_date: str
    printed_name: str
    document_version: str
    signature_image: bytes | None = None
    signature_text: str | None = None
    note: str | None = None


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(html.escape(text or "—").replace("\n", "<br/>"), style)


def _signature_flowable(row: RamsAckPdfRow, cell_style: ParagraphStyle) -> Any:
    if row.signature_image:
        try:
            reader = ImageReader(BytesIO(row.signature_image))
            iw, ih = reader.getSize()
            if iw > 0 and ih > 0:
                scale = min(_SIG_BOX_W / float(iw), _SIG_BOX_H / float(ih))
                img = Image(BytesIO(row.signature_image), width=iw * scale, height=ih * scale)
                img.hAlign = "CENTER"
                return img
        except Exception:
            return _p("Signature unavailable", cell_style)
        return _p("Signature unavailable", cell_style)
    label = (row.signature_text or "—").strip() or "—"
    return _p(label, cell_style)


def build_acknowledgement_register_pdf(
    *,
    title: str,
    reference: str | None,
    document_version: str,
    company_name: str,
    site_name: str | None,
    rows: list[RamsAckPdfRow],
) -> bytes:
    """Standalone acknowledgement register pages with embedded signature images."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=_MARGIN,
        rightMargin=_MARGIN,
        topMargin=_MARGIN,
        bottomMargin=_MARGIN,
    )
    styles = getSampleStyleSheet()
    company_s = ParagraphStyle("Co", parent=styles["Heading1"], fontSize=14, spaceAfter=2 * mm)
    doc_title_s = ParagraphStyle("Dt", parent=styles["Heading2"], fontSize=12, spaceAfter=3 * mm)
    meta_s = ParagraphStyle("Meta", parent=styles["Normal"], fontSize=9, leading=12, spaceAfter=2 * mm)
    h_sec = ParagraphStyle("HSec", parent=styles["Heading3"], fontSize=11, spaceBefore=2 * mm, spaceAfter=2 * mm)
    cell_s = ParagraphStyle("Cell", parent=styles["Normal"], fontSize=8, leading=10)

    story: list[Any] = [
        _p(company_name or "Company", company_s),
        _p("RAMS acknowledgement register", doc_title_s),
    ]
    meta_lines = [
        f"<b>Title:</b> {html.escape(title or '—')}",
        f"<b>Reference:</b> {html.escape((reference or '—').strip() or '—')}",
        f"<b>Document version:</b> {html.escape(document_version or '—')}",
        f"<b>Site:</b> {html.escape((site_name or '').strip() or 'No specific site')}",
    ]
    story.append(Paragraph("<br/>".join(meta_lines), meta_s))
    story.append(Spacer(1, 3 * mm))
    story.append(_p("Employee acknowledgements", h_sec))

    include_notes = any((r.note or "").strip() for r in rows)
    headers = ["Employee", "Status", "Signed date", "Printed name", "Version", "Signature"]
    if include_notes:
        headers.append("Notes")
    data_rows: list[list[Any]] = [[_p(h, cell_s) for h in headers]]
    for row in rows:
        cells: list[Any] = [
            _p(row.employee, cell_s),
            _p(row.status, cell_s),
            _p(row.signed_date, cell_s),
            _p(row.printed_name or "—", cell_s),
            _p(row.document_version or "—", cell_s),
            _signature_flowable(row, cell_s),
        ]
        if include_notes:
            cells.append(_p(row.note or "—", cell_s))
        data_rows.append(cells)

    if include_notes:
        col_widths = [36 * mm, 18 * mm, 22 * mm, 28 * mm, 16 * mm, _SIG_BOX_W + 2 * mm, 28 * mm]
    else:
        col_widths = [42 * mm, 18 * mm, 24 * mm, 30 * mm, 18 * mm, _SIG_BOX_W + 4 * mm]

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
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ],
        ),
    )
    story.append(table)
    story.append(Spacer(1, 4 * mm))
    footer = ParagraphStyle("Foot", parent=styles["Normal"], fontSize=7, textColor=colors.HexColor("#6b7280"))
    story.append(
        _p(
            "This register is appended to the original RAMS PDF. Drawn signatures are embedded as images; "
            "storage paths are never included.",
            footer,
        ),
    )
    doc.build(story)
    return buf.getvalue()


def merge_original_pdf_with_register(original_pdf: bytes, register_pdf: bytes) -> bytes:
    """Original RAMS pages first, acknowledgement register afterwards."""
    writer = PdfWriter()
    for src in (original_pdf, register_pdf):
        reader = PdfReader(BytesIO(src), strict=False)
        for page in reader.pages:
            writer.add_page(page)
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def format_signed_at(value: datetime | None) -> str:
    if value is None:
        return "—"
    dt = value
    if dt.tzinfo is None:
        from datetime import timezone

        dt = dt.replace(tzinfo=timezone.utc)
    return f"{dt.day} {dt.strftime('%b')} {dt.year}"
