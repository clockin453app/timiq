"""Printable RAMS acknowledgement register and signed-record merge."""

from __future__ import annotations

from io import BytesIO

from pypdf import PdfReader
from reportlab.pdfgen import canvas

from app.modules.rams.signed_record import (
    RamsAckPdfRow,
    build_acknowledgement_register_pdf,
    format_signed_at,
    merge_original_pdf_with_register,
)


def _tiny_pdf(pages: int = 2) -> bytes:
    buf = BytesIO()
    c = canvas.Canvas(buf)
    for i in range(pages):
        c.drawString(72, 720, f"RAMS page {i + 1}")
        c.showPage()
    c.save()
    return buf.getvalue()


def _tiny_png() -> bytes:
    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (80, 28), color=(20, 20, 20)).save(buf, format="PNG")
    return buf.getvalue()


def test_merge_puts_original_pages_before_register() -> None:
    original = _tiny_pdf(3)
    register = build_acknowledgement_register_pdf(
        title="Site RAMS",
        reference="R-1",
        document_version="2",
        company_name="Demo Co",
        site_name="Demo Site 1",
        rows=[
            RamsAckPdfRow(
                employee_name="Employee One",
                job_role="Bricklayer",
                signed_date="1 Aug 2026",
                signature_image=_tiny_png(),
            ),
        ],
    )
    merged = merge_original_pdf_with_register(original, register)
    reader = PdfReader(BytesIO(merged))
    assert len(reader.pages) >= 4  # 3 original + at least 1 register
    text0 = reader.pages[0].extract_text() or ""
    assert "RAMS page 1" in text0


def test_register_pdf_printable_columns_and_job_role() -> None:
    register = build_acknowledgement_register_pdf(
        title="Uploaded RAMS",
        reference="U-9",
        document_version="3",
        company_name="Demo Co",
        site_name=None,
        rows=[
            RamsAckPdfRow(
                employee_name="Printed Name",
                job_role="Site Operative",
                signed_date="1 Aug 2026",
                signature_image=_tiny_png(),
            ),
            RamsAckPdfRow(
                employee_name="pending@example.com",
                job_role="Labourer",
                signed_date="",
                signature_image=None,
                signature_text=None,
            ),
        ],
    )
    pages = PdfReader(BytesIO(register)).pages
    text = "\n".join((p.extract_text() or "") for p in pages)
    assert "Document version" in text or "version" in text.lower()
    assert "Uploaded RAMS" in text
    assert "Employee name" in text
    assert "Job role" in text
    assert "Signature" in text
    assert "Date" in text
    assert "Site Operative" in text
    assert "Printed Name" in text
    assert "1 Aug 2026" in text
    # Status / Version must not appear as table column headers.
    assert "Employee name" in text and "Job role" in text
    for forbidden_header in ("Status", "Version"):
        # Header row is built as consecutive column titles; ensure Status/Version
        # are not present as standalone table headers near Job role.
        assert f"\n{forbidden_header}\n" not in text
    assert "pending@example.com" in text
    assert "Labourer" in text
    # Drawn signature PNG is embedded in the PDF stream.
    assert b"\x89PNG" in register or b"/Image" in register
    # Standalone register has only register pages (no original RAMS body text).
    assert "RAMS page 1" not in text
    assert len(pages) >= 1


def test_pending_row_leaves_signature_and_date_blank() -> None:
    register = build_acknowledgement_register_pdf(
        title="Pending check",
        reference=None,
        document_version="1",
        company_name="Demo Co",
        site_name="Site",
        rows=[
            RamsAckPdfRow(
                employee_name="Only Pending",
                job_role="Carpenter",
                signed_date="",
            ),
        ],
    )
    text = "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(register)).pages)
    assert "Only Pending" in text
    assert "Carpenter" in text
    # No fabricated signed date for pending.
    assert "Aug 2026" not in text
    assert "Signed in app" not in text


def test_format_signed_at_human_readable() -> None:
    from datetime import datetime, timezone

    assert format_signed_at(None) == ""
    assert format_signed_at(datetime(2026, 8, 1, tzinfo=timezone.utc)) == "1 Aug 2026"
