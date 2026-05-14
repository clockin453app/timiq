from __future__ import annotations

import csv
import html
import io
import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.core.signature_data_url import SignatureDataUrlError, decode_png_data_url
from app.core.storage.factory import get_storage_backend
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.companies.repository import get_company_by_id
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.locations.repository import get_location_by_id
from app.modules.rams import repository as rams_repo
from app.modules.rams.constants import (
    HAZARD_EXAMPLE_PRESETS,
    PPE_OPTION_PRESETS,
    RISK_LEVELS,
    risk_band,
    risk_score,
)
from app.modules.rams.document_presets import RAMS_DOCUMENT_PRESETS, document_preset_public, get_document_preset_by_id
from app.modules.rams.models import RamsAcknowledgement, RamsAssessment, RamsAttachment, RamsHazard
from app.modules.rams.print_service import build_professional_rams_print_html
from app.modules.rams.schemas import (
    RamsAcknowledgementResponse,
    RamsAcknowledgementsAddRequest,
    RamsAcknowledgeRequest,
    RamsAssessmentCreateRequest,
    RamsAssessmentDetailResponse,
    RamsAssessmentListItem,
    RamsAssessmentPatchRequest,
    RamsAttachmentResponse,
    RamsDeclineRequest,
    RamsDocumentPresetPublic,
    RamsFromPresetRequest,
    RamsHazardCreateRequest,
    RamsHazardPatchRequest,
    RamsHazardResponse,
    RamsPresetsResponse,
    RamsSignoffProgress,
)
from app.modules.site_access.repository import list_site_access_for_location_ids
from app.modules.work_progress.image_processing import detect_magic_file_kind, process_site_progress_photo


class RamsError(Exception):
    pass


class RamsNotFoundError(RamsError):
    pass


class RamsPermissionError(RamsError):
    pass


class RamsValidationError(RamsError):
    pass


_MAX_RAMS_ORIGINAL_BYTES = 25 * 1024 * 1024
_MAX_RAMS_STORED_BYTES = 10 * 1024 * 1024
_MAX_RAMS_ATTACHMENTS = 36
_RAMS_SECTION_KEYS = frozenset(
    {
        "cover_image",
        "emergency_plan",
        "site_layout",
        "welfare_area",
        "delivery_area",
        "storage_area",
        "ppe_image",
        "glove_image",
        "method_step",
        "hazard_image",
        "safe_stand",
        "housekeeping",
        "coshh",
        "other",
    },
)
_STORED_JPEG = "image/jpeg"


def _rams_process_upload_image(file_bytes: bytes) -> tuple[bytes, int, int, int]:
    if len(file_bytes) == 0:
        raise RamsValidationError("Uploaded file is empty.")
    if len(file_bytes) > _MAX_RAMS_ORIGINAL_BYTES:
        raise RamsValidationError("Image file is too large before processing.")
    kind = detect_magic_file_kind(file_bytes)
    if kind == "pdf":
        raise RamsValidationError("PDF uploads are not allowed for RAMS photo slots in v1.")
    if kind not in ("jpeg", "png", "webp"):
        raise RamsValidationError("Unsupported image type. Only JPEG, PNG, or WebP are allowed.")
    try:
        processed, w, h = process_site_progress_photo(file_bytes)
    except Exception:
        raise RamsValidationError("Failed to process image. Try a different photo.") from None
    if len(processed) > _MAX_RAMS_STORED_BYTES:
        raise RamsValidationError("Processed image is too large.")
    return processed, len(file_bytes), w, h


def _coerce_str_list(val: object | None) -> list[str] | None:
    if val is None:
        return None
    if isinstance(val, list):
        return [str(x) for x in val]
    return None


def _coerce_obj_list(val: object | None) -> list[dict[str, object]] | None:
    if val is None:
        return None
    if isinstance(val, list):
        out: list[dict[str, object]] = []
        for item in val:
            if isinstance(item, dict):
                out.append({str(k): v for k, v in item.items()})
        return out or None
    return None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _can_admin_manage_company(actor: User, company_id: uuid.UUID) -> bool:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return True
    if actor.system_role == SystemRole.ADMIN:
        return actor.company_id is not None and actor.company_id == company_id
    return False


def _ensure_company_user(actor: User) -> uuid.UUID:
    if actor.company_id is None:
        raise RamsValidationError("Your account is not linked to a company.")
    return actor.company_id


def _assert_location_for_company(db: Session, company_id: uuid.UUID, location_id: uuid.UUID | None) -> None:
    if location_id is None:
        return
    loc = get_location_by_id(db, location_id)
    if loc is None or loc.company_id != company_id:
        raise RamsValidationError("Location is not valid for this company.")


def _display_name(db: Session, user_id: uuid.UUID) -> str | None:
    profile = get_employee_profile_by_user_id(db, user_id)
    if profile is None:
        return None
    first = (profile.first_name or "").strip()
    last = (profile.last_name or "").strip()
    name = f"{first} {last}".strip()
    return name or None


def _normalize_ppe(raw: list[str] | None) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    for x in raw:
        s = (x or "").strip()
        if s:
            out.append(s)
    return out


