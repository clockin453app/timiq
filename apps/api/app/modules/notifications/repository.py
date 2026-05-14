from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.modules.notifications.models import NotificationSeen


def has_seen(db: Session, *, user_id: uuid.UUID, kind: str, target_key: str) -> bool:
    stmt = select(NotificationSeen.id).where(
        NotificationSeen.user_id == user_id,
        NotificationSeen.kind == kind,
        NotificationSeen.target_key == target_key,
    )
    return db.scalar(stmt) is not None


def upsert_seen(db: Session, *, user_id: uuid.UUID, kind: str, target_key: str, seen_at: datetime | None = None) -> None:
    when = seen_at or datetime.now(timezone.utc)
    stmt = (
        insert(NotificationSeen)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            kind=kind,
            target_key=target_key,
            seen_at=when,
            created_at=when,
        )
        .on_conflict_do_update(
            constraint="uq_notification_seen_user_kind_target",
            set_={"seen_at": when},
        )
    )
    db.execute(stmt)
