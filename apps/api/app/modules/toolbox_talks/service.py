from __future__ import annotations

import csv
import html
import io
import uuid
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.companies.repository import get_company_by_id
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.locations.repository import get_location_by_id
from app.modules.site_access.repository import list_site_access_for_location_ids
from app.modules.toolbox_talks import repository as tt_repo
from app.modules.toolbox_talks.constants import is_known_topic, topic_label
from app.modules.toolbox_talks.models import ToolboxTalk, ToolboxTalkAttendee
from app.modules.toolbox_talks.schemas import (
    ToolboxTalkAttendeeResponse,
    ToolboxTalkAttendeesAddRequest,
    ToolboxTalkCreateRequest,
    ToolboxTalkDeclineRequest,
    ToolboxTalkDetailResponse,
    ToolboxTalkPatchRequest,
    ToolboxTalkSignRequest,
    ToolboxTalkSummaryResponse,
    ToolboxTopicOption,
)


class ToolboxTalkError(Exception):
    pass


class ToolboxTalkNotFoundError(ToolboxTalkError):
    pass


class ToolboxTalkPermissionError(ToolboxTalkError):
    pass


class ToolboxTalkValidationError(ToolboxTalkError):
    pass


ALLOWED_TALK_STATUS = frozenset({"draft", "published", "completed", "archived"})
ALLOWED_ATTENDEE_STATUS = frozenset({"pending", "signed", "declined", "absent"})


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def list_topic_options() -> list[ToolboxTopicOption]:
    from app.modules.toolbox_talks.constants import TOOLBOX_TOPIC_VALUES

    return [ToolboxTopicOption(value=v, label=topic_label(v)) for v in TOOLBOX_TOPIC_VALUES]


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
    has_sig = bool((row.signature_name or "").strip() or (row.signature_image_path or "").strip())
    return ToolboxTalkAttendeeResponse(
        user_id=row.user_id,
        user_email=email if is_self or viewer.system_role != SystemRole.EMPLOYEE else None,
        display_name=display,
        status=row.status,
        signed_at=row.signed_at,
        signature_name=row.signature_name if row.status == "signed" else None,
        has_signature=has_sig,
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
        if talk.status not in ("published", "completed", "archived"):
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
    talk.status = "archived"
    talk.archived_at = _utc_now()
    talk.updated_at = _utc_now()
    tt_repo.save_talk(db, talk)
    _audit_talk_transition(db, actor, talk, "toolbox_talk.archived")
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
    if talk.status == "archived":
        raise ToolboxTalkValidationError("Cannot modify attendees on an archived talk.")

    user_ids: set[uuid.UUID] = set(body.user_ids)
    if body.all_site_users:
        if talk.location_id is None:
            raise ToolboxTalkValidationError("all_site_users requires the talk to have a location.")
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
        if tt_repo.get_attendee(db, talk_id, uid) is not None:
            continue
        att = ToolboxTalkAttendee(
            talk_id=talk_id,
            company_id=talk.company_id,
            user_id=uid,
            status="pending",
            signature_name=None,
            signature_image_path=None,
            signed_at=None,
            declined_reason=None,
            created_at=now,
            updated_at=now,
        )
        tt_repo.save_attendee(db, att)
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
    return build_talk_detail(db, actor, talk)


def remove_attendee(db: Session, actor: User, talk_id: uuid.UUID, user_id: uuid.UUID) -> ToolboxTalkDetailResponse:
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None:
        raise ToolboxTalkNotFoundError()
    if not _can_admin_manage_company(actor, talk.company_id):
        raise ToolboxTalkNotFoundError()
    row = tt_repo.get_attendee(db, talk_id, user_id)
    if row is None:
        raise ToolboxTalkNotFoundError()
    if row.status != "pending":
        raise ToolboxTalkValidationError("Only pending attendees can be removed.")
    tt_repo.delete_attendee(db, row)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="toolbox_talk.attendee_removed",
        entity_type="toolbox_talk",
        entity_id=str(talk.id),
        company_id=talk.company_id,
        details={"talk_id": str(talk.id), "subject_user_id": str(user_id), "actor_user_id": str(actor.id)},
    )
    return build_talk_detail(db, actor, talk)


def sign_talk(db: Session, actor: User, talk_id: uuid.UUID, body: ToolboxTalkSignRequest) -> ToolboxTalkDetailResponse:
    if actor.system_role != SystemRole.EMPLOYEE:
        raise ToolboxTalkPermissionError()
    company_id = _ensure_company_user(actor)
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None or talk.company_id != company_id:
        raise ToolboxTalkNotFoundError()
    if talk.status == "archived":
        raise ToolboxTalkValidationError("This talk is archived and cannot be signed.")
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
    att.status = "signed"
    att.signature_name = name
    att.signed_at = _utc_now()
    att.updated_at = _utc_now()
    att.declined_reason = None
    tt_repo.save_attendee(db, att)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="toolbox_talk.signed",
        entity_type="toolbox_talk_attendee",
        entity_id=str(att.id),
        company_id=talk.company_id,
        details={"talk_id": str(talk.id), "actor_user_id": str(actor.id), "status": att.status, "topic": talk.topic},
    )
    return build_talk_detail(db, actor, talk)


