from __future__ import annotations

import base64
import csv
import html
import io
import logging
import uuid
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.core.signature_data_url import SignatureDataUrlError, decode_png_data_url
from app.core.storage.factory import get_storage_backend
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.companies.repository import get_company_by_id, get_company_time_policy
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.locations.repository import get_location_by_id
from app.modules.notifications.events import record_toolbox_sign_required
from app.modules.site_access.repository import list_site_access_for_location_ids
from app.modules.toolbox_talks import repository as tt_repo
from app.modules.toolbox_talks.constants import is_known_topic, topic_label
from app.modules.toolbox_talks.models import ToolboxTalk, ToolboxTalkAttendee
from app.modules.toolbox_talks.pdf_export import (
    ToolboxTalkAttendeePdfRow,
    format_display_date,
    format_signed_date_in_timezone,
    resolve_company_timezone_name,
)
from app.modules.toolbox_talks.schemas import (
    ToolboxTalkAttendeeResponse,
    ToolboxTalkAttendeesAddRequest,
    ToolboxTalkBulkAttendeesRequest,
    ToolboxTalkBulkAttendeesResponse,
    ToolboxTalkBulkPreviewResponse,
    ToolboxTalkCreateRequest,
    ToolboxTalkDeclineRequest,
    ToolboxTalkDetailResponse,
    ToolboxTalkPatchRequest,
    ToolboxTalkManualSignRequest,
    ToolboxTalkSignRequest,
    ToolboxTalkSummaryResponse,
    ToolboxTalkVoidRequest,
    ToolboxTopicOption,
    ToolboxTopicTemplateResponse,
)

logger = logging.getLogger(__name__)


class ToolboxTalkError(Exception):
    pass


class ToolboxTalkNotFoundError(ToolboxTalkError):
    pass


class ToolboxTalkPermissionError(ToolboxTalkError):
    pass


class ToolboxTalkValidationError(ToolboxTalkError):
    pass


ALLOWED_TALK_STATUS = frozenset({"draft", "published", "completed", "archived", "voided"})
ALLOWED_ATTENDEE_STATUS = frozenset({"pending", "signed", "declined", "absent"})
ASSIGNABLE_TALK_STATUSES = frozenset({"draft", "published"})
LOCKED_TALK_STATUSES = frozenset({"completed", "archived", "voided"})
EMPLOYEE_VISIBLE_TALK_STATUSES = frozenset({"published", "completed", "archived", "voided"})


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def list_topic_options() -> list[ToolboxTopicOption]:
    from app.modules.toolbox_talks.constants import TOOLBOX_TOPIC_VALUES

    return [ToolboxTopicOption(value=v, label=topic_label(v)) for v in TOOLBOX_TOPIC_VALUES]


def list_topic_templates() -> list[ToolboxTopicTemplateResponse]:
    from app.modules.toolbox_talks.topic_templates import list_topic_template_dicts

    return [ToolboxTopicTemplateResponse.model_validate(d) for d in list_topic_template_dicts()]


def _validate_topic_fields(topic: str, topic_custom: str | None) -> None:
    if not is_known_topic(topic):
        raise ToolboxTalkValidationError("Unknown topic.")
    if topic == "custom":
        if not topic_custom or not topic_custom.strip():
            raise ToolboxTalkValidationError("Custom topic text is required when topic is Custom.")
        if len(topic_custom.strip()) > 200:
            raise ToolboxTalkValidationError("Custom topic text is too long.")


def _display_name(db: Session, user_id: uuid.UUID) -> str | None:
    profile = get_employee_profile_by_user_id(db, user_id)
    if profile is None:
        return None
    first = (profile.first_name or "").strip()
    last = (profile.last_name or "").strip()
    name = f"{first} {last}".strip()
    return name or None


def _topic_display(topic: str, topic_custom: str | None) -> str:
    if topic == "custom" and topic_custom:
        return topic_custom.strip()
    return topic_label(topic)


def _can_admin_manage_company(actor: User, company_id: uuid.UUID) -> bool:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return True
    if actor.system_role == SystemRole.ADMIN:
        return actor.company_id is not None and actor.company_id == company_id
    return False


def _ensure_company_user(actor: User) -> uuid.UUID:
    if actor.company_id is None:
        raise ToolboxTalkValidationError("Your account is not linked to a company.")
    return actor.company_id


def _assert_location_for_company(db: Session, company_id: uuid.UUID, location_id: uuid.UUID | None) -> None:
    if location_id is None:
        return
    loc = get_location_by_id(db, location_id)
    if loc is None or loc.company_id != company_id:
        raise ToolboxTalkValidationError("Location is not valid for this company.")


def _is_eligible_employee(user: User | None, company_id: uuid.UUID) -> bool:
    if user is None:
        return False
    if user.company_id != company_id:
        return False
    if not user.is_active:
        return False
    if user.system_role != SystemRole.EMPLOYEE:
        return False
    return True


def _assert_talk_allows_attendee_assignment(talk: ToolboxTalk) -> None:
    if talk.status in LOCKED_TALK_STATUSES:
        raise ToolboxTalkValidationError(
            f"Cannot modify attendees on a {talk.status} toolbox talk.",
        )
    if talk.status not in ASSIGNABLE_TALK_STATUSES:
        raise ToolboxTalkValidationError("Attendees can only be assigned on draft or published talks.")


def _assert_talk_allows_pending_removal(talk: ToolboxTalk) -> None:
    if talk.status in LOCKED_TALK_STATUSES:
        raise ToolboxTalkValidationError(
            f"Cannot remove attendees from a {talk.status} toolbox talk.",
        )
    if talk.status not in ASSIGNABLE_TALK_STATUSES:
        raise ToolboxTalkValidationError("Attendees can only be removed on draft or published talks.")


def _resolve_bulk_eligible_ids(
    db: Session,
    talk: ToolboxTalk,
    *,
    scope: str,
) -> tuple[list[uuid.UUID], int, uuid.UUID | None]:
    """Return (eligible_user_ids, ineligible_count, site_id)."""
    scope_norm = (scope or "").strip().lower()
    if scope_norm not in ("company", "site"):
        raise ToolboxTalkValidationError('scope must be "company" or "site".')

    site_id: uuid.UUID | None = None
    if scope_norm == "company":
        candidates = tt_repo.list_active_employees_for_company(db, talk.company_id)
        eligible = [u.id for u in candidates if _is_eligible_employee(u, talk.company_id)]
        return eligible, 0, None

    if talk.location_id is None:
        raise ToolboxTalkValidationError(
            "Site scope requires the toolbox talk to have a location. Assign a site first.",
        )
    site_id = talk.location_id
    _assert_location_for_company(db, talk.company_id, site_id)
    access_rows = list_site_access_for_location_ids(db, [site_id])
    eligible: list[uuid.UUID] = []
    ineligible = 0
    seen: set[uuid.UUID] = set()
    for row in access_rows:
        if row.user_id in seen:
            continue
        seen.add(row.user_id)
        user = get_user_by_id(db, row.user_id)
        if _is_eligible_employee(user, talk.company_id):
            eligible.append(row.user_id)
        else:
            ineligible += 1
    return eligible, ineligible, site_id


