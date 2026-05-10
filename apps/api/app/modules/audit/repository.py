from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.audit.models import AuditEvent


def list_audit_events(db_session: Session, limit: int = 100) -> list[AuditEvent]:
    statement = select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(limit)
    return list(db_session.scalars(statement).all())


def save_audit_event(db_session: Session, audit_event: AuditEvent) -> AuditEvent:
    db_session.add(audit_event)
    db_session.commit()
    db_session.refresh(audit_event)
    return audit_event
