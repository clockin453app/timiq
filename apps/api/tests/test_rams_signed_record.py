"""Complete signed RAMS record: original pages + acknowledgement register with signatures."""

from __future__ import annotations

from io import BytesIO

from pypdf import PdfReader
from reportlab.pdfgen import canvas

from app.modules.rams.signed_record import (
    RamsAckPdfRow,
    build_acknowledgement_register_pdf,
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
                employee="Employee One",
                status="acknowledged",
                signed_date="1 Aug 2026",
                printed_name="Employee One",
                document_version="2",
                signature_image=_tiny_png(),
            ),
        ],
    )
    merged = merge_original_pdf_with_register(original, register)
    reader = PdfReader(BytesIO(merged))
    assert len(reader.pages) >= 4  # 3 original + at least 1 register
    # First pages come from the original document.
    text0 = reader.pages[0].extract_text() or ""
    assert "RAMS page 1" in text0


def test_register_pdf_includes_version_and_printed_name() -> None:
    register = build_acknowledgement_register_pdf(
        title="Uploaded RAMS",
        reference="U-9",
        document_version="3",
        company_name="Demo Co",
        site_name=None,
        rows=[
            RamsAckPdfRow(
                employee="Emp",
                status="acknowledged",
                signed_date="1 Aug 2026",
                printed_name="Printed Name",
                document_version="3",
                signature_text="Signed in app",
            ),
        ],
    )
    text = "\n".join((p.extract_text() or "") for p in PdfReader(BytesIO(register)).pages)
    assert "Document version" in text or "version" in text.lower()
    assert "Printed Name" in text
    assert "Uploaded RAMS" in text