def _bulk_preview_counts(
    db: Session,
    talk: ToolboxTalk,
    *,
    scope: str,
) -> ToolboxTalkBulkPreviewResponse:
    eligible_ids, ineligible, site_id = _resolve_bulk_eligible_ids(db, talk, scope=scope)
    assigned = tt_repo.list_assigned_user_ids_for_talk(db, talk.id)
    eligible_set = set(eligible_ids)
    already = len(eligible_set & assigned)
    will_add = len(eligible_set - assigned)
    return ToolboxTalkBulkPreviewResponse(
        scope=scope.strip().lower(),
        total_eligible=len(eligible_set),
        already_assigned=already,
        will_add=will_add,
        ineligible=ineligible,
        site_id=site_id,
    )


def _attendee_row_to_schema(
    db: Session,
    row: ToolboxTalkAttendee,
    *,
    viewer: User,
    self_user_id: uuid.UUID | None,
) -> ToolboxTalkAttendeeResponse:
    u = get_user_by_id(db, row.user_id)
    email = u.email if u else None
    display = _display_name(db, row.user_id)
    is_self = viewer.id == row.user_id
    hide_peer_decline = viewer.system_role == SystemRole.EMPLOYEE and not is_self
    path = (row.signature_image_path or "").strip()
    has_sig = bool(path)
    method = row.signature_method
    if not method:
        if has_sig:
            method = "app_signature"
        elif row.status == "signed":
            method = "manual_paper"
        else:
            method = "not_signed"

    signature_image_available: bool | None = None
    signature_evidence_warning: str | None = None
    check_object = viewer.system_role != SystemRole.EMPLOYEE or is_self
    if check_object and method == "app_signature" and row.status == "signed":
        if not path:
            signature_image_available = False
            if viewer.system_role != SystemRole.EMPLOYEE:
                signature_evidence_warning = (
                    "Drawn signature image was not stored. Printed name and signed time remain on record; "
                    "do not treat PDF as containing a drawing."
                )
        else:
            try:
                signature_image_available = get_storage_backend().exists(path)
            except Exception:
                signature_image_available = False
            if signature_image_available is False and viewer.system_role != SystemRole.EMPLOYEE:
                signature_evidence_warning = (
                    "Drawn signature image is missing from private storage. "
                    "Printed name and signed time remain on record; PDF shows Signature unavailable. "
                    "Do not fabricate a replacement image."
                )

    can_see_signature = (
        check_object
        and method == "app_signature"
        and signature_image_available is True
    )
    return ToolboxTalkAttendeeResponse(
        user_id=row.user_id,
        user_email=email if is_self or viewer.system_role != SystemRole.EMPLOYEE else None,
        display_name=display,
        status=row.status,
        signed_at=row.signed_at,
        signature_name=row.signature_name if row.status == "signed" else None,
        signature_method=method,
        manual_signature_note=row.manual_signature_note if viewer.system_role != SystemRole.EMPLOYEE or is_self else None,
        has_signature=has_sig,
        signature_image_available=signature_image_available if check_object else None,
        signature_evidence_warning=signature_evidence_warning,
        signature_image_href=(
            f"/api/toolbox-talks/{row.talk_id}/attendees/{row.user_id}/signature"
            if can_see_signature
            else None
        ),
        declined_reason=None if hide_peer_decline else row.declined_reason,
    )


def _talk_to_summary(db: Session, row: ToolboxTalk) -> ToolboxTalkSummaryResponse:
    return ToolboxTalkSummaryResponse(
        id=row.id,
        company_id=row.company_id,
        location_id=row.location_id,
        title=row.title,
        topic=row.topic,
        topic_display=_topic_display(row.topic, row.topic_custom),
        scheduled_date=row.scheduled_date,
        status=row.status,
        published_at=row.published_at,
        completed_at=row.completed_at,
    )


def build_talk_detail(db: Session, actor: User, talk: ToolboxTalk) -> ToolboxTalkDetailResponse:
    attendees = tt_repo.list_attendees_for_talk(db, talk.id)
    attendee_schemas = [_attendee_row_to_schema(db, a, viewer=actor, self_user_id=actor.id) for a in attendees]
    return ToolboxTalkDetailResponse(
        id=talk.id,
        company_id=talk.company_id,
        location_id=talk.location_id,
        title=talk.title,
        topic=talk.topic,
        topic_display=_topic_display(talk.topic, talk.topic_custom),
        scheduled_date=talk.scheduled_date,
        status=talk.status,
        published_at=talk.published_at,
        completed_at=talk.completed_at,
        topic_custom=talk.topic_custom,
        topic_category=talk.topic_category,
        talk_body=talk.talk_body,
        presenter_user_id=talk.presenter_user_id,
        created_at=talk.created_at,
        updated_at=talk.updated_at,
        archived_at=talk.archived_at,
        voided_at=talk.voided_at,
        voided_by_user_id=talk.voided_by_user_id,
        void_reason=talk.void_reason,
        attendees=attendee_schemas,
    )


def get_talk_for_viewer(db: Session, actor: User, talk_id: uuid.UUID) -> ToolboxTalkDetailResponse:
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    if actor.system_role == SystemRole.EMPLOYEE:
        _ensure_company_user(actor)
        if talk.company_id != actor.company_id:
            raise ToolboxTalkNotFoundError()
        att = tt_repo.get_attendee(db, talk_id, actor.id)
        if att is None:
            raise ToolboxTalkNotFoundError()
        if talk.status not in EMPLOYEE_VISIBLE_TALK_STATUSES:
            raise ToolboxTalkNotFoundError()
        return build_talk_detail(db, actor, talk)
    if not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    return build_talk_detail(db, actor, talk)


