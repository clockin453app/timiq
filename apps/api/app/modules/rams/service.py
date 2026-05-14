from __future__ import annotations

import csv
import html
import io
import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

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
from app.modules.rams.models import RamsAcknowledgement, RamsAssessment, RamsHazard
from app.modules.rams.schemas import (
    RamsAcknowledgementResponse,
    RamsAcknowledgementsAddRequest,
    RamsAcknowledgeRequest,
    RamsAssessmentCreateRequest,
    RamsAssessmentDetailResponse,
    RamsAssessmentListItem,
    RamsAssessmentPatchRequest,
    RamsDeclineRequest,
    RamsHazardCreateRequest,
    RamsHazardPatchRequest,
    RamsHazardResponse,
    RamsPresetsResponse,
)
from app.modules.site_access.repository import list_site_access_for_location_ids


class RamsError(Exception):
    pass


class RamsNotFoundError(RamsError):
    pass


class RamsPermissionError(RamsError):
    pass


class RamsValidationError(RamsError):
    pass


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
    )


def _build_detail(
    db: Session,
    row: RamsAssessment,
    viewer: User,
) -> RamsAssessmentDetailResponse:
    hazards = [_hazard_to_response(h) for h in rams_repo.list_hazards(db, row.id)]
    acks = [_ack_to_response(db, a, viewer=viewer) for a in rams_repo.list_acknowledgements_for_assessment(db, row.id)]
    ppe = _normalize_ppe(list(row.ppe_json) if isinstance(row.ppe_json, list) else [])
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
        hazards=hazards,
        acknowledgements=acks,
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
    return RamsPresetsResponse(hazard_examples=list(HAZARD_EXAMPLE_PRESETS), ppe_options=list(PPE_OPTION_PRESETS))


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
    company = get_company_by_id(db, detail.company_id)
    company_name = html.escape(company.name if company else "Company")
    loc_name = "—"
    if detail.location_id:
        loc = get_location_by_id(db, detail.location_id)
        if loc:
            loc_name = html.escape(loc.name)
    title = html.escape(detail.title)
    ref = html.escape(detail.reference or "—")
    work = html.escape(detail.work_activity).replace("\n", "<br/>")
    desc = html.escape(detail.description or "").replace("\n", "<br/>") if detail.description else "—"
    ppe_lines = "".join(f"<li>{html.escape(p)}</li>" for p in detail.ppe_json)
    if not ppe_lines:
        ppe_lines = "<li>—</li>" if not detail.no_special_ppe else "<li>No special PPE (as recorded)</li>"

    haz_rows = []
    for h in detail.hazards:
        haz_rows.append(
            "<tr>"
            f"<td>{html.escape(h.hazard)}</td>"
            f"<td>{html.escape(h.who_might_be_harmed or '—')}</td>"
            f"<td>{h.initial_risk_score} ({html.escape(h.initial_risk_band)})</td>"
            f"<td>{html.escape(h.control_measures).replace('\n', '<br/>')}</td>"
            f"<td>{h.residual_risk_score} ({html.escape(h.residual_risk_band)})</td>"
            "</tr>",
        )

    ack_rows = []
    raw_ack = rams_repo.list_acknowledgements_for_assessment(db, assessment_id)
    for a in raw_ack:
        sch = _ack_to_response(db, a, viewer=actor)
        if actor.system_role == SystemRole.EMPLOYEE and a.user_id != actor.id:
            ack_rows.append(
                "<tr>"
                f"<td>{html.escape(sch.display_name or 'Employee')}</td>"
                f"<td>{html.escape(sch.status)}</td>"
                f"<td>{html.escape(sch.acknowledged_at.isoformat() if sch.acknowledged_at else '—')}</td>"
                f"<td>{html.escape(sch.acknowledgement_name or '—')}</td>"
                "<td>—</td>"
                "</tr>",
            )
        else:
            u = get_user_by_id(db, a.user_id)
            email = html.escape(u.email if u else "")
            ack_rows.append(
                "<tr>"
                f"<td>{html.escape(sch.display_name or '')} ({email})</td>"
                f"<td>{html.escape(sch.status)}</td>"
                f"<td>{html.escape(sch.acknowledged_at.isoformat() if sch.acknowledged_at else '—')}</td>"
                f"<td>{html.escape(sch.acknowledgement_name or '—')}</td>"
                f"<td>{html.escape(sch.declined_reason or '—')}</td>"
                "</tr>",
            )

    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="rams.exported",
        entity_type="rams_assessment",
        entity_id=str(assessment_id),
        company_id=detail.company_id,
        details={"assessment_id": str(assessment_id), "actor_user_id": str(actor.id), "export_type": "print_html"},
    )
    gen = html.escape(_utc_now().isoformat())
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>RAMS — {title}</title>
<style>
body {{ font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; color: #222; }}
h1 {{ font-size: 22px; }}
table {{ border-collapse: collapse; width: 100%; margin-top: 16px; }}
th, td {{ border: 1px solid #ccc; padding: 8px; text-align: left; font-size: 13px; vertical-align: top; }}
th {{ background: #f5f5f5; }}
.meta {{ font-size: 14px; color: #444; }}
@media print {{ body {{ margin: 12px; }} }}
</style></head><body>
<h1>Risk assessment (RAMS) record</h1>
<p class="meta"><strong>Company:</strong> {company_name}</p>
<p class="meta"><strong>Title:</strong> {title}</p>
<p class="meta"><strong>Reference:</strong> {ref}</p>
<p class="meta"><strong>Location:</strong> {loc_name}</p>
<p class="meta"><strong>Work activity:</strong></p><div class="meta">{work}</div>
<p class="meta"><strong>Description:</strong></p><div class="meta">{desc}</div>
<p class="meta"><strong>Risk level (overall):</strong> {html.escape(detail.risk_level)}</p>
<p class="meta"><strong>Status:</strong> {html.escape(detail.status)}</p>
<p class="meta"><strong>Review due:</strong> {html.escape(str(detail.review_due_date) if detail.review_due_date else '—')}</p>
<h2 style="margin-top:20px;font-size:16px;">PPE</h2>
<ul>{ppe_lines}</ul>
<h2 style="margin-top:20px;font-size:16px;">Hazards</h2>
<table><thead><tr><th>Hazard</th><th>Who might be harmed</th><th>Initial risk</th><th>Controls</th><th>Residual risk</th></tr></thead><tbody>{"".join(haz_rows)}</tbody></table>
<h2 style="margin-top:20px;font-size:16px;">Acknowledgements</h2>
<table><thead><tr><th>Employee</th><th>Status</th><th>Acknowledged at</th><th>Name given</th><th>Declined reason</th></tr></thead><tbody>{"".join(ack_rows)}</tbody></table>
<p style="margin-top:16px;font-size:12px;color:#666;">Generated {gen}. Use Print to save as PDF.</p>
</body></html>"""


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
