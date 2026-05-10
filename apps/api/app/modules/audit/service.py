import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.modules.audit.models import AuditEvent
from app.modules.audit.repository import list_audit_events, save_audit_event
from app.modules.auth.models import SystemRole, User


class AuditPermissionError(ValueError):
    pass


def get_audit_events_visible_to_user(
    db_session: Session,
    actor: User,
    limit: int = 100,
) -> list[AuditEvent]:
    if actor.system_role != SystemRole.ADMINISTRATOR:
        raise AuditPermissionError("Only an Administrator can view audit events.")

    return list_audit_events(db_session, limit=limit)


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

    event = AuditEvent(
        actor_user_id=actor.id,
        company_id=company_id if actor.system_role == SystemRole.ADMINISTRATOR else actor.company_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details or {},
    )
    return save_audit_event(db_session, event)