def list_talks_admin(
    db: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    status: str | None,
    location_id: uuid.UUID | None,
    date_from: date | None,
    date_to: date | None,
) -> list[ToolboxTalkSummaryResponse]:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise ToolboxTalkPermissionError()
    scope_company: uuid.UUID | None
    if actor.system_role == SystemRole.ADMINISTRATOR:
        scope_company = company_id
    else:
        scope_company = _ensure_company_user(actor)
    rows = tt_repo.list_talks_for_admin(
        db,
        company_id=scope_company,
        status=status,
        location_id=location_id,
        date_from=date_from,
        date_to=date_to,
    )
    return [_talk_to_summary(db, r) for r in rows]


def list_talks_me(db: Session, actor: User) -> list[ToolboxTalkSummaryResponse]:
    if actor.system_role != SystemRole.EMPLOYEE:
        raise ToolboxTalkPermissionError()
    _ensure_company_user(actor)
    rows = tt_repo.list_talks_for_employee(db, actor.id)
    return [_talk_to_summary(db, r) for r in rows]


def create_talk(db: Session, actor: User, body: ToolboxTalkCreateRequest) -> ToolboxTalkDetailResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise ToolboxTalkPermissionError()
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if body.company_id is None:
            raise ToolboxTalkValidationError("company_id is required for administrators.")
        company_id = body.company_id
    else:
        company_id = _ensure_company_user(actor)

    if actor.system_role == SystemRole.ADMIN and actor.company_id != company_id:
        raise ToolboxTalkPermissionError()
    if not _can_admin_manage_company(actor, company_id):
        raise ToolboxTalkPermissionError()

    _validate_topic_fields(body.topic.strip(), body.topic_custom)
    _assert_location_for_company(db, company_id, body.location_id)
    if body.presenter_user_id is not None:
        pu = get_user_by_id(db, body.presenter_user_id)
        if pu is None or pu.company_id != company_id:
            raise ToolboxTalkValidationError("Presenter must belong to the same company.")

    now = _utc_now()
    row = ToolboxTalk(
        company_id=company_id,
        location_id=body.location_id,
        title=body.title.strip(),
        topic=body.topic.strip(),
        topic_category=body.topic_category.strip() if body.topic_category else None,
        topic_custom=body.topic_custom.strip() if body.topic_custom else None,
        talk_body=body.talk_body.strip(),
        presenter_user_id=body.presenter_user_id,
        scheduled_date=body.scheduled_date,
        status="draft",
        created_by_user_id=actor.id,
        created_at=now,
        updated_at=now,
        published_at=None,
        completed_at=None,
        archived_at=None,
    )
    tt_repo.save_talk(db, row)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="toolbox_talk.created",
        entity_type="toolbox_talk",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "talk_id": str(row.id),
            "company_id": str(row.company_id),
            "location_id": str(row.location_id) if row.location_id else None,
            "actor_user_id": str(actor.id),
            "status": row.status,
            "topic": row.topic,
        },
    )
    return build_talk_detail(db, actor, row)


def patch_talk(
    db: Session,
    actor: User,
    talk_id: uuid.UUID,
    body: ToolboxTalkPatchRequest,
) -> ToolboxTalkDetailResponse:
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    if not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    if talk.status != "draft":
        raise ToolboxTalkValidationError("Only draft talks can be edited.")

    raw = body.model_dump(exclude_unset=True)
    if "title" in raw:
        talk.title = raw["title"].strip()
    if "topic" in raw:
        talk.topic = raw["topic"].strip()
        if talk.topic != "custom":
            talk.topic_custom = None
    if "topic_custom" in raw and talk.topic == "custom":
        v = raw["topic_custom"]
        talk.topic_custom = v.strip() if isinstance(v, str) and v.strip() else None
    if "topic_category" in raw:
        v = raw["topic_category"]
        talk.topic_category = v.strip() if isinstance(v, str) and v.strip() else None
    if "talk_body" in raw:
        talk.talk_body = raw["talk_body"].strip()
    if "presenter_user_id" in raw:
        pid = raw["presenter_user_id"]
        if pid is None:
            talk.presenter_user_id = None
        else:
            pu = get_user_by_id(db, pid)
            if pu is None or pu.company_id != talk.company_id:
                raise ToolboxTalkValidationError("Presenter must belong to the same company.")
            talk.presenter_user_id = pid
    if "scheduled_date" in raw:
        talk.scheduled_date = raw["scheduled_date"]
    if "location_id" in raw:
        loc_id = raw["location_id"]
        _assert_location_for_company(db, talk.company_id, loc_id)
        talk.location_id = loc_id

    _validate_topic_fields(talk.topic, talk.topic_custom)

    talk.updated_at = _utc_now()
    tt_repo.save_talk(db, talk)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="toolbox_talk.updated",
        entity_type="toolbox_talk",
        entity_id=str(talk.id),
        company_id=talk.company_id,
        details={
            "talk_id": str(talk.id),
            "actor_user_id": str(actor.id),
            "status": talk.status,
            "topic": talk.topic,
        },
    )
    return build_talk_detail(db, actor, talk)


def _audit_talk_transition(
    db: Session,
    actor: User,
    talk: ToolboxTalk,
    action: str,
    *,
    attendee_count: int | None = None,
) -> None:
    details: dict = {
        "talk_id": str(talk.id),
        "company_id": str(talk.company_id),
        "location_id": str(talk.location_id) if talk.location_id else None,
        "actor_user_id": str(actor.id),
        "status": talk.status,
        "topic": talk.topic,
    }
    if attendee_count is not None:
        details["attendee_count"] = attendee_count
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action=action,
        entity_type="toolbox_talk",
        entity_id=str(talk.id),
        company_id=talk.company_id,
        details=details,
    )


def publish_talk(db: Session, actor: User, talk_id: uuid.UUID) -> ToolboxTalkDetailResponse:
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    if not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    if talk.status != "draft":
        raise ToolboxTalkValidationError("Only draft talks can be published.")
    if not talk.title.strip() or not talk.topic.strip() or not talk.talk_body.strip():
        raise ToolboxTalkValidationError("Title, topic, and talk body are required to publish.")
    _validate_topic_fields(talk.topic, talk.topic_custom)
    talk.status = "published"
    talk.published_at = _utc_now()
    talk.updated_at = _utc_now()
    tt_repo.save_talk(db, talk)
    for attendee in tt_repo.list_attendees_for_talk(db, talk.id):
        if attendee.status == "pending":
            record_toolbox_sign_required(
                db,
                company_id=talk.company_id,
                talk_id=talk.id,
                recipient_user_id=attendee.user_id,
            )
    _audit_talk_transition(db, actor, talk, "toolbox_talk.published")
    return build_talk_detail(db, actor, talk)