def _hazard_to_response(row: RamsHazard) -> RamsHazardResponse:
    ini = risk_score(row.initial_likelihood, row.initial_severity)
    res = risk_score(row.residual_likelihood, row.residual_severity)
    return RamsHazardResponse(
        id=row.id,
        assessment_id=row.assessment_id,
        hazard=row.hazard,
        who_might_be_harmed=row.who_might_be_harmed,
        initial_likelihood=row.initial_likelihood,
        initial_severity=row.initial_severity,
        initial_risk_score=ini,
        initial_risk_band=risk_band(ini),
        control_measures=row.control_measures,
        residual_likelihood=row.residual_likelihood,
        residual_severity=row.residual_severity,
        residual_risk_score=res,
        residual_risk_band=risk_band(res),
        residual_higher_than_initial=res > ini,
        sort_order=row.sort_order,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _ack_to_response(
    db: Session,
    row: RamsAcknowledgement,
    *,
    viewer: User,
) -> RamsAcknowledgementResponse:
    u = get_user_by_id(db, row.user_id)
    email = u.email if u else None
    display = _display_name(db, row.user_id)
    is_self = viewer.id == row.user_id
    hide_peer_decline = viewer.system_role == SystemRole.EMPLOYEE and not is_self
    return RamsAcknowledgementResponse(
        user_id=row.user_id,
        user_email=email if is_self or viewer.system_role != SystemRole.EMPLOYEE else None,
        display_name=display,
        status=row.status,
        acknowledged_at=row.acknowledged_at,
        acknowledgement_name=row.acknowledgement_name if row.status == "acknowledged" and (is_self or viewer.system_role != SystemRole.EMPLOYEE) else None,
        declined_reason=None if hide_peer_decline else row.declined_reason,
        has_signature=bool((row.signature_image_path or "").strip()),
    )


def _signoff_progress_rows(ack_rows: list[RamsAcknowledgement]) -> RamsSignoffProgress:
    tot = len(ack_rows)
    pen = sum(1 for a in ack_rows if a.status == "pending")
    ack = sum(1 for a in ack_rows if a.status == "acknowledged")
    dec = sum(1 for a in ack_rows if a.status == "declined")
    return RamsSignoffProgress(total_assigned=tot, pending=pen, acknowledged=ack, declined=dec)


def _attachments_public(db: Session, assessment_id: uuid.UUID) -> list[RamsAttachmentResponse]:
    return [
        RamsAttachmentResponse(
            id=a.id,
            assessment_id=assessment_id,
            section_key=a.section_key,
            hazard_id=a.hazard_id,
            method_step_key=a.method_step_key,
            caption=a.caption,
            original_filename=a.original_filename,
            content_type=a.content_type,
            file_size_bytes=a.file_size_bytes,
            created_at=a.created_at,
            download_href=f"/api/rams/{assessment_id}/attachments/{a.id}/download",
        )
        for a in rams_repo.list_attachments_for_assessment(db, assessment_id)
    ]


def _build_detail(
    db: Session,
    row: RamsAssessment,
    viewer: User,
) -> RamsAssessmentDetailResponse:
    hazards = [_hazard_to_response(h) for h in rams_repo.list_hazards(db, row.id)]
    raw_ack = rams_repo.list_acknowledgements_for_assessment(db, row.id)
    acks = [_ack_to_response(db, a, viewer=viewer) for a in raw_ack]
    ppe = _normalize_ppe(list(row.ppe_json) if isinstance(row.ppe_json, list) else [])
    signoff: RamsSignoffProgress | None = None
    if viewer.system_role in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR) and _can_admin_manage_company(
        viewer, row.company_id
    ):
        signoff = _signoff_progress_rows(raw_ack)
    attachments = _attachments_public(db, row.id)
    return RamsAssessmentDetailResponse(
        id=row.id,
        company_id=row.company_id,
        location_id=row.location_id,
        title=row.title,
        reference=row.reference,
        work_activity=row.work_activity,
        description=row.description,
        status=row.status,
        risk_level=row.risk_level,
        review_due_date=row.review_due_date,
        ppe_json=ppe,
        no_special_ppe=bool(row.no_special_ppe),
        created_by_user_id=row.created_by_user_id,
        reviewed_by_user_id=row.reviewed_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        published_at=row.published_at,
        reviewed_at=row.reviewed_at,
        archived_at=row.archived_at,
        project_name=getattr(row, "project_name", None),
        client_name=getattr(row, "client_name", None),
        principal_contractor=getattr(row, "principal_contractor", None),
        subcontractor_name=getattr(row, "subcontractor_name", None),
        site_address=getattr(row, "site_address", None),
        revision=getattr(row, "revision", None) or "01",
        reason_for_issue=getattr(row, "reason_for_issue", None),
        produced_by_name=getattr(row, "produced_by_name", None),
        checked_by_name=getattr(row, "checked_by_name", None),
        approved_by_name=getattr(row, "approved_by_name", None),
        emergency_contact=getattr(row, "emergency_contact", None),
        site_manager=getattr(row, "site_manager", None),
        first_aider=getattr(row, "first_aider", None),
        fire_marshal=getattr(row, "fire_marshal", None),
        muster_point=getattr(row, "muster_point", None),
        nearest_hospital=getattr(row, "nearest_hospital", None),
        emergency_arrangements=getattr(row, "emergency_arrangements", None),
        site_security=getattr(row, "site_security", None),
        welfare_arrangements=getattr(row, "welfare_arrangements", None),
        public_protection=getattr(row, "public_protection", None),
        deliveries_storage=getattr(row, "deliveries_storage", None),
        scope_of_works=getattr(row, "scope_of_works", None),
        sequence_of_works=_coerce_obj_list(getattr(row, "sequence_of_works", None)),
        pre_start_checklist=_coerce_str_list(getattr(row, "pre_start_checklist", None)),
        plant_tools=_coerce_str_list(getattr(row, "plant_tools", None)),
        training_requirements=_coerce_str_list(getattr(row, "training_requirements", None)),
        coshh_items=_coerce_str_list(getattr(row, "coshh_items", None)),
        glove_requirements=_coerce_str_list(getattr(row, "glove_requirements", None)),
        method_statement_sections=_coerce_obj_list(getattr(row, "method_statement_sections", None)),
        hazards=hazards,
        acknowledgements=acks,
        attachments=attachments,
        signoff_progress=signoff,
    )


def _can_view_assessment(db: Session, actor: User, row: RamsAssessment) -> bool:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return True
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            return False
        return row.company_id == actor.company_id
    if actor.system_role == SystemRole.EMPLOYEE:
        if actor.company_id is None or row.company_id != actor.company_id:
            return False
        ack = rams_repo.get_acknowledgement(db, row.id, actor.id)
        if ack is None:
            return False
        return row.status in ("published", "reviewed", "archived")
    return False


def get_presets() -> RamsPresetsResponse:
    doc_presets = [RamsDocumentPresetPublic.model_validate(document_preset_public(p)) for p in RAMS_DOCUMENT_PRESETS]
    return RamsPresetsResponse(
        hazard_examples=list(HAZARD_EXAMPLE_PRESETS),
        ppe_options=list(PPE_OPTION_PRESETS),
        document_presets=doc_presets,
        assessment_presets=doc_presets,
    )


