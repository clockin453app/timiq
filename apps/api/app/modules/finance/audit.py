"""Append a finance audit row to the current transaction.

This does not commit or flush. The caller's transaction owns the event.
A later rollback removes it, so a failed mutation cannot leave a successful audit row.
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.modules.finance.models import FinanceAuditEvent

AUDIT_ACTION_LIMIT = 32


def record_finance_audit(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    entity_type: str,
    entity_id: uuid.UUID,
    action: str,
    reason: str,
    before: dict[str, str] | None = None,
    after: dict[str, str] | None = None,
) -> None:
    if len(action) > AUDIT_ACTION_LIMIT:
        raise ValueError("Audit action is longer than finance_audit_events.action.")
    db_session.add(
        FinanceAuditEvent(
            id=uuid.uuid4(),
            company_id=company_id,
            actor_user_id=actor_user_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            reason=reason,
            before_json=before,
            after_json=after,
        )
    )