def complete_talk(db: Session, actor: User, talk_id: uuid.UUID) -> ToolboxTalkDetailResponse:
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    if not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    if talk.status not in ("published",):
        raise ToolboxTalkValidationError("Only published talks can be completed.")
    talk.status = "completed"
    talk.completed_at = _utc_now()
    talk.updated_at = _utc_now()
    tt_repo.save_talk(db, talk)
    _audit_talk_transition(
        db,
        actor,
        talk,
        "toolbox_talk.completed",
        attendee_count=tt_repo.count_attendees_for_talk(db, talk.id),
    )
    return build_talk_detail(db, actor, talk)


def archive_talk(db: Session, actor: User, talk_id: uuid.UUID) -> ToolboxTalkDetailResponse:
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    if not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    if talk.status == "archived":
        raise ToolboxTalkValidationError("This talk is already archived.")
    if talk.status == "voided":
        raise ToolboxTalkValidationError("Voided talks cannot be archived.")
    if talk.status not in ("published", "completed"):
        raise ToolboxTalkValidationError("Only published or completed talks can be archived.")
    talk.status = "archived"
    talk.archived_at = _utc_now()
    talk.updated_at = _utc_now()
    tt_repo.save_talk(db, talk)
    _audit_talk_transition(db, actor, talk, "toolbox_talk.archived")
    return build_talk_detail(db, actor, talk)


def void_talk(db: Session, actor: User, talk_id: uuid.UUID, body: ToolboxTalkVoidRequest) -> ToolboxTalkDetailResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise ToolboxTalkPermissionError()
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    if not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    if talk.status == "voided":
        raise ToolboxTalkValidationError("This talk is already voided.")
    if talk.status != "published":
        raise ToolboxTalkValidationError("Only published toolbox talks can be voided.")
    reason = (body.reason or "").strip()
    if not reason:
        raise ToolboxTalkValidationError("A void reason is required.")
    if len(reason) > 500:
        raise ToolboxTalkValidationError("Void reason is too long.")

    prior_status = talk.status
    signed_count = tt_repo.count_signed_attendees_for_talk(db, talk.id)
    declined_count = tt_repo.count_declined_attendees_for_talk(db, talk.id)
    attendee_count = tt_repo.count_attendees_for_talk(db, talk.id)
    now = _utc_now()
    talk.status = "voided"
    talk.voided_at = now
    talk.voided_by_user_id = actor.id
    talk.void_reason = reason
    talk.updated_at = now
    try:
        tt_repo.flush_talk(db, talk)
        create_internal_audit_event(
            db_session=db,
            actor=actor,
            action="toolbox_talk.voided",
            entity_type="toolbox_talk",
            entity_id=str(talk.id),
            company_id=talk.company_id,
            details={
                "talk_id": str(talk.id),
                "company_id": str(talk.company_id),
                "title": talk.title,
                "prior_status": prior_status,
                "attendee_count": attendee_count,
                "signed_count": signed_count,
                "declined_count": declined_count,
                "reason": reason,
                "actor_user_id": str(actor.id),
                "voided_at": now.isoformat(),
            },
        )
    except Exception:
        db.rollback()
        raise
    db.refresh(talk)
    return build_talk_detail(db, actor, talk)


def add_attendees(
    db: Session,
    actor: User,
    talk_id: uuid.UUID,
    body: ToolboxTalkAttendeesAddRequest,
) -> ToolboxTalkDetailResponse:
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    if not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    _assert_talk_allows_attendee_assignment(talk)

    user_ids: set[uuid.UUID] = set(body.user_ids)
    if body.all_site_users:
        if talk.location_id is None:
            raise ToolboxTalkValidationError("all_site_users requires the talk to have a location.")
        _assert_location_for_company(db, talk.company_id, talk.location_id)
        rows = list_site_access_for_location_ids(db, [talk.location_id])
        for r in rows:
            u = get_user_by_id(db, r.user_id)
            if _is_eligible_employee(u, talk.company_id):
                user_ids.add(r.user_id)

    now = _utc_now()
    added = 0
    try:
        for uid in user_ids:
            target = get_user_by_id(db, uid)
            if not _is_eligible_employee(target, talk.company_id):
                continue
            if tt_repo.get_attendee(db, talk_id, uid) is not None:
                continue
            att = ToolboxTalkAttendee(
                talk_id=talk_id,
                company_id=talk.company_id,
                user_id=uid,
                status="pending",
                signature_name=None,
                signature_method=None,
                manual_signature_note=None,
                signature_image_path=None,
                signed_at=None,
                declined_reason=None,
                created_at=now,
                updated_at=now,
            )
            tt_repo.flush_attendee(db, att)
            if talk.status == "published":
                record_toolbox_sign_required(
                    db,
                    company_id=talk.company_id,
                    talk_id=talk.id,
                    recipient_user_id=uid,
                )
            added += 1

        create_internal_audit_event(
            db_session=db,
            actor=actor,
            action="toolbox_talk.attendees_added",
            entity_type="toolbox_talk",
            entity_id=str(talk.id),
            company_id=talk.company_id,
            details={
                "talk_id": str(talk.id),
                "actor_user_id": str(actor.id),
                "attendee_count": added,
                "topic": talk.topic,
            },
        )
    except Exception:
        db.rollback()
        raise
    return build_talk_detail(db, actor, talk)


def preview_bulk_attendees(
    db: Session,
    actor: User,
    talk_id: uuid.UUID,
    *,
    scope: str,
) -> ToolboxTalkBulkPreviewResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise ToolboxTalkPermissionError()
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    if not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    _assert_talk_allows_attendee_assignment(talk)
    return _bulk_preview_counts(db, talk, scope=scope)