def create_assessment_from_preset(
    db: Session,
    actor: User,
    body: RamsFromPresetRequest,
) -> RamsAssessmentDetailResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    preset = get_document_preset_by_id(body.preset_id.strip())
    if preset is None:
        raise RamsValidationError("Unknown preset_id.")
    company_id = body.company_id
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise RamsValidationError("Your account is not linked to a company.")
        if company_id is not None and company_id != actor.company_id:
            raise RamsPermissionError()
        company_id = actor.company_id
    elif actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id is None:
            raise RamsValidationError("company_id is required.")
    else:
        raise RamsPermissionError()
    assert company_id is not None
    rl = preset["risk_level"].strip().lower()
    if rl not in RISK_LEVELS:
        raise RamsValidationError("Invalid preset risk_level.")
    _assert_location_for_company(db, company_id, body.location_id)
    now = _utc_now()
    ppe = _normalize_ppe(list(preset["ppe"]))

    def _strip_opt(val: str | None) -> str | None:
        if val is None:
            return None
        t = val.strip()
        return t or None

    mg = list(preset.get("mandatory_gloves") or [])
    gr = list(preset.get("glove_requirements") or [])
    gloves_combined: list[str] | None = (mg + gr) if (mg or gr) else None
    row = RamsAssessment(
        company_id=company_id,
        location_id=body.location_id,
        title=preset["title"].strip()[:300],
        reference=body.reference.strip() if body.reference else None,
        work_activity=preset["work_activity"].strip()[:2000],
        description=(preset["description"] or "").strip() or None,
        status="draft",
        risk_level=rl,
        review_due_date=body.review_due_date,
        ppe_json=ppe,
        no_special_ppe=len(ppe) == 0,
        created_by_user_id=actor.id,
        reviewed_by_user_id=None,
        created_at=now,
        updated_at=now,
        published_at=None,
        reviewed_at=None,
        archived_at=None,
        project_name=_strip_opt(body.project_name),
        client_name=_strip_opt(body.client_name),
        principal_contractor=_strip_opt(body.principal_contractor),
        subcontractor_name=_strip_opt(body.subcontractor_name),
        site_address=_strip_opt(body.site_address),
        revision="01",
        sequence_of_works=preset.get("sequence_of_works"),
        pre_start_checklist=preset.get("pre_start_checklist"),
        plant_tools=preset.get("plant_tools"),
        training_requirements=preset.get("training_requirements"),
        coshh_items=preset.get("coshh_items"),
        glove_requirements=gloves_combined,
        method_statement_sections=preset.get("method_statement_sections"),
    )
    rams_repo.save_assessment(db, row)
    for i, hz in enumerate(preset["hazards"]):
        hrow = RamsHazard(
            assessment_id=row.id,
            company_id=company_id,
            hazard=hz["hazard"].strip()[:2000],
            who_might_be_harmed=(hz["who_might_be_harmed"] or "").strip()[:2000] or None,
            initial_likelihood=int(hz["initial_likelihood"]),
            initial_severity=int(hz["initial_severity"]),
            control_measures=hz["control_measures"].strip(),
            residual_likelihood=int(hz["residual_likelihood"]),
            residual_severity=int(hz["residual_severity"]),
            sort_order=i,
            created_at=now,
            updated_at=now,
        )
        rams_repo.save_hazard(db, hrow)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.assessment_created_from_preset",
        entity_type="rams_assessment",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "assessment_id": str(row.id),
            "preset_id": body.preset_id.strip(),
            "actor_user_id": str(actor.id),
            "hazard_count": len(preset["hazards"]),
        },
    )
    return _build_detail(db, row, actor)


def list_me(db: Session, actor: User) -> list[RamsAssessmentListItem]:
    if actor.system_role != SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    _ensure_company_user(actor)
    rows = rams_repo.list_me_assessment_rows(db, actor.id)

    def sort_key(item: tuple[RamsAssessment, RamsAcknowledgement]) -> tuple[int, datetime]:
        a, ack = item
        if ack.status == "pending" and a.status in ("published", "reviewed"):
            return (0, a.updated_at)
        return (1, a.updated_at)

    rows_sorted = sorted(rows, key=sort_key)
    out: list[RamsAssessmentListItem] = []
    for a, ack in rows_sorted:
        out.append(
            RamsAssessmentListItem(
                id=a.id,
                company_id=a.company_id,
                location_id=a.location_id,
                title=a.title,
                reference=a.reference,
                work_activity=a.work_activity,
                status=a.status,
                risk_level=a.risk_level,
                review_due_date=a.review_due_date,
                published_at=a.published_at,
                reviewed_at=a.reviewed_at,
                updated_at=a.updated_at,
                my_ack_status=ack.status,
            )
        )
    return out


def list_assessments_admin(
    db: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    status: str | None,
    location_id: uuid.UUID | None,
    risk_level: str | None,
    date_from: date | None,
    date_to: date | None,
) -> list[RamsAssessmentListItem]:
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise RamsPermissionError()
    resolved_company: uuid.UUID | None
    if actor.system_role == SystemRole.ADMINISTRATOR:
        resolved_company = company_id
    else:
        if actor.company_id is None:
            return []
        resolved_company = actor.company_id
        if company_id is not None and company_id != actor.company_id:
            raise RamsPermissionError()
    rows = rams_repo.list_assessments_admin(
        db,
        company_id=resolved_company,
        status=status,
        location_id=location_id,
        risk_level=risk_level,
        date_from=date_from,
        date_to=date_to,
    )
    return [
        RamsAssessmentListItem(
            id=r.id,
            company_id=r.company_id,
            location_id=r.location_id,
            title=r.title,
            reference=r.reference,
            work_activity=r.work_activity,
            status=r.status,
            risk_level=r.risk_level,
            review_due_date=r.review_due_date,
            published_at=r.published_at,
            reviewed_at=r.reviewed_at,
            updated_at=r.updated_at,
            my_ack_status=None,
        )
        for r in rows
    ]