def decline_talk(db: Session, actor: User, talk_id: uuid.UUID, body: ToolboxTalkDeclineRequest) -> ToolboxTalkDetailResponse:
    if actor.system_role != SystemRole.EMPLOYEE:
        raise ToolboxTalkPermissionError()
    company_id = _ensure_company_user(actor)
    talk = tt_repo.get_talk(db, talk_id)
    if talk is None or talk.company_id != company_id:
        raise ToolboxTalkNotFoundError()
    if talk.status == "archived":
        raise ToolboxTalkValidationError("This talk is archived.")
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
    att.updated_at = _utc_now()
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


def render_print_html(db: Session, actor: User, talk_id: uuid.UUID) -> str:
    detail = get_talk_for_viewer(db, actor, talk_id)

    company = get_company_by_id(db, detail.company_id)
    company_name = html.escape(company.name if company else "Company")
    loc_name = "—"
    if detail.location_id:
        loc = get_location_by_id(db, detail.location_id)
        if loc:
            loc_name = html.escape(loc.name)
    title = html.escape(detail.title)
    topic = html.escape(detail.topic_display)
    body_html = html.escape(detail.talk_body).replace("\n", "<br/>")

    rows_html = []
    for a in detail.attendees:
        if actor.system_role == SystemRole.EMPLOYEE and a.user_id != actor.id:
            rows_html.append(
                "<tr>"
                f"<td>{html.escape(a.display_name or 'Employee')}</td>"
                f"<td>{html.escape(a.status)}</td>"
                f"<td>{html.escape(a.signed_at.isoformat() if a.signed_at else '—')}</td>"
                f"<td>{html.escape(a.signature_name or ('Yes' if a.has_signature else '—'))}</td>"
                "<td>—</td>"
                "</tr>",
            )
        else:
            rows_html.append(
                "<tr>"
                f"<td>{html.escape(a.display_name or '')} ({html.escape(a.user_email or '')})</td>"
                f"<td>{html.escape(a.status)}</td>"
                f"<td>{html.escape(a.signed_at.isoformat() if a.signed_at else '—')}</td>"
                f"<td>{html.escape(a.signature_name or ('Yes' if a.has_signature else '—'))}</td>"
                f"<td>{html.escape(a.declined_reason or '—')}</td>"
                "</tr>",
            )

    hdr = (
        "<tr><th>Employee</th><th>Status</th><th>Signed at</th><th>Signature name</th><th>Declined reason</th></tr>"
    )
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="toolbox_talk.exported",
        entity_type="toolbox_talk",
        entity_id=str(talk_id),
        company_id=detail.company_id,
        details={"talk_id": str(talk_id), "actor_user_id": str(actor.id), "export_type": "print_html"},
    )
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Toolbox talk — {title}</title>
<style>
body {{ font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; color: #222; }}
h1 {{ font-size: 22px; }}
table {{ border-collapse: collapse; width: 100%; margin-top: 16px; }}
th, td {{ border: 1px solid #ccc; padding: 8px; text-align: left; font-size: 13px; }}
th {{ background: #f5f5f5; }}
.meta {{ font-size: 14px; color: #444; }}
.body {{ margin-top: 20px; line-height: 1.5; }}
@media print {{ body {{ margin: 12px; }} }}
</style></head><body>
<h1>Toolbox talk record</h1>
<p class="meta"><strong>Company:</strong> {company_name}</p>
<p class="meta"><strong>Title:</strong> {title}</p>
<p class="meta"><strong>Topic:</strong> {topic}</p>
<p class="meta"><strong>Location:</strong> {loc_name}</p>
<p class="meta"><strong>Scheduled:</strong> {html.escape(str(detail.scheduled_date) if detail.scheduled_date else '—')}</p>
<p class="meta"><strong>Status:</strong> {html.escape(detail.status)}</p>
<div class="body"><strong>Talk content</strong><br/>{body_html}</div>
<h2 style="margin-top:24px;font-size:16px;">Attendees</h2>
<table><thead>{hdr}</thead><tbody>{"".join(rows_html)}</tbody></table>
<p style="margin-top:16px;font-size:12px;color:#666;">Use your browser&rsquo;s Print dialog to print or save as PDF.</p>
</body></html>"""


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