def bulk_add_attendees(
    db: Session,
    actor: User,
    talk_id: uuid.UUID,
    body: ToolboxTalkBulkAttendeesRequest,
) -> ToolboxTalkBulkAttendeesResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise ToolboxTalkPermissionError()
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    if not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    _assert_talk_allows_attendee_assignment(talk)

    scope = (body.scope or "").strip().lower()
    eligible_ids, ineligible, site_id = _resolve_bulk_eligible_ids(db, talk, scope=scope)
    assigned = tt_repo.list_assigned_user_ids_for_talk(db, talk.id)
    eligible_set = set(eligible_ids)
    skipped = len(eligible_set & assigned)
    to_add = sorted(eligible_set - assigned, key=lambda x: str(x))

    now = _utc_now()
    added = 0
    try:
        for uid in to_add:
            att = ToolboxTalkAttendee(
                talk_id=talk_id,
                company_id=talk.company_id,
                user_id=uid,
                status="pending",
                signature_name=None,
                signature_method=None,
                manual_signature_note=None,
                signature_image_path=None,
                signed_at=None,
                declined_reason=None,
                created_at=now,
                updated_at=now,
            )
            tt_repo.flush_attendee(db, att)
            if talk.status == "published":
                record_toolbox_sign_required(
                    db,
                    company_id=talk.company_id,
                    talk_id=talk.id,
                    recipient_user_id=uid,
                )
            added += 1

        create_internal_audit_event(
            db_session=db,
            actor=actor,
            action="toolbox_talk.attendees_bulk_added",
            entity_type="toolbox_talk",
            entity_id=str(talk.id),
            company_id=talk.company_id,
            details={
                "talk_id": str(talk.id),
                "company_id": str(talk.company_id),
                "scope": scope,
                "site_id": str(site_id) if site_id else None,
                "total_eligible": len(eligible_set),
                "added": added,
                "skipped_already_assigned": skipped,
                "ineligible": ineligible,
                "actor_user_id": str(actor.id),
            },
        )
    except Exception:
        db.rollback()
        raise

    return ToolboxTalkBulkAttendeesResponse(
        scope=scope,
        total_eligible=len(eligible_set),
        added=added,
        skipped_already_assigned=skipped,
        ineligible=ineligible,
        site_id=site_id,
    )


def remove_attendee(db: Session, actor: User, talk_id: uuid.UUID, user_id: uuid.UUID) -> ToolboxTalkDetailResponse:
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    if not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    _assert_talk_allows_pending_removal(talk)
    row = tt_repo.get_attendee(db, talk_id, user_id)
    if row is None:
        raise ToolboxTalkNotFoundError()
    if row.status != "pending":
        raise ToolboxTalkValidationError("Only pending attendees can be removed.")
    try:
        tt_repo.flush_delete_attendee(db, row)
        create_internal_audit_event(
            db_session=db,
            actor=actor,
            action="toolbox_talk.attendee_removed",
            entity_type="toolbox_talk",
            entity_id=str(talk.id),
            company_id=talk.company_id,
            details={"talk_id": str(talk.id), "subject_user_id": str(user_id), "actor_user_id": str(actor.id)},
        )
    except Exception:
        db.rollback()
        raise
    return build_talk_detail(db, actor, talk)


def sign_talk(db: Session, actor: User, talk_id: uuid.UUID, body: ToolboxTalkSignRequest) -> ToolboxTalkDetailResponse:
    if actor.system_role != SystemRole.EMPLOYEE:
        raise ToolboxTalkPermissionError()
    company_id = _ensure_company_user(actor)
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None or talk.company_id != company_id:
        raise ToolboxTalkNotFoundError()
    if talk.status in ("archived", "voided", "completed"):
        raise ToolboxTalkValidationError(f"This talk is {talk.status} and cannot be signed.")
    if talk.status not in ("published",):
        raise ToolboxTalkValidationError("This talk is not open for signing.")
    att = tt_repo.get_attendee(db, talk_id, actor.id)
    if att is None:
        raise ToolboxTalkNotFoundError()
    if att.status == "signed":
        raise ToolboxTalkValidationError("You have already signed this talk.")
    if att.status != "pending":
        raise ToolboxTalkValidationError("You cannot sign this talk in its current state.")
    if not body.attended_ack:
        raise ToolboxTalkValidationError("You must confirm you have attended and understood this talk.")
    name = body.signature_name.strip()
    if not (body.signature_image_data or "").strip():
        raise ToolboxTalkValidationError("A drawn signature image is required.")
    try:
        png = decode_png_data_url(body.signature_image_data)
    except SignatureDataUrlError as exc:
        raise ToolboxTalkValidationError(str(exc)) from exc

    rel = f"toolbox-talk-signatures/{talk.company_id}/{talk_id}/{actor.id}/signature-{uuid.uuid4().hex}.png"
    backend = get_storage_backend()
    previous_path = (att.signature_image_path or "").strip() or None

    try:
        backend.write_bytes(rel, png)
        if not backend.exists(rel):
            raise ToolboxTalkValidationError(
                "Could not store your signature image. Please try again.",
            )
        stored = backend.read_bytes(rel)
        _validate_stored_signature_png(stored)
    except ToolboxTalkValidationError:
        try:
            backend.delete_file(rel)
        except Exception:
            pass
        raise
    except Exception as exc:
        try:
            backend.delete_file(rel)
        except Exception:
            pass
        logger.warning(
            "toolbox talk signature storage write failed talk_id=%s attendee_id=%s",
            talk_id,
            att.id,
            exc_info=False,
        )
        raise ToolboxTalkValidationError(
            "Could not store your signature image. Please try again.",
        ) from exc

    att.status = "signed"
    att.signature_name = name
    att.signature_method = "app_signature"
    att.manual_signature_note = None
    att.signature_image_path = rel
    att.signed_at = _utc_now()
    att.updated_at = _utc_now()
    att.declined_reason = None
    try:
        tt_repo.save_attendee(db, att)
        create_internal_audit_event(
            db_session=db,
            actor=actor,
            action="toolbox_talk.signed",
            entity_type="toolbox_talk_attendee",
            entity_id=str(att.id),
            company_id=talk.company_id,
            details={
                "talk_id": str(talk.id),
                "actor_user_id": str(actor.id),
                "status": att.status,
                "topic": talk.topic,
                "signature_method": "app_signature",
                "has_signature_image": True,
            },
        )
    except Exception:
        db.rollback()
        try:
            backend.delete_file(rel)
        except Exception:
            pass
        # Preserve pending state; printed name was never committed as signed evidence.
        raise

    if previous_path and previous_path != rel:
        try:
            backend.delete_file(previous_path)
        except Exception:
            pass
    return build_talk_detail(db, actor, talk)


def decline_talk(db: Session, actor: User, talk_id: uuid.UUID, body: ToolboxTalkDeclineRequest) -> ToolboxTalkDetailResponse:
    if actor.system_role != SystemRole.EMPLOYEE:
        raise ToolboxTalkPermissionError()
    company_id = _ensure_company_user(actor)
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None or talk.company_id != company_id:
        raise ToolboxTalkNotFoundError()
    if talk.status in ("archived", "voided", "completed"):
        raise ToolboxTalkValidationError(f"This talk is {talk.status}.")
    if talk.status not in ("published",):
        raise ToolboxTalkValidationError("This talk is not open for responses.")
    att = tt_repo.get_attendee(db, talk_id, actor.id)
    if att is None:
        raise ToolboxTalkNotFoundError()
    if att.status != "pending":
        raise ToolboxTalkValidationError("You have already responded to this talk.")
    reason = body.reason.strip()
    att.status = "declined"
    att.declined_reason = reason
    att.signature_method = None
    att.manual_signature_note = None
    att.updated_at = _utc_now()
    if att.signature_image_path:
        try:
            get_storage_backend().delete_file(att.signature_image_path)
        except Exception:
            pass
    att.signature_image_path = None
    att.signature_name = None
    att.signed_at = None
    tt_repo.save_attendee(db, att)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="toolbox_talk.declined",
        entity_type="toolbox_talk_attendee",
        entity_id=str(att.id),
        company_id=talk.company_id,
        details={"talk_id": str(talk.id), "actor_user_id": str(actor.id), "status": att.status, "topic": talk.topic},
    )
    return build_talk_detail(db, actor, talk)