def get_assessment_detail(db: Session, actor: User, assessment_id: uuid.UUID) -> RamsAssessmentDetailResponse:
    row = rams_repo.get_assessment(db, assessment_id)
    if row is None:
        raise RamsNotFoundError()
    if not _can_view_assessment(db, actor, row):
        raise RamsNotFoundError()
    return _build_detail(db, row, actor)


def create_assessment(db: Session, actor: User, body: RamsAssessmentCreateRequest) -> RamsAssessmentDetailResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    company_id = body.company_id
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise RamsValidationError("Your account is not linked to a company.")
        if company_id is not None and company_id != actor.company_id:
            raise RamsPermissionError()
        company_id = actor.company_id
    elif actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id is None:
            raise RamsValidationError("company_id is required.")
    else:
        raise RamsPermissionError()
    assert company_id is not None
    if body.risk_level not in RISK_LEVELS:
        raise RamsValidationError("Invalid risk_level.")
    _assert_location_for_company(db, company_id, body.location_id)
    now = _utc_now()
    ppe = _normalize_ppe(body.ppe_json)
    row = RamsAssessment(
        company_id=company_id,
        location_id=body.location_id,
        title=body.title.strip(),
        reference=body.reference.strip() if body.reference else None,
        work_activity=body.work_activity.strip(),
        description=body.description.strip() if body.description else None,
        status="draft",
        risk_level=body.risk_level.strip(),
        review_due_date=body.review_due_date,
        ppe_json=ppe,
        no_special_ppe=bool(body.no_special_ppe),
        created_by_user_id=actor.id,
        reviewed_by_user_id=None,
        created_at=now,
        updated_at=now,
        published_at=None,
        reviewed_at=None,
        archived_at=None,
    )
    rams_repo.save_assessment(db, row)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.assessment_created",
        entity_type="rams_assessment",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "assessment_id": str(row.id),
            "company_id": str(row.company_id),
            "location_id": str(row.location_id) if row.location_id else None,
            "actor_user_id": str(actor.id),
            "status": row.status,
            "risk_level": row.risk_level,
        },
    )
    return _build_detail(db, row, actor)


def patch_assessment(
    db: Session, actor: User, assessment_id: uuid.UUID, body: RamsAssessmentPatchRequest
) -> RamsAssessmentDetailResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    row = rams_repo.get_assessment(db, assessment_id)
    if row is None:
        raise RamsNotFoundError()
    if not _can_admin_manage_company(actor, row.company_id):
        raise RamsNotFoundError()
    if row.status == "archived":
        raise RamsValidationError("Archived assessments cannot be edited.")
    changed: list[str] = []
    if body.title is not None:
        nt = body.title.strip()
        if nt != row.title:
            changed.append("title")
        row.title = nt
    if body.reference is not None:
        nr = body.reference.strip() if body.reference else None
        if nr != row.reference:
            changed.append("reference")
        row.reference = nr
    if body.work_activity is not None:
        nw = body.work_activity.strip()
        if nw != row.work_activity:
            changed.append("work_activity")
        row.work_activity = nw
    if body.description is not None:
        nd = body.description.strip() if body.description else None
        if nd != row.description:
            changed.append("description")
        row.description = nd
    if body.location_id is not None:
        if body.location_id != row.location_id:
            changed.append("location_id")
        row.location_id = body.location_id
    if body.risk_level is not None:
        rl = body.risk_level.strip()
        if rl not in RISK_LEVELS:
            raise RamsValidationError("Invalid risk_level.")
        if rl != row.risk_level:
            changed.append("risk_level")
        row.risk_level = rl
    if body.review_due_date is not None:
        if body.review_due_date != row.review_due_date:
            changed.append("review_due_date")
        row.review_due_date = body.review_due_date
    if body.ppe_json is not None:
        np = _normalize_ppe(body.ppe_json)
        if np != _normalize_ppe(list(row.ppe_json) if isinstance(row.ppe_json, list) else []):
            changed.append("ppe_json")
        row.ppe_json = np
    if body.no_special_ppe is not None:
        if bool(body.no_special_ppe) != row.no_special_ppe:
            changed.append("no_special_ppe")
        row.no_special_ppe = bool(body.no_special_ppe)

    def _set_text(name: str, val: str | None) -> None:
        nonlocal changed
        if val is None:
            return
        stripped = val.strip() or None
        if getattr(row, name) != stripped:
            changed.append(name)
            setattr(row, name, stripped)

    _set_text("project_name", body.project_name)
    _set_text("client_name", body.client_name)
    _set_text("principal_contractor", body.principal_contractor)
    _set_text("subcontractor_name", body.subcontractor_name)
    if body.site_address is not None:
        ns = body.site_address.strip() or None
        if row.site_address != ns:
            changed.append("site_address")
        row.site_address = ns
    _set_text("revision", body.revision)
    if body.reason_for_issue is not None:
        ns = body.reason_for_issue.strip() or None
        if row.reason_for_issue != ns:
            changed.append("reason_for_issue")
        row.reason_for_issue = ns
    _set_text("produced_by_name", body.produced_by_name)
    _set_text("checked_by_name", body.checked_by_name)
    _set_text("approved_by_name", body.approved_by_name)
    _set_text("emergency_contact", body.emergency_contact)
    _set_text("site_manager", body.site_manager)
    _set_text("first_aider", body.first_aider)
    _set_text("fire_marshal", body.fire_marshal)
    _set_text("muster_point", body.muster_point)
    _set_text("nearest_hospital", body.nearest_hospital)
    if body.emergency_arrangements is not None:
        ns = body.emergency_arrangements.strip() or None
        if row.emergency_arrangements != ns:
            changed.append("emergency_arrangements")
        row.emergency_arrangements = ns
    if body.site_security is not None:
        ns = body.site_security.strip() or None
        if row.site_security != ns:
            changed.append("site_security")
        row.site_security = ns
    if body.welfare_arrangements is not None:
        ns = body.welfare_arrangements.strip() or None
        if row.welfare_arrangements != ns:
            changed.append("welfare_arrangements")
        row.welfare_arrangements = ns
    if body.public_protection is not None:
        ns = body.public_protection.strip() or None
        if row.public_protection != ns:
            changed.append("public_protection")
        row.public_protection = ns
    if body.deliveries_storage is not None:
        ns = body.deliveries_storage.strip() or None
        if row.deliveries_storage != ns:
            changed.append("deliveries_storage")
        row.deliveries_storage = ns
    if body.scope_of_works is not None:
        ns = body.scope_of_works.strip() or None
        if row.scope_of_works != ns:
            changed.append("scope_of_works")
        row.scope_of_works = ns
    if body.sequence_of_works is not None:
        row.sequence_of_works = body.sequence_of_works
        changed.append("sequence_of_works")
    if body.pre_start_checklist is not None:
        row.pre_start_checklist = body.pre_start_checklist
        changed.append("pre_start_checklist")
    if body.plant_tools is not None:
        row.plant_tools = body.plant_tools
        changed.append("plant_tools")
    if body.training_requirements is not None:
        row.training_requirements = body.training_requirements
        changed.append("training_requirements")
    if body.coshh_items is not None:
        row.coshh_items = body.coshh_items
        changed.append("coshh_items")
    if body.glove_requirements is not None:
        row.glove_requirements = body.glove_requirements
        changed.append("glove_requirements")
    if body.method_statement_sections is not None:
        row.method_statement_sections = body.method_statement_sections
        changed.append("method_statement_sections")

    _assert_location_for_company(db, row.company_id, row.location_id)
    row.updated_at = _utc_now()
    rams_repo.save_assessment(db, row)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.assessment_updated",
        entity_type="rams_assessment",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "assessment_id": str(row.id),
            "actor_user_id": str(actor.id),
            "changed_fields": changed,
            "status": row.status,
            "risk_level": row.risk_level,
        },
    )
    return _build_detail(db, row, actor)


