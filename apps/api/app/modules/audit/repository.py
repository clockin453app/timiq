import uuid
from datetime import datetime

from sqlalchemy import String, and_, cast, func, or_, select, true
from sqlalchemy.orm import aliased
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditEvent
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.employee_profiles.models import EmployeeProfile


def list_audit_events(db_session: Session, limit: int = 100) -> list[AuditEvent]:
    """Recent events (global). Prefer list_audit_events_filtered for scoped UI."""
    statement = select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(limit)
    return list(db_session.scalars(statement).all())


def _subject_keys_clause(subject_id: uuid.UUID):
    sid = str(subject_id)
    return or_(
        AuditEvent.details["owner_user_id"].astext == sid,
        AuditEvent.details["subject_user_id"].astext == sid,
        AuditEvent.details["user_id"].astext == sid,
    )


def _subject_id_text_expr():
    return func.coalesce(
        AuditEvent.details["owner_user_id"].astext,
        AuditEvent.details["subject_user_id"].astext,
        AuditEvent.details["user_id"].astext,
    )


def _safe_search_fragment(raw: str | None) -> str | None:
    if not raw:
        return None
    cleaned = "".join(ch for ch in raw if ch.isalnum() or ch in " -_.@+")
    return cleaned[:120] or None


def list_audit_events_filtered(
    db_session: Session,
    *,
    viewer: User,
    date_from: datetime | None,
    date_to: datetime | None,
    actor_user_id: uuid.UUID | None,
    subject_user_id: uuid.UUID | None,
    company_id_filter: uuid.UUID | None,
    action_contains: str | None,
    entity_type_contains: str | None,
    search: str | None,
    limit: int,
    offset: int,
) -> tuple[list[AuditEvent], int]:
    conditions = []
    actor_user = aliased(User)
    actor_profile = aliased(EmployeeProfile)
    subject_user = aliased(User)
    subject_profile = aliased(EmployeeProfile)
    company = aliased(Company)
    subject_id_text = _subject_id_text_expr()
    include_search_joins = False

    if viewer.system_role == SystemRole.ADMIN:
        if viewer.company_id is None:
            return [], 0
        conditions.append(AuditEvent.company_id == viewer.company_id)
    elif viewer.system_role == SystemRole.ADMINISTRATOR:
        if company_id_filter is not None:
            conditions.append(AuditEvent.company_id == company_id_filter)
    else:
        return [], 0

    if date_from is not None:
        conditions.append(AuditEvent.created_at >= date_from)
    if date_to is not None:
        conditions.append(AuditEvent.created_at <= date_to)
    if actor_user_id is not None:
        conditions.append(AuditEvent.actor_user_id == actor_user_id)
    if subject_user_id is not None:
        conditions.append(_subject_keys_clause(subject_user_id))
    if action_contains:
        frag = _safe_search_fragment(action_contains)
        if frag:
            conditions.append(AuditEvent.action.ilike(f"%{frag}%", escape="\\"))
    if entity_type_contains:
        frag = _safe_search_fragment(entity_type_contains)
        if frag:
            conditions.append(AuditEvent.entity_type.ilike(f"%{frag}%", escape="\\"))
    if search:
        frag = _safe_search_fragment(search)
        if frag:
            include_search_joins = True
            like = f"%{frag}%"
            blob = cast(AuditEvent.details, String).ilike(like, escape="\\")
            actor_full_name = (
                func.coalesce(actor_profile.first_name, "")
                + " "
                + func.coalesce(actor_profile.last_name, "")
            )
            subject_full_name = (
                func.coalesce(subject_profile.first_name, "")
                + " "
                + func.coalesce(subject_profile.last_name, "")
            )
            conditions.append(
                or_(
                    AuditEvent.action.ilike(like, escape="\\"),
                    AuditEvent.entity_type.ilike(like, escape="\\"),
                    func.coalesce(AuditEvent.entity_id, "").ilike(like, escape="\\"),
                    blob,
                    actor_user.email.ilike(like, escape="\\"),
                    actor_profile.first_name.ilike(like, escape="\\"),
                    actor_profile.last_name.ilike(like, escape="\\"),
                    actor_full_name.ilike(like, escape="\\"),
                    subject_user.email.ilike(like, escape="\\"),
                    subject_profile.first_name.ilike(like, escape="\\"),
                    subject_profile.last_name.ilike(like, escape="\\"),
                    subject_full_name.ilike(like, escape="\\"),
                    company.name.ilike(like, escape="\\"),
                ),
            )

    base_where = and_(*conditions) if conditions else true()

    base_query = select(AuditEvent)
    count_stmt = select(func.count()).select_from(AuditEvent)
    if include_search_joins:
        base_query = (
            base_query.outerjoin(actor_user, AuditEvent.actor_user_id == actor_user.id)
            .outerjoin(actor_profile, actor_profile.user_id == actor_user.id)
            .outerjoin(subject_user, cast(subject_user.id, String) == subject_id_text)
            .outerjoin(subject_profile, subject_profile.user_id == subject_user.id)
            .outerjoin(company, AuditEvent.company_id == company.id)
        )
        count_stmt = (
            count_stmt.outerjoin(actor_user, AuditEvent.actor_user_id == actor_user.id)
            .outerjoin(actor_profile, actor_profile.user_id == actor_user.id)
            .outerjoin(subject_user, cast(subject_user.id, String) == subject_id_text)
            .outerjoin(subject_profile, subject_profile.user_id == subject_user.id)
            .outerjoin(company, AuditEvent.company_id == company.id)
        )
    count_stmt = count_stmt.where(base_where)
    total = int(db_session.scalar(count_stmt) or 0)

    stmt = (
        base_query
        .where(base_where)
        .order_by(AuditEvent.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = list(db_session.scalars(stmt).all())
    return rows, total


def save_audit_event(db_session: Session, audit_event: AuditEvent) -> AuditEvent:
    db_session.add(audit_event)
    db_session.commit()
    db_session.refresh(audit_event)
    return audit_event
