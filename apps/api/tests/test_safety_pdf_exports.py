"""PDF export builders — content smoke tests (no HTTP, no DB)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from app.modules.rams.constants import risk_band, risk_score
from app.modules.rams.pdf_export import build_rams_assessment_pdf
from app.modules.rams.schemas import RamsAcknowledgementResponse, RamsAssessmentDetailResponse, RamsHazardResponse
from app.modules.smart_forms.pdf_export import build_smart_form_submission_pdf
from app.modules.toolbox_talks.pdf_export import build_toolbox_talk_pdf


def _sample_hazard() -> RamsHazardResponse:
    now = datetime.now(timezone.utc)
    return RamsHazardResponse(
        id=uuid.uuid4(),
        assessment_id=uuid.uuid4(),
        hazard="Test hazard",
        who_might_be_harmed="Operatives",
        initial_likelihood=3,
        initial_severity=4,
        initial_risk_score=risk_score(3, 4),
        initial_risk_band=risk_band(risk_score(3, 4)),
        control_measures="Controls text",
        residual_likelihood=2,
        residual_severity=3,
        residual_risk_score=risk_score(2, 3),
        residual_risk_band=risk_band(risk_score(2, 3)),
        residual_higher_than_initial=False,
        sort_order=0,
        created_at=now,
        updated_at=now,
    )


def _minimal_rams_detail() -> RamsAssessmentDetailResponse:
    now = datetime.now(timezone.utc)
    aid = uuid.uuid4()
    h = _sample_hazard()
    h = h.model_copy(update={"assessment_id": aid})
    ack = RamsAcknowledgementResponse(
        user_id=uuid.uuid4(),
        user_email="user@example.com",
        display_name="Test User",
        status="acknowledged",
        acknowledged_at=now,
        acknowledgement_name="Signed Name",
        signature_method="app_signature",
        manual_signature_note=None,
        declined_reason=None,
        has_signature=True,
    )
    return RamsAssessmentDetailResponse(
        id=aid,
        company_id=uuid.uuid4(),
        location_id=None,
        title="Test RAMS",
        reference="RAMS-001",
        work_activity="Brickwork",
        description="Desc",
        status="published",
        risk_level="medium",
        review_due_date=date.today(),
        ppe_json=["Hard hat"],
        no_special_ppe=False,
        created_by_user_id=None,
        reviewed_by_user_id=None,
        created_at=now,
        updated_at=now,
        published_at=now,
        reviewed_at=None,
        archived_at=None,
        project_name="Proj",
        client_name="Client",
        principal_contractor="PC",
        subcontractor_name="Sub",
        site_address="1 Test Street",
        revision="01",
        reason_for_issue="Initial issue",
        produced_by_name="Author",
        checked_by_name="Checker",
        approved_by_name="Approver",
        emergency_contact="999",
        site_manager="SM",
        first_aider="FA",
        fire_marshal="FM",
        muster_point="Gate A",
        nearest_hospital="General Hospital",
        emergency_arrangements="Raise alarm.",
        site_security="Fence",
        welfare_arrangements="Welfare block",
        public_protection="Hoarding",
        deliveries_storage="Banksman",
        scope_of_works="Build wall",
        sequence_of_works=[{"step": 1, "text": "Set out"}],
        pre_start_checklist=["Check access"],
        plant_tools=["Mixer"],
        training_requirements=["Induction"],
        coshh_items=["Cement"],
        glove_requirements=["Mortar gloves"],
        method_statement_sections=[{"title": "Method", "body": "Sequence"}],
        hazards=[h],
        acknowledgements=[ack],
        attachments=[],
        signoff_progress=None,
    )


def test_rams_pdf_is_pdf_and_has_cover_and_matrix() -> None:
    raw = build_rams_assessment_pdf(_minimal_rams_detail())
    assert raw[:4] == b"%PDF"
    assert len(raw) > 4000
    assert b"storage_path" not in raw.lower()
    assert b"app_signature" not in raw
    assert b"&lt;b&gt;" not in raw
    assert b"&lt;i&gt;" not in raw


def test_toolbox_talk_pdf_is_pdf() -> None:
    raw = build_toolbox_talk_pdf(
        company_name="Co",
        title="Talk",
        topic_display="Manual handling",
        location_name="Site A",
        scheduled="2026-01-01",
        talk_status="published",
        presenter_display="Presenter",
        talk_body="Body text",
        key_points=["Point A"],
        do_list=["Do this"],
        dont_list=["Do not that"],
        ppe_reminders=["Boots"],
        attendees_rows=[["User (u@e.com)", "signed", "2026-01-02", "Printed", "Signed in app", "—"]],
    )
    assert raw[:4] == b"%PDF"
    assert b"storage_path" not in raw.lower()
    assert b"&lt;i&gt;" not in raw
    assert b"<i>Generated" not in raw
    assert b"app_signature" not in raw


def test_smart_form_pdf_is_pdf() -> None:
    schema = {
        "sections": [
            {
                "id": "s1",
                "title": "Checks",
                "fields": [{"id": "f1", "label": "OK?", "type": "yes_no", "required": True}],
            }
        ]
    }
    raw = build_smart_form_submission_pdf(
        company_name="Co",
        template_name="Daily",
        template_category="daily_checklist",
        submitter_email="e@e.com",
        submitter_display="Emp",
        location_name="Loc",
        submission_status="submitted",
        answers_json={"f1": "yes"},
        schema_json=schema,
        signature_name="Name",
        has_signature=True,
        review_notes=None,
        submitted_at=datetime.now(timezone.utc),
        reviewed_at=None,
    )
    assert raw[:4] == b"%PDF"
    assert b"storage_path" not in raw.lower()