def publish_assessment(db: Session, actor: User, assessment_id: uuid.UUID) -> RamsAssessmentDetailResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    row = rams_repo.get_assessment(db, assessment_id)
    if row is None:
        raise RamsNotFoundError()
    if not _can_admin_manage_company(actor, row.company_id):
        raise RamsNotFoundError()
    if row.status != "draft":
        raise RamsValidationError("Only draft assessments can be published.")
    if rams_repo.count_hazards(db, row.id) < 1:
        raise RamsValidationError("Publish requires at least one hazard.")
    ppe = _normalize_ppe(list(row.ppe_json) if isinstance(row.ppe_json, list) else [])
    if len(ppe) < 1 and not row.no_special_ppe:
        raise RamsValidationError("Add PPE items or mark no special PPE required before publishing.")
    now = _utc_now()
    row.status = "published"
    row.published_at = now
    row.updated_at = now
    rams_repo.save_assessment(db, row)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.assessment_published",
        entity_type="rams_assessment",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "assessment_id": str(row.id),
            "actor_user_id": str(actor.id),
            "hazard_count": rams_repo.count_hazards(db, row.id),
            "acknowledgement_count": rams_repo.count_acknowledgements(db, row.id),
            "status": row.status,
            "risk_level": row.risk_level,
            "location_id": str(row.location_id) if row.location_id else None,
        },
    )
    return _build_detail(db, row, actor)


def review_assessment(db: Session, actor: User, assessment_id: uuid.UUID) -> RamsAssessmentDetailResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    row = rams_repo.get_assessment(db, assessment_id)
    if row is None:
        raise RamsNotFoundError()
    if not _can_admin_manage_company(actor, row.company_id):
        raise RamsNotFoundError()
    if row.status != "published":
        raise RamsValidationError("Only published assessments can be marked reviewed.")
    now = _utc_now()
    row.status = "reviewed"
    row.reviewed_at = now
    row.reviewed_by_user_id = actor.id
    row.updated_at = now
    rams_repo.save_assessment(db, row)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.assessment_reviewed",
        entity_type="rams_assessment",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "assessment_id": str(row.id),
            "actor_user_id": str(actor.id),
            "status": row.status,
            "risk_level": row.risk_level,
        },
    )
    return _build_detail(db, row, actor)


def archive_assessment(db: Session, actor: User, assessment_id: uuid.UUID) -> RamsAssessmentDetailResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    row = rams_repo.get_assessment(db, assessment_id)
    if row is None:
        raise RamsNotFoundError()
    if not _can_admin_manage_company(actor, row.company_id):
        raise RamsNotFoundError()
    if row.status not in ("published", "reviewed"):
        raise RamsValidationError("Only published or reviewed assessments can be archived.")
    now = _utc_now()
    row.status = "archived"
    row.archived_at = now
    row.updated_at = now
    rams_repo.save_assessment(db, row)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.assessment_archived",
        entity_type="rams_assessment",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "assessment_id": str(row.id),
            "actor_user_id": str(actor.id),
            "status": row.status,
        },
    )
    return _build_detail(db, row, actor)


def list_hazards(db: Session, actor: User, assessment_id: uuid.UUID) -> list[RamsHazardResponse]:
    detail = get_assessment_detail(db, actor, assessment_id)
    return detail.hazards


def create_hazard(db: Session, actor: User, assessment_id: uuid.UUID, body: RamsHazardCreateRequest) -> RamsHazardResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    row_a = rams_repo.get_assessment(db, assessment_id)
    if row_a is None:
        raise RamsNotFoundError()
    if not _can_admin_manage_company(actor, row_a.company_id):
        raise RamsNotFoundError()
    if row_a.status == "archived":
        raise RamsValidationError("Cannot add hazards to an archived assessment.")
    now = _utc_now()
    sort_order = rams_repo.max_hazard_sort_order(db, assessment_id) + 1
    hz = RamsHazard(
        assessment_id=assessment_id,
        company_id=row_a.company_id,
        hazard=body.hazard.strip(),
        who_might_be_harmed=body.who_might_be_harmed.strip() if body.who_might_be_harmed else None,
        initial_likelihood=body.initial_likelihood,
        initial_severity=body.initial_severity,
        control_measures=body.control_measures.strip(),
        residual_likelihood=body.residual_likelihood,
        residual_severity=body.residual_severity,
        sort_order=sort_order,
        created_at=now,
        updated_at=now,
    )
    rams_repo.save_hazard(db, hz)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.hazard_created",
        entity_type="rams_hazard",
        entity_id=str(hz.id),
        company_id=row_a.company_id,
        details={
            "assessment_id": str(assessment_id),
            "actor_user_id": str(actor.id),
            "hazard_count": rams_repo.count_hazards(db, assessment_id),
        },
    )
    return _hazard_to_response(hz)