def manual_sign_attendee(
    db: Session,
    actor: User,
    talk_id: uuid.UUID,
    user_id: uuid.UUID,
    body: ToolboxTalkManualSignRequest,
) -> ToolboxTalkDetailResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise ToolboxTalkPermissionError()
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    if not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    if talk.status in ("archived", "voided", "completed"):
        raise ToolboxTalkValidationError(f"This talk is {talk.status}.")
    att = tt_repo.get_attendee(db, talk_id, user_id)
    if att is None:
        raise ToolboxTalkNotFoundError()
    if att.company_id != talk.company_id:
        raise ToolboxTalkNotFoundError()
    if att.signature_image_path:
        try:
            get_storage_backend().delete_file(att.signature_image_path)
        except Exception:
            pass
    att.status = "signed"
    att.signature_name = body.signature_name.strip()
    att.signature_method = "manual_paper"
    att.manual_signature_note = body.manual_signature_note.strip() if body.manual_signature_note else "Signed on paper"
    att.signature_image_path = None
    att.signed_at = _utc_now()
    att.declined_reason = None
    att.updated_at = _utc_now()
    tt_repo.save_attendee(db, att)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="toolbox_talk.manual_signature_recorded",
        entity_type="toolbox_talk_attendee",
        entity_id=str(att.id),
        company_id=talk.company_id,
        details={
            "talk_id": str(talk.id),
            "subject_user_id": str(user_id),
            "actor_user_id": str(actor.id),
            "signature_method": att.signature_method,
        },
    )
    return build_talk_detail(db, actor, talk)


def _validate_stored_signature_png(data: bytes) -> None:
    if not data or not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ToolboxTalkValidationError("Stored signature image is not a valid PNG.")
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as im:
            im.verify()
    except ToolboxTalkValidationError:
        raise
    except Exception as exc:
        raise ToolboxTalkValidationError("Stored signature image is corrupt.") from exc


def _company_timezone_name(db: Session, company_id: uuid.UUID) -> str:
    policy = get_company_time_policy(db, company_id)
    return resolve_company_timezone_name(policy.timezone_name if policy else None)


def _read_attendee_signature_png(attendee: ToolboxTalkAttendee) -> tuple[bytes | None, str]:
    """
    Load signature PNG for PDF/print.

    Returns (bytes|None, reason) where reason is one of:
    ok | missing_path | missing_object | corrupt | unsupported_method
    """
    method = (attendee.signature_method or "").strip()
    path = (attendee.signature_image_path or "").strip()
    if not method:
        if path:
            method = "app_signature"
        elif attendee.status == "signed":
            method = "manual_paper"
        else:
            method = "not_signed"

    if method != "app_signature":
        return None, "unsupported_method"
    if not path:
        return None, "missing_path"

    backend = get_storage_backend()
    try:
        if not backend.exists(path):
            logger.warning(
                "toolbox talk signature object missing attendee_id=%s talk_id=%s reason=missing_object",
                attendee.id,
                attendee.talk_id,
            )
            return None, "missing_object"
        raw = backend.read_bytes(path)
    except Exception:
        logger.warning(
            "toolbox talk signature image load failed attendee_id=%s talk_id=%s reason=missing_object",
            attendee.id,
            attendee.talk_id,
            exc_info=False,
        )
        return None, "missing_object"

    try:
        _validate_stored_signature_png(raw)
    except Exception:
        logger.warning(
            "toolbox talk signature image corrupt attendee_id=%s talk_id=%s reason=corrupt",
            attendee.id,
            attendee.talk_id,
            exc_info=False,
        )
        return None, "corrupt"
    return raw, "ok"


def _signature_cell_for_export(
    attendee: ToolboxTalkAttendee,
    *,
    image_bytes: bytes | None,
    load_reason: str,
) -> tuple[bytes | None, str | None]:
    """Return (png_bytes, fallback_text). Never returns a storage path."""
    method = (attendee.signature_method or "").strip()
    if not method:
        if (attendee.signature_image_path or "").strip():
            method = "app_signature"
        elif attendee.status == "signed":
            method = "manual_paper"
        else:
            method = "not_signed"

    if image_bytes and load_reason == "ok":
        return image_bytes, None

    if method == "app_signature":
        # Drawn workflow requires an image; never claim "Signed in app" without one.
        return None, "Signature unavailable"

    if method == "manual_paper":
        name = (attendee.signature_name or "").strip()
        if name:
            return None, name
        return None, "Manual/paper signed"

    if attendee.status == "signed":
        name = (attendee.signature_name or "").strip()
        return None, name or "Signed electronically"

    return None, "—"


def _attendee_note_for_export(attendee: ToolboxTalkAttendee) -> str | None:
    note = (attendee.declined_reason or attendee.manual_signature_note or "").strip()
    return note or None


def _build_export_attendee_rows(
    db: Session,
    actor: User,
    talk_id: uuid.UUID,
    *,
    timezone_name: str,
    include_peer_signatures: bool,
) -> list[ToolboxTalkAttendeePdfRow]:
    rows: list[ToolboxTalkAttendeePdfRow] = []
    for att in tt_repo.list_attendees_for_talk(db, talk_id):
        u = get_user_by_id(db, att.user_id)
        email = u.email if u else ""
        display = _display_name(db, att.user_id) or ""
        is_self = actor.id == att.user_id
        hide_peer = actor.system_role == SystemRole.EMPLOYEE and not is_self

        if hide_peer:
            rows.append(
                ToolboxTalkAttendeePdfRow(
                    employee=(display or "Employee")[:160],
                    status=att.status,
                    signed_date=format_signed_date_in_timezone(att.signed_at, timezone_name),
                    printed_name="—",
                    signature_image=None,
                    signature_text="—",
                    note=None,
                ),
            )
            continue

        name_cell = f"{display} ({email})".strip() if email else (display or email or "Employee")
        printed = (att.signature_name or "—") if att.status == "signed" else "—"
        note = _attendee_note_for_export(att)

        can_load_image = include_peer_signatures or is_self or actor.system_role != SystemRole.EMPLOYEE
        sig_img: bytes | None = None
        load_reason = "unsupported_method"
        if can_load_image:
            sig_img, load_reason = _read_attendee_signature_png(att)
        else:
            load_reason = "missing_path"
        sig_img, sig_text = _signature_cell_for_export(att, image_bytes=sig_img, load_reason=load_reason)

        rows.append(
            ToolboxTalkAttendeePdfRow(
                employee=name_cell[:160],
                status=att.status,
                signed_date=format_signed_date_in_timezone(att.signed_at, timezone_name),
                printed_name=(printed or "—")[:120],
                signature_image=sig_img,
                signature_text=sig_text,
                note=note,
            ),
        )
    return rows


