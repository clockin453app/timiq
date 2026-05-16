from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.modules.rams.document_presets import get_document_preset_by_id
from app.modules.rams.pdf_export import build_rams_assessment_pdf
from app.modules.rams.print_service import build_professional_rams_print_html
from app.modules.rams.schemas import RamsAssessmentDetailResponse


def _detail(document_sections: list[dict[str, object]]) -> RamsAssessmentDetailResponse:
    now = datetime.now(timezone.utc)
    return RamsAssessmentDetailResponse(
        id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        location_id=None,
        title="NEBW — Brickwork & Blockwork RAMS",
        reference="RAMS-001",
        work_activity="Brickwork and blockwork",
        description="Professional RAMS pack",
        status="draft",
        risk_level="high",
        review_due_date=None,
        ppe_json=["Hard hat"],
        no_special_ppe=False,
        created_by_user_id=None,
        reviewed_by_user_id=None,
        created_at=now,
        updated_at=now,
        published_at=None,
        reviewed_at=None,
        archived_at=None,
        document_sections=document_sections,
        hazards=[],
        acknowledgements=[],
        attachments=[],
    )


def test_nebw_preset_contains_professional_document_sections() -> None:
    preset = get_document_preset_by_id("brickwork_masonry")
    assert preset is not None
    titles = [section["title"] for section in preset["document_sections"]]
    assert titles[:5] == [
        "Cover page",
        "Revision control & approvals",
        "Company / project details",
        "Introduction & safety commitment",
        "Emergency procedures",
    ]
    assert "Employee acknowledgement / signature register" in titles


def test_print_and_pdf_render_from_document_sections_without_slots_or_paths() -> None:
    preset = get_document_preset_by_id("brickwork_masonry")
    assert preset is not None
    detail = _detail(preset["document_sections"])

    html = build_professional_rams_print_html(detail)
    assert "Cover page" in html
    assert "Hazard assessment table" in html
    assert "Employee acknowledgement / signature register" in html
    assert "Photo slot" not in html
    assert "storage_path" not in html
    assert "signature_image_path" not in html

    pdf = build_rams_assessment_pdf(detail)
    assert pdf.startswith(b"%PDF")
    assert b"storage_path" not in pdf
    assert b"signature_image_path" not in pdf