def patch_hazard(
    db: Session, actor: User, assessment_id: uuid.UUID, hazard_id: uuid.UUID, body: RamsHazardPatchRequest
) -> RamsHazardResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    row_a = rams_repo.get_assessment(db, assessment_id)
    if row_a is None:
        raise RamsNotFoundError()
    if not _can_admin_manage_company(actor, row_a.company_id):
        raise RamsNotFoundError()
    if row_a.status == "archived":
        raise RamsValidationError("Cannot edit hazards on an archived assessment.")
    hz = rams_repo.get_hazard(db, hazard_id)
    if hz is None or hz.assessment_id != assessment_id:
        raise RamsNotFoundError()
    if body.hazard is not None:
        hz.hazard = body.hazard.strip()
    if body.who_might_be_harmed is not None:
        hz.who_might_be_harmed = body.who_might_be_harmed.strip() if body.who_might_be_harmed else None
    if body.initial_likelihood is not None:
        hz.initial_likelihood = body.initial_likelihood
    if body.initial_severity is not None:
        hz.initial_severity = body.initial_severity
    if body.control_measures is not None:
        hz.control_measures = body.control_measures.strip()
    if body.residual_likelihood is not None:
        hz.residual_likelihood = body.residual_likelihood
    if body.residual_severity is not None:
        hz.residual_severity = body.residual_severity
    if body.sort_order is not None:
        hz.sort_order = body.sort_order
    hz.updated_at = _utc_now()
    rams_repo.save_hazard(db, hz)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.hazard_updated",
        entity_type="rams_hazard",
        entity_id=str(hz.id),
        company_id=row_a.company_id,
        details={"assessment_id": str(assessment_id), "actor_user_id": str(actor.id)},
    )
    return _hazard_to_response(hz)


def delete_hazard(db: Session, actor: User, assessment_id: uuid.UUID, hazard_id: uuid.UUID) -> None:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    row_a = rams_repo.get_assessment(db, assessment_id)
    if row_a is None:
        raise RamsNotFoundError()
    if not _can_admin_manage_company(actor, row_a.company_id):
        raise RamsNotFoundError()
    if row_a.status == "archived":
        raise RamsValidationError("Cannot delete hazards on an archived assessment.")
    hz = rams_repo.get_hazard(db, hazard_id)
    if hz is None or hz.assessment_id != assessment_id:
        raise RamsNotFoundError()
    rams_repo.delete_hazard(db, hz)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.hazard_deleted",
        entity_type="rams_hazard",
        entity_id=str(hazard_id),
        company_id=row_a.company_id,
        details={
            "assessment_id": str(assessment_id),
            "actor_user_id": str(actor.id),
            "hazard_count": rams_repo.count_hazards(db, assessment_id),
        },
    )


def list_acknowledgements_admin(db: Session, actor: User, assessment_id: uuid.UUID) -> list[RamsAcknowledgementResponse]:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    row = rams_repo.get_assessment(db, assessment_id)
    if row is None:
        raise RamsNotFoundError()
    if not _can_admin_manage_company(actor, row.company_id):
        raise RamsNotFoundError()
    return [
        _ack_to_response(db, a, viewer=actor) for a in rams_repo.list_acknowledgements_for_assessment(db, assessment_id)
    ]


def add_acknowledgements(
    db: Session, actor: User, assessment_id: uuid.UUID, body: RamsAcknowledgementsAddRequest
) -> RamsAssessmentDetailResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    talk = rams_repo.get_assessment(db, assessment_id)
    if talk is None:
        raise RamsNotFoundError()
    if not _can_admin_manage_company(actor, talk.company_id):
        raise RamsNotFoundError()
    if talk.status == "archived":
        raise RamsValidationError("Cannot modify acknowledgements on an archived assessment.")
    user_ids: set[uuid.UUID] = set(body.user_ids)
    if body.all_site_users:
        if talk.location_id is None:
            raise RamsValidationError("all_site_users requires the assessment to have a location.")
        rows = list_site_access_for_location_ids(db, [talk.location_id])
        for r in rows:
            u = get_user_by_id(db, r.user_id)
            if u is not None and u.company_id == talk.company_id:
                user_ids.add(r.user_id)
    now = _utc_now()
    added = 0
    for uid in user_ids:
        target = get_user_by_id(db, uid)
        if target is None or target.company_id != talk.company_id:
            continue
        if rams_repo.get_acknowledgement(db, assessment_id, uid) is not None:
            continue
        ack = RamsAcknowledgement(
            assessment_id=assessment_id,
            company_id=talk.company_id,
            user_id=uid,
            status="pending",
            acknowledgement_name=None,
            acknowledged_at=None,
            declined_reason=None,
            signature_image_path=None,
            created_at=now,
            updated_at=now,
        )
        rams_repo.save_acknowledgement(db, ack)
        added += 1
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.acknowledgements_added",
        entity_type="rams_assessment",
        entity_id=str(talk.id),
        company_id=talk.company_id,
        details={
            "assessment_id": str(talk.id),
            "actor_user_id": str(actor.id),
            "added_count": added,
            "acknowledgement_count": rams_repo.count_acknowledgements(db, assessment_id),
        },
    )
    return _build_detail(db, talk, actor)


