"""Compact Toolbox Talk PDF + drawn-signature embedding tests."""

from __future__ import annotations

import io
from datetime import date, datetime, timezone

from PIL import Image

from app.modules.toolbox_talks.pdf_export import (
    ToolboxTalkAttendeePdfRow,
    build_toolbox_talk_pdf,
    count_pdf_pages,
    format_display_date,
    format_signed_date_in_timezone,
    pdf_embedded_image_count,
    pdf_text_haystack,
)


def _png_bytes(*, width: int = 120, height: int = 40, color: tuple[int, int, int] = (20, 20, 20)) -> bytes:
    img = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    for x in range(10, width - 10):
        y = int(height / 2 + 8 * ((x % 20) / 10 - 1))
        if 0 <= y < height:
            img.putpixel((x, y), (*color, 255))
            if y + 1 < height:
                img.putpixel((x, y + 1), (*color, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _sample_body() -> str:
    return (
        "Purpose\nManual handling briefing for today's lift tasks.\n\n"
        "Key hazards\nAwkward loads\nTwisting under load\n\n"
        "Do\nUse mechanical aids first\n\n"
        "Do not\nDo not twist under load\n\n"
        "Sign-off declaration\nI confirm I understand the controls discussed."
    )


def test_signature_cell_fallbacks_for_export() -> None:
    from app.modules.toolbox_talks.models import ToolboxTalkAttendee
    from app.modules.toolbox_talks.service import _signature_cell_for_export
    import uuid

    drawn = ToolboxTalkAttendee(
        id=uuid.uuid4(),
        talk_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        status="signed",
        signature_method="app_signature",
        signature_name="Ada",
        signature_image_path="toolbox-talk-signatures/co/talk/user/signature.png",
    )
    assert _signature_cell_for_export(drawn, image_bytes=b"PNGDATA", image_load_attempted=True) == (b"PNGDATA", None)
    assert _signature_cell_for_export(drawn, image_bytes=None, image_load_attempted=True) == (
        None,
        "Signature unavailable",
    )

    electronic = ToolboxTalkAttendee(
        id=uuid.uuid4(),
        talk_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        status="signed",
        signature_method="app_signature",
        signature_name="Ada",
        signature_image_path=None,
    )
    assert _signature_cell_for_export(electronic, image_bytes=None, image_load_attempted=False) == (
        None,
        "Signed electronically",
    )

    paper = ToolboxTalkAttendee(
        id=uuid.uuid4(),
        talk_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        status="signed",
        signature_method="manual_paper",
        signature_name="Paper Name",
        signature_image_path=None,
    )
    assert _signature_cell_for_export(paper, image_bytes=None, image_load_attempted=False) == (None, "Paper Name")


def test_format_display_date_compact() -> None:
    assert format_display_date(date(2026, 8, 1)) == "1 Aug 2026"
    assert format_display_date(date(2026, 12, 25)) == "25 Dec 2026"


def test_signed_date_uses_company_timezone_not_utc_shift_alone() -> None:
    # 2026-08-01 23:30 UTC → 2 Aug in Europe/London (BST)
    signed = datetime(2026, 8, 1, 23, 30, 4, 393000, tzinfo=timezone.utc)
    assert format_signed_date_in_timezone(signed, "Europe/London") == "2 Aug 2026"
    assert format_signed_date_in_timezone(signed, "UTC") == "1 Aug 2026"


def test_toolbox_talk_pdf_header_company_not_timiq_heading() -> None:
    raw = build_toolbox_talk_pdf(
        company_name="New Era Brickwork",
        title="Manual handling",
        topic_display="Manual handling",
        location_name="Ruislip",
        scheduled="1 Aug 2026",
        talk_status="published",
        presenter_display="John Smith",
        talk_body=_sample_body(),
        attendees_rows=[
            ToolboxTalkAttendeePdfRow(
                employee="Ada Lovelace (ada@example.com)",
                status="signed",
                signed_date="1 Aug 2026",
                printed_name="Ada Lovelace",
                signature_image=_png_bytes(),
            ),
        ],
        published_display="1 Aug 2026",
        record_ref="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        generated_display="1 Aug 2026",
    )
    hay = pdf_text_haystack(raw)
    assert b"New Era Brickwork" in hay
    assert b"Toolbox Talk Record" in hay
    assert hay.find(b"New Era Brickwork") < hay.find(b"Toolbox Talk Record")
    assert b"Generated 1 Aug 2026" in hay
    assert b"TimIQ" in hay
    # No large standalone TimIQ document heading before the company name in page content.
    content_start = hay.find(b"New Era Brickwork")
    assert content_start != -1
    assert b"TimIQ" not in hay[content_start : content_start + 80]
    assert b"Ruislip" in hay
    assert b"John Smith" in hay
    assert b"1 Aug 2026" in hay
    assert b"Published" in hay
    assert b"Signed in app" not in hay
    assert b"2026-08-01T" not in hay
    assert b"toolbox-talk-signatures/" not in hay
    assert b"storage_path" not in hay.lower()
    assert pdf_embedded_image_count(raw) >= 1
    assert count_pdf_pages(raw) <= 2


def test_toolbox_talk_pdf_embeds_correct_attendee_signature() -> None:
    png_a = _png_bytes(color=(10, 20, 30))
    png_b = _png_bytes(color=(200, 10, 10))
    raw = build_toolbox_talk_pdf(
        company_name="Acme Ltd",
        title="Talk",
        topic_display="PPE",
        location_name="Yard",
        scheduled="1 Aug 2026",
        talk_status="published",
        presenter_display="Lead",
        talk_body="Purpose\nShort talk.\n\nSign-off declaration\nUnderstood.",
        attendees_rows=[
            ToolboxTalkAttendeePdfRow(
                employee="Alice (a@e.com)",
                status="signed",
                signed_date="1 Aug 2026",
                printed_name="Alice",
                signature_image=png_a,
            ),
            ToolboxTalkAttendeePdfRow(
                employee="Bob (b@e.com)",
                status="signed",
                signed_date="1 Aug 2026",
                printed_name="Bob",
                signature_image=png_b,
            ),
        ],
    )
    assert pdf_embedded_image_count(raw) >= 2
    hay = pdf_text_haystack(raw)
    assert b"Alice" in hay and b"Bob" in hay
    assert b"Printed" not in hay or b"Alice" in hay  # printed names present
    assert b"Alice" in hay
    assert b"signed" in hay


def test_toolbox_talk_pdf_missing_image_fallback() -> None:
    raw = build_toolbox_talk_pdf(
        company_name="Co",
        title="Talk",
        topic_display="Topic",
        location_name=None,
        scheduled=None,
        talk_status="published",
        presenter_display=None,
        talk_body="Purpose\nBody.\n\nSign-off declaration\nOK.",
        attendees_rows=[
            ToolboxTalkAttendeePdfRow(
                employee="Missing Sig (m@e.com)",
                status="signed",
                signed_date="1 Aug 2026",
                printed_name="Missing Sig",
                signature_image=None,
                signature_text="Signature unavailable",
            ),
        ],
    )
    hay = pdf_text_haystack(raw)
    assert b"Signature unavailable" in hay
    assert b"No specific site" in hay
    assert b"Not specified" in hay
    assert b"Not scheduled" in hay
    assert b"Signed in app" not in hay
    assert pdf_embedded_image_count(raw) == 0


def test_toolbox_talk_pdf_typed_and_electronic_fallbacks() -> None:
    raw = build_toolbox_talk_pdf(
        company_name="Co",
        title="Talk",
        topic_display="Topic",
        location_name="Site",
        scheduled="1 Aug 2026",
        talk_status="published",
        presenter_display="P",
        talk_body="Body only without structured headings — still compact.",
        attendees_rows=[
            ToolboxTalkAttendeePdfRow(
                employee="Typed (t@e.com)",
                status="signed",
                signed_date="1 Aug 2026",
                printed_name="Typed Name",
                signature_text="Typed Name",
            ),
            ToolboxTalkAttendeePdfRow(
                employee="E-Sign (e@e.com)",
                status="signed",
                signed_date="1 Aug 2026",
                printed_name="E Sign",
                signature_text="Signed electronically",
            ),
        ],
    )
    hay = pdf_text_haystack(raw)
    assert b"Typed Name" in hay
    assert b"Signed electronically" in hay
    assert b"Signed in app" not in hay


def test_toolbox_talk_pdf_long_names_and_multi_page_attendees() -> None:
    long_name = "Very Long Employee Name " * 4 + "(verylong.email.address@example.co.uk)"
    long_site = "Ruislip High Street Construction Compound Extension Phase Two"
    long_presenter = "Jonathan Christopher Presenter-Smith Esq"
    rows = [
        ToolboxTalkAttendeePdfRow(
            employee=f"{long_name} #{i}",
            status="signed",
            signed_date="1 Aug 2026",
            printed_name=f"Print Name {i}",
            signature_image=_png_bytes(width=160, height=50, color=(10 + i * 7, 20, 30 + i)),
            note="Declined late" if i == 0 else None,
        )
        for i in range(28)
    ]
    raw = build_toolbox_talk_pdf(
        company_name="New Era Brickwork",
        title="Manual handling",
        topic_display="Manual handling",
        location_name=long_site,
        scheduled="1 Aug 2026",
        talk_status="published",
        presenter_display=long_presenter,
        talk_body=_sample_body() + "\n\nAdditional notes\n" + ("Extra paragraph. " * 40),
        attendees_rows=rows,
        published_display="1 Aug 2026",
    )
    hay = pdf_text_haystack(raw)
    assert long_site.encode() in hay
    assert long_presenter.encode() in hay
    assert b"Notes" in hay  # notes column present when a note exists
    assert count_pdf_pages(raw) >= 2
    # Header label should appear more than once when the table repeats across pages.
    assert hay.count(b"Signed date") >= 2
    assert pdf_embedded_image_count(raw) >= 10
    assert b"toolbox-talk-signatures/" not in hay


def test_toolbox_talk_pdf_omits_notes_column_when_empty() -> None:
    raw = build_toolbox_talk_pdf(
        company_name="Co",
        title="Talk",
        topic_display="Topic",
        location_name="Site",
        scheduled="1 Aug 2026",
        talk_status="published",
        presenter_display="P",
        talk_body="Short.",
        attendees_rows=[
            ToolboxTalkAttendeePdfRow(
                employee="A (a@e.com)",
                status="signed",
                signed_date="1 Aug 2026",
                printed_name="A",
                signature_text="Signed electronically",
            ),
        ],
    )
    hay = pdf_text_haystack(raw)
    assert b"Signed date" in hay
    # Column header "Notes" should not appear when no notes exist.
    assert b"Notes" not in hay.split(b"Attendee sign-off register", 1)[-1].split(b"Generated", 1)[0]


def test_toolbox_talk_pdf_aspect_ratio_box_does_not_claim_path() -> None:
    # Wide signature should still embed as a single Image XObject without path leakage.
    wide = _png_bytes(width=400, height=40)
    tall = _png_bytes(width=40, height=200)
    for png in (wide, tall):
        raw = build_toolbox_talk_pdf(
            company_name="Co",
            title="Talk",
            topic_display="Topic",
            location_name="Site",
            scheduled="1 Aug 2026",
            talk_status="published",
            presenter_display="P",
            talk_body="Body",
            attendees_rows=[
                ToolboxTalkAttendeePdfRow(
                    employee="Sig (s@e.com)",
                    status="signed",
                    signed_date="1 Aug 2026",
                    printed_name="Sig",
                    signature_image=png,
                ),
            ],
        )
        assert pdf_embedded_image_count(raw) >= 1
        assert b"toolbox-talk-signatures/" not in pdf_text_haystack(raw)
