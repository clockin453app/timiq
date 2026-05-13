import uuid
from datetime import datetime, time, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.modules.audit.models import AuditEvent
from app.modules.audit.repository import list_audit_events_filtered, save_audit_event
from app.modules.audit.sanitize import audit_details_summary, sanitize_audit_details
from app.modules.audit.schemas import AuditEventListItem, AuditEventListResponse
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.companies.repository import get_company_by_id
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id


class AuditPermissionError(ValueError):
    pass


def _display_for_user(db_session: Session, user_id: uuid.UUID) -> tuple[str | None, str | None]:
    user = get_user_by_id(db_session, user_id)
    if user is None:
        return None, None
    profile = get_employee_profile_by_user_id(db_session, user_id)
    if profile is None:
        return user.email, user.email
    first = (profile.first_name or "").strip()
    last = (profile.last_name or "").strip()
    name = f"{first} {last}".strip() if first or last else None
    return user.email, name or user.email


def _subject_uuid_from_details(details: dict[str, Any]) -> uuid.UUID | None:
    for k in ("owner_user_id", "subject_user_id", "user_id"):
        v = details.get(k)
        if isinstance(v, str) and v.strip():
            try:
                return uuid.UUID(v.strip())
            except ValueError:
                continue
    return None


def _to_audit_list_item(db_session: Session, ev: AuditEvent) -> AuditEventListItem:
    raw_details = ev.details if isinstance(ev.details, dict) else {}
    safe_details = sanitize_audit_details(raw_details)
    summary = audit_details_summary(raw_details)

    actor_email = actor_display = None
    if ev.actor_user_id is not None:
        actor_email, actor_display = _display_for_user(db_session, ev.actor_user_id)

    sub_id = _subject_uuid_from_details(raw_details)
    subject_email = subject_display = None
    if sub_id is not None:
        subject_email, subject_display = _display_for_user(db_session, sub_id)

    company_name = None
    if ev.company_id is not None:
        co = get_company_by_id(db_session, ev.company_id)
        company_name = co.name if co is not None else None

    return AuditEventListItem(
        id=ev.id,
        created_at=ev.created_at,
        action=ev.action,
        entity_type=ev.entity_type,
        entity_id=ev.entity_id,
        actor_user_id=ev.actor_user_id,
        actor_email=actor_email,
        actor_display=actor_display,
        subject_user_id=sub_id,
        subject_email=subject_email,
        subject_display=subject_display,
        company_id=ev.company_id,
        company_name=company_name,
        details_summary=summary,
        details=safe_details,
    )


def list_audit_events_for_user(
    db_session: Session,
    actor: User,
    *,
    date_from: datetime | None,
    date_to: datetime | None,
    actor_user_id: uuid.UUID | None,
    subject_user_id: uuid.UUID | None,
    company_id: uuid.UUID | None,
    action_contains: str | None,
    entity_type_contains: str | None,
    search: str | None,
    limit: int,
    offset: int,
) -> AuditEventListResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise AuditPermissionError("Audit logs are not available to this role.")
    if actor.system_role == SystemRole.ADMIN and actor.company_id is None:
        raise AuditPermissionError("Your account is not linked to a company.")

    company_filter: uuid.UUID | None = None
    if actor.system_role == SystemRole.ADMINISTRATOR:
        company_filter = company_id

    rows, total = list_audit_events_filtered(
        db_session,
        viewer=actor,
        date_from=date_from,
        date_to=date_to,
        actor_user_id=actor_user_id,
        subject_user_id=subject_user_id,
        company_id_filter=company_filter,
        action_contains=action_contains,
        entity_type_contains=entity_type_contains,
        search=search,
        limit=limit,
        offset=offset,
    )
    items = [_to_audit_list_item(db_session, ev) for ev in rows]
    return AuditEventListResponse(items=items, total=total, limit=limit, offset=offset)


def create_audit_event(
    db_session: Session,
    actor: User,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    company_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> AuditEvent:
    if actor.system_role not in (SystemRole.ADMINISTRATOR, SystemRole.ADMIN):
        raise AuditPermissionError("You do not have permission to create audit events.")

    return create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        company_id=company_id,
        details=details,
    )


def create_internal_audit_event(
    db_session: Session,
    actor: User,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    company_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        actor_user_id=actor.id,
        company_id=company_id if actor.system_role == SystemRole.ADMINISTRATOR else actor.company_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details or {},
    )
    return save_audit_event(db_session, event)