def acknowledge_assessment(db: Session, actor: User, assessment_id: uuid.UUID, body: RamsAcknowledgeRequest) -> RamsAssessmentDetailResponse:
    if actor.system_role != SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    company_id = _ensure_company_user(actor)
    row = rams_repo.get_assessment(db, assessment_id)
    if row is None or row.company_id != company_id:
        raise RamsNotFoundError()
    if row.status == "archived":
        raise RamsValidationError("This assessment is archived and cannot be acknowledged.")
    if row.status not in ("published", "reviewed"):
        raise RamsValidationError("This assessment is not open for acknowledgement.")
    if not body.read_understood_ack:
        raise RamsValidationError("You must confirm you have read and understood this RAMS.")
    att = rams_repo.get_acknowledgement(db, assessment_id, actor.id)
    if att is None:
        raise RamsNotFoundError()
    if att.status == "acknowledged":
        raise RamsValidationError("You have already acknowledged this assessment.")
    if att.status != "pending":
        raise RamsValidationError("You cannot acknowledge in the current state.")
    name = body.acknowledgement_name.strip()
    try:
        png = decode_png_data_url(body.signature_image_data)
    except SignatureDataUrlError as exc:
        raise RamsValidationError(str(exc)) from exc
    rel = f"rams-signatures/{row.company_id}/{assessment_id}/{actor.id}/signature-{uuid.uuid4().hex}.png"
    backend = get_storage_backend()
    if att.signature_image_path:
        try:
            backend.delete_file(att.signature_image_path)
        except Exception:
            pass
    backend.write_bytes(rel, png)
    att.signature_image_path = rel
    att.status = "acknowledged"
    att.acknowledgement_name = name
    att.acknowledged_at = _utc_now()
    att.declined_reason = None
    att.updated_at = _utc_now()
    rams_repo.save_acknowledgement(db, att)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.acknowledged",
        entity_type="rams_acknowledgement",
        entity_id=str(att.id),
        company_id=row.company_id,
        details={
            "assessment_id": str(row.id),
            "actor_user_id": str(actor.id),
            "status": att.status,
        },
    )
    return _build_detail(db, row, actor)


def decline_assessment(db: Session, actor: User, assessment_id: uuid.UUID, body: RamsDeclineRequest) -> RamsAssessmentDetailResponse:
    if actor.system_role != SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    company_id = _ensure_company_user(actor)
    row = rams_repo.get_assessment(db, assessment_id)
    if row is None or row.company_id != company_id:
        raise RamsNotFoundError()
    if row.status == "archived":
        raise RamsValidationError("This assessment is archived.")
    if row.status not in ("published", "reviewed"):
        raise RamsValidationError("This assessment is not open for responses.")
    att = rams_repo.get_acknowledgement(db, assessment_id, actor.id)
    if att is None:
        raise RamsNotFoundError()
    if att.status != "pending":
        raise RamsValidationError("You have already responded.")
    reason = body.reason.strip()
    att.status = "declined"
    att.declined_reason = reason
    att.acknowledgement_name = None
    att.acknowledged_at = None
    att.updated_at = _utc_now()
    rams_repo.save_acknowledgement(db, att)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.declined",
        entity_type="rams_acknowledgement",
        entity_id=str(att.id),
        company_id=row.company_id,
        details={"assessment_id": str(row.id), "actor_user_id": str(actor.id), "status": att.status},
    )
    return _build_detail(db, row, actor)


def render_print_html(db: Session, actor: User, assessment_id: uuid.UUID) -> str:
    detail = get_assessment_detail(db, actor, assessment_id)
    html_out = build_professional_rams_print_html(detail)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.exported",
        entity_type="rams_assessment",
        entity_id=str(assessment_id),
        company_id=detail.company_id,
        details={"assessment_id": str(assessment_id), "actor_user_id": str(actor.id), "export_type": "print_html_pack"},
    )
    return html_out


def list_rams_attachments_service(db: Session, actor: User, assessment_id: uuid.UUID) -> list[RamsAttachmentResponse]:
    get_assessment_detail(db, actor, assessment_id)
    return _attachments_public(db, assessment_id)


def upload_rams_attachment_service(
    db: Session,
    actor: User,
    assessment_id: uuid.UUID,
    *,
    file_bytes: bytes,
    original_filename: str,
    section_key: str,
    caption: str | None,
    hazard_id: uuid.UUID | None,
    method_step_key: str | None,
) -> RamsAssessmentDetailResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    row = rams_repo.get_assessment(db, assessment_id)
    if row is None:
        raise RamsNotFoundError()
    if not _can_admin_manage_company(actor, row.company_id):
        raise RamsNotFoundError()
    if row.status == "archived":
        raise RamsValidationError("Archived assessments cannot be edited.")
    sk = section_key.strip()
    if sk not in _RAMS_SECTION_KEYS:
        raise RamsValidationError("Invalid section_key.")
    if hazard_id is not None:
        hz = rams_repo.get_hazard(db, hazard_id)
        if hz is None or hz.assessment_id != assessment_id:
            raise RamsValidationError("Invalid hazard_id for this assessment.")
    if rams_repo.count_attachments_for_assessment(db, assessment_id) >= _MAX_RAMS_ATTACHMENTS:
        raise RamsValidationError("Maximum RAMS attachments reached for this assessment.")
    processed, _orig_len, _w, _h = _rams_process_upload_image(file_bytes)
    rel_path = f"rams-files/{row.company_id}/{assessment_id}/{uuid.uuid4().hex}.jpg"
    get_storage_backend().write_bytes(rel_path, processed)
    now = _utc_now()
    cap = caption.strip() if caption else None
    att = RamsAttachment(
        assessment_id=assessment_id,
        company_id=row.company_id,
        section_key=sk,
        hazard_id=hazard_id,
        method_step_key=method_step_key.strip()[:120] if method_step_key else None,
        original_filename=(original_filename or "upload.jpg")[:500],
        content_type=_STORED_JPEG,
        file_size_bytes=len(processed),
        storage_path=rel_path,
        caption=cap[:500] if cap else None,
        created_by_user_id=actor.id,
        created_at=now,
    )
    rams_repo.save_attachment(db, att)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.attachment_uploaded",
        entity_type="rams_attachment",
        entity_id=str(att.id),
        company_id=row.company_id,
        details={"assessment_id": str(assessment_id), "section_key": sk},
    )
    row2 = rams_repo.get_assessment(db, assessment_id)
    assert row2 is not None
    return _build_detail(db, row2, actor)