def render_print_html(db: Session, actor: User, talk_id: uuid.UUID) -> str:
    detail = get_talk_for_viewer(db, actor, talk_id)
    tz_name = _company_timezone_name(db, detail.company_id)

    company = get_company_by_id(db, detail.company_id)
    company_name = html.escape(company.name if company else "Company")
    loc_name = "No specific site"
    if detail.location_id:
        loc = get_location_by_id(db, detail.location_id)
        if loc and loc.name:
            loc_name = loc.name
    loc_name_esc = html.escape(loc_name)

    presenter_display = "Not specified"
    if detail.presenter_user_id:
        presenter_display = _display_name(db, detail.presenter_user_id) or presenter_display
        if presenter_display == "Not specified":
            pu = get_user_by_id(db, detail.presenter_user_id)
            if pu and pu.email:
                presenter_display = pu.email
    presenter_esc = html.escape(presenter_display)

    title = html.escape(detail.title)
    topic = html.escape(detail.topic_display)
    scheduled_label = (
        format_display_date(detail.scheduled_date) if detail.scheduled_date else "Not scheduled"
    )
    published_label = (
        format_signed_date_in_timezone(detail.published_at, tz_name) if detail.published_at else None
    )
    status_label = (detail.status or "—")
    if status_label and status_label[0].islower():
        status_label = status_label[:1].upper() + status_label[1:]

    # Compact body: preserve section breaks
    body_parts: list[str] = []
    for block in (detail.talk_body or "").split("\n\n"):
        block = block.strip()
        if not block:
            continue
        lines = block.splitlines()
        if len(lines) >= 1:
            first = html.escape(lines[0].strip())
            rest = "<br/>".join(html.escape(ln) for ln in lines[1:])
            if rest:
                body_parts.append(f'<div class="tt-sec"><div class="tt-sec-h">{first}</div><div>{rest}</div></div>')
            else:
                body_parts.append(f'<div class="tt-sec"><div>{first}</div></div>')
    body_html = "".join(body_parts) or f'<div class="tt-sec">{html.escape(detail.talk_body or "—").replace(chr(10), "<br/>")}</div>'

    attendee_rows = _build_export_attendee_rows(
        db,
        actor,
        talk_id,
        timezone_name=tz_name,
        include_peer_signatures=actor.system_role != SystemRole.EMPLOYEE,
    )
    include_notes = any((r.note or "").strip() for r in attendee_rows)
    rows_html: list[str] = []
    for r in attendee_rows:
        if r.signature_image:
            b64 = base64.b64encode(r.signature_image).decode("ascii")
            sig_html = (
                f'<img class="tt-sig" alt="Signature" '
                f'src="data:image/png;base64,{b64}"/>'
            )
        else:
            sig_html = html.escape(r.signature_text or "—")
        cells = [
            html.escape(r.employee),
            html.escape(r.status),
            html.escape(r.signed_date),
            html.escape(r.printed_name or "—"),
            sig_html,
        ]
        if include_notes:
            cells.append(html.escape(r.note or "—"))
        rows_html.append("<tr>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>")

    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="toolbox_talk.exported",
        entity_type="toolbox_talk",
        entity_id=str(talk_id),
        company_id=detail.company_id,
        details={"talk_id": str(talk_id), "actor_user_id": str(actor.id), "export_type": "print_html"},
    )
    gen = html.escape(format_display_date(datetime.now(timezone.utc)))
    published_meta = (
        f'<p class="tt-meta"><strong>Published:</strong> {html.escape(published_label)}</p>'
        if published_label
        else ""
    )
    hdr_cols = ["Employee", "Status", "Signed date", "Printed name", "Signature"]
    if include_notes:
        hdr_cols.append("Notes")
    hdr = "".join(f"<th>{h}</th>" for h in hdr_cols)
    record_ref = html.escape(str(detail.id))

    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Toolbox talk — {title}</title>