def delete_rams_attachment_service(db: Session, actor: User, assessment_id: uuid.UUID, attachment_id: uuid.UUID) -> None:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    row = rams_repo.get_assessment(db, assessment_id)
    if row is None:
        raise RamsNotFoundError()
    if not _can_admin_manage_company(actor, row.company_id):
        raise RamsNotFoundError()
    if row.status == "archived":
        raise RamsValidationError("Archived assessments cannot be edited.")
    att = rams_repo.get_attachment(db, attachment_id)
    if att is None or att.assessment_id != assessment_id:
        raise RamsNotFoundError()
    try:
        get_storage_backend().delete_file(att.storage_path)
    except OSError:
        pass
    rams_repo.delete_attachment(db, att)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.attachment_deleted",
        entity_type="rams_attachment",
        entity_id=str(attachment_id),
        company_id=row.company_id,
        details={"assessment_id": str(assessment_id)},
    )


def download_rams_attachment_file(
    db: Session, actor: User, assessment_id: uuid.UUID, attachment_id: uuid.UUID
) -> tuple[bytes, str, str]:
    row = rams_repo.get_assessment(db, assessment_id)
    if row is None:
        raise RamsNotFoundError()
    if not _can_view_assessment(db, actor, row):
        raise RamsNotFoundError()
    att = rams_repo.get_attachment(db, attachment_id)
    if att is None or att.assessment_id != assessment_id:
        raise RamsNotFoundError()
    data = get_storage_backend().read_bytes(att.storage_path)
    name = att.original_filename or "download.jpg"
    return data, name, att.content_type


def export_csv_bytes(db: Session, actor: User, assessment_id: uuid.UUID) -> tuple[bytes, str]:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    row = rams_repo.get_assessment(db, assessment_id)
    if row is None:
        raise RamsNotFoundError()
    if not _can_admin_manage_company(actor, row.company_id):
        raise RamsNotFoundError()
    detail = get_assessment_detail(db, actor, assessment_id)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["section", "field", "value"])
    w.writerow(["assessment", "title", detail.title])
    w.writerow(["assessment", "reference", detail.reference or ""])
    w.writerow(["assessment", "work_activity", detail.work_activity])
    w.writerow(["assessment", "status", detail.status])
    w.writerow(["assessment", "risk_level", detail.risk_level])
    w.writerow(["assessment", "review_due_date", str(detail.review_due_date) if detail.review_due_date else ""])
    w.writerow(["assessment", "ppe", "; ".join(detail.ppe_json)])
    w.writerow(["assessment", "no_special_ppe", str(detail.no_special_ppe)])
    w.writerow([])
    w.writerow(["hazard", "hazard", "who_harmed", "initial_score", "initial_band", "controls", "residual_score", "residual_band"])
    for h in detail.hazards:
        w.writerow(
            [
                "hazard",
                h.hazard,
                h.who_might_be_harmed or "",
                h.initial_risk_score,
                h.initial_risk_band,
                h.control_measures,
                h.residual_risk_score,
                h.residual_risk_band,
            ],
        )
    w.writerow([])
    w.writerow(["acknowledgement", "display_name", "email", "status", "acknowledged_at", "acknowledgement_name", "declined_reason"])
    for a in rams_repo.list_acknowledgements_for_assessment(db, assessment_id):
        sch = _ack_to_response(db, a, viewer=actor)
        u = get_user_by_id(db, a.user_id)
        w.writerow(
            [
                "acknowledgement",
                sch.display_name or "",
                u.email if u else "",
                sch.status,
                sch.acknowledged_at.isoformat() if sch.acknowledged_at else "",
                sch.acknowledgement_name or "",
                sch.declined_reason or "",
            ],
        )
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.exported",
        entity_type="rams_assessment",
        entity_id=str(assessment_id),
        company_id=detail.company_id,
        details={"assessment_id": str(assessment_id), "actor_user_id": str(actor.id), "export_type": "csv"},
    )
    return buf.getvalue().encode("utf-8"), f"rams-{assessment_id}.csv"


def delete_assessment_hard(db: Session, actor: User, assessment_id: uuid.UUID) -> None:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise RamsPermissionError()
    row = rams_repo.get_assessment(db, assessment_id)
    if row is None:
        raise RamsNotFoundError()
    if not _can_admin_manage_company(actor, row.company_id):
        raise RamsNotFoundError()
    if row.status != "draft":
        raise RamsValidationError("Only draft RAMS can be permanently deleted. Archive assessments with compliance history.")
    for a in rams_repo.list_acknowledgements_for_assessment(db, assessment_id):
        if a.status != "pending":
            raise RamsValidationError("This RAMS has acknowledgement activity. Archive it instead of deleting.")
        if a.signature_image_path:
            try:
                get_storage_backend().delete_file(a.signature_image_path)
            except Exception:
                pass
    for att in rams_repo.list_attachments_for_assessment(db, assessment_id):
        try:
            get_storage_backend().delete_file(att.storage_path)
        except Exception:
            pass
    cid = row.company_id
    rams_repo.delete_assessment_row(db, row)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.assessment_deleted",
        entity_type="rams_assessment",
        entity_id=str(assessment_id),
        company_id=cid,
        details={"assessment_id": str(assessment_id), "actor_user_id": str(actor.id), "company_id": str(cid)},
    )


def export_assessment_pdf_bytes(db: Session, actor: User, assessment_id: uuid.UUID) -> tuple[bytes, str]:
    detail = get_assessment_detail(db, actor, assessment_id)
    from app.modules.rams.pdf_export import build_rams_assessment_pdf

    pdf = build_rams_assessment_pdf(detail)
    ref = (detail.reference or str(assessment_id))[:80]
    safe_ref = "".join(ch for ch in ref if ch.isalnum() or ch in ("-", "_")) or str(assessment_id)
    fname = f"rams-{safe_ref}.pdf"
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.exported",
        entity_type="rams_assessment",
        entity_id=str(assessment_id),
        company_id=detail.company_id,
        details={"assessment_id": str(assessment_id), "actor_user_id": str(actor.id), "export_type": "pdf"},
    )
    return pdf, fname