<style>
body {{ margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #111827; background: #fff; }}
.tt-pack {{ max-width: 900px; margin: 0 auto; padding: 14px 16px; }}
.tt-company {{ font-size: 20px; font-weight: 700; margin: 0 0 2px; }}
.tt-doc-title {{ font-size: 15px; font-weight: 700; margin: 0 0 8px; }}
.tt-meta {{ font-size: 12px; color: #1f2937; margin: 2px 0; }}
.tt-ref {{ font-size: 10px; color: #6b7280; margin: 4px 0 10px; }}
.tt-sec {{ margin: 6px 0; font-size: 12px; line-height: 1.35; }}
.tt-sec-h {{ font-weight: 700; font-size: 12.5px; margin-bottom: 2px; }}
.tt-table {{ border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 11px; }}
.tt-table th, .tt-table td {{ border: 1px solid #d1d5db; padding: 4px 5px; vertical-align: middle; text-align: left; }}
.tt-table th {{ background: #f3f4f6; font-weight: 600; }}
.tt-table thead {{ display: table-header-group; }}
.tt-sig {{ max-width: 120px; max-height: 42px; width: auto; height: auto; object-fit: contain; background: #fff; display: block; margin: 0 auto; }}
.tt-footer {{ font-size: 10px; color: #6b7280; text-align: center; margin-top: 14px; }}
.no-print {{ display: none !important; }}
@media print {{
  body {{ background: #fff; }}
  .tt-pack {{ max-width: none; padding: 0; }}
  .no-print, button, .tt-actions {{ display: none !important; }}
}}
</style></head><body><div class="tt-pack">
<p class="tt-company">{company_name}</p>
<p class="tt-doc-title">Toolbox Talk Record</p>
<p class="tt-meta"><strong>Title:</strong> {title}</p>
<p class="tt-meta"><strong>Topic:</strong> {topic}</p>
<p class="tt-meta"><strong>Site:</strong> {loc_name_esc}</p>
<p class="tt-meta"><strong>Presenter:</strong> {presenter_esc}</p>
<p class="tt-meta"><strong>Scheduled:</strong> {html.escape(scheduled_label)}</p>
<p class="tt-meta"><strong>Status:</strong> {html.escape(status_label)}</p>
{published_meta}
<p class="tt-ref">Record reference: {record_ref}</p>
{body_html}
<h2 style="font-size:13px;margin:12px 0 4px;">Attendee sign-off register</h2>
<table class="tt-table"><thead><tr>{hdr}</tr></thead><tbody>{"".join(rows_html)}</tbody></table>
<p class="tt-footer">Generated {gen} · TimIQ</p>
</div></body></html>"""


def export_csv_bytes(db: Session, actor: User, talk_id: uuid.UUID) -> tuple[bytes, str]:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise ToolboxTalkPermissionError()
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    if not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    detail = build_talk_detail(db, actor, talk)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "talk_title",
            "topic",
            "location",
            "scheduled_date",
            "talk_status",
            "employee_email",
            "employee_name",
            "attendee_status",
            "signed_at",
            "signature_name",
            "declined_reason",
        ],
    )
    loc_name = ""
    if detail.location_id:
        loc = get_location_by_id(db, detail.location_id)
        loc_name = loc.name if loc else ""
    for a in detail.attendees:
        u = get_user_by_id(db, a.user_id)
        w.writerow(
            [
                detail.title,
                detail.topic_display,
                loc_name,
                detail.scheduled_date.isoformat() if detail.scheduled_date else "",
                detail.status,
                u.email if u else "",
                a.display_name or "",
                a.status,
                a.signed_at.isoformat() if a.signed_at else "",
                a.signature_name or "",
                a.declined_reason or "",
            ],
        )
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="toolbox_talk.exported",
        entity_type="toolbox_talk",
        entity_id=str(talk_id),
        company_id=talk.company_id,
        details={"talk_id": str(talk_id), "actor_user_id": str(actor.id), "export_type": "csv"},
    )
    return buf.getvalue().encode("utf-8"), f"toolbox-talk-{talk_id}.csv"


def delete_talk_hard(db: Session, actor: User, talk_id: uuid.UUID) -> None:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise ToolboxTalkPermissionError()
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    if not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    if talk.status != "draft":
        raise ToolboxTalkValidationError(
            "Only draft toolbox talks can be deleted. Void published talks or archive completed records instead.",
        )
    if tt_repo.count_evidence_attendees_for_talk(db, talk_id) > 0:
        raise ToolboxTalkValidationError(
            "This record has compliance sign-offs or declines. It cannot be permanently deleted.",
        )
    pending_count = tt_repo.count_pending_attendees_for_talk(db, talk_id)
    for a in tt_repo.list_attendees_for_talk(db, talk_id):
        if a.signature_image_path:
            try:
                get_storage_backend().delete_file(a.signature_image_path)
            except Exception:
                pass
    cid = talk.company_id
    title = talk.title
    prior_status = talk.status
    try:
        tt_repo.flush_delete_talk(db, talk)
        create_internal_audit_event(
            db_session=db,
            actor=actor,
            action="toolbox_talk.deleted",
            entity_type="toolbox_talk",
            entity_id=str(talk_id),
            company_id=cid,
            details={
                "talk_id": str(talk_id),
                "company_id": str(cid),
                "title": title,
                "prior_status": prior_status,
                "pending_attendee_count": pending_count,
                "actor_user_id": str(actor.id),
            },
        )
    except Exception:
        db.rollback()
        raise


def download_attendee_signature_png(
    db: Session,
    actor: User,
    talk_id: uuid.UUID,
    user_id: uuid.UUID,
) -> tuple[bytes, str]:
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    # Reuse viewer access gate via get_talk_for_viewer.
    get_talk_for_viewer(db, actor, talk_id)
    is_self = actor.id == user_id
    if actor.system_role == SystemRole.EMPLOYEE:
        if not is_self:
            raise ToolboxTalkPermissionError()
    elif not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    att = tt_repo.get_attendee(db, talk_id, user_id)
    if att is None:
        raise ToolboxTalkNotFoundError()
    raw, reason = _read_attendee_signature_png(att)
    if raw is None or reason != "ok":
        raise ToolboxTalkNotFoundError()
    return raw, f"toolbox-talk-signature-{user_id}.png"


def export_talk_pdf_bytes(db: Session, actor: User, talk_id: uuid.UUID) -> tuple[bytes, str]:
    detail = get_talk_for_viewer(db, actor, talk_id)
    tz_name = _company_timezone_name(db, detail.company_id)
    company = get_company_by_id(db, detail.company_id)
    company_name = company.name if company else "Company"
    loc_name = None
    if detail.location_id:
        loc = get_location_by_id(db, detail.location_id)
        loc_name = loc.name if loc else None
    presenter_display: str | None = None
    if detail.presenter_user_id:
        presenter_display = _display_name(db, detail.presenter_user_id)
        if not presenter_display:
            pu = get_user_by_id(db, detail.presenter_user_id)
            presenter_display = pu.email if pu else None

    scheduled_label = format_display_date(detail.scheduled_date) if detail.scheduled_date else None
    published_label = (
        format_signed_date_in_timezone(detail.published_at, tz_name) if detail.published_at else None
    )
    rows = _build_export_attendee_rows(
        db,
        actor,
        talk_id,
        timezone_name=tz_name,
        include_peer_signatures=actor.system_role != SystemRole.EMPLOYEE,
    )
    from app.modules.toolbox_talks.pdf_export import build_toolbox_talk_pdf

    pdf = build_toolbox_talk_pdf(
        company_name=company_name,
        title=detail.title,
        topic_display=detail.topic_display,
        location_name=loc_name,
        scheduled=scheduled_label,
        talk_status=detail.status,
        presenter_display=presenter_display,
        talk_body=detail.talk_body,
        key_points=[],
        do_list=[],
        dont_list=[],
        ppe_reminders=[],
        attendees_rows=rows,
        published_display=published_label,
        record_ref=str(detail.id),
        generated_display=format_display_date(datetime.now(timezone.utc)),
        timezone_name=tz_name,
    )
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="toolbox_talk.exported",
        entity_type="toolbox_talk",
        entity_id=str(talk_id),
        company_id=detail.company_id,
        details={"talk_id": str(talk_id), "actor_user_id": str(actor.id), "export_type": "pdf"},
    )
    return pdf, f"toolbox-talk-{talk_id}.pdf"
